import type { JobStatus, SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import {
  asRecord,
  pick,
  pickDate,
  pickString,
  type AdapterOptions,
  type RawRecord,
} from './base';

export interface CinodeCredentials {
  accessId: string;
  accessSecret: string;
}

export interface CinodeAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  appUrl?: string;
  companyId?: string;
  pageSize?: number;
  maxPages?: number;
}

const DEFAULT_BASE_URL = 'https://api.cinode.com';
const DEFAULT_APP_URL = 'https://app.cinode.com';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;

/**
 * Cinode exposes sales projects, not job ads. A project is a customer
 * engagement; the openings we ingest are its roles (project assignments).
 * See https://api.cinode.com/docs/index.html (swagger/v0.1).
 */
const PROJECT_STATE_OPEN = 0;
const PROJECT_STATE_WON = 30;

/** ProjectAssignmentRequestStatus: Open = 0, Revoked = 10, Closed = 20. */
const REQUEST_STATUS_OPEN = 0;

/** Raised when Cinode accepts the token but refuses the resource (401/403). */
class CinodeAccessError extends Error {}

interface CinodeAssignment {
  id: number;
  title: string;
  description: string | null;
  seoId: string | null;
  startDate: string | null;
  raw: Record<string, unknown>;
}

interface CinodeProject {
  id: number;
  seoId: string | null;
  title: string;
  description: string | null;
  customerName: string;
  currentState: number | null;
  estimatedCloseDate: string | null;
  createdDateTime: string | null;
  assignments: CinodeAssignment[];
  raw: Record<string, unknown>;
}

export class CinodeAdapter {
  readonly name = 'cinode';
  private readonly baseUrl: string;
  private readonly appUrl: string;
  private readonly credentials: CinodeCredentials;
  private readonly companyId: string | undefined;
  private readonly rateLimitMs: number;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  private token: string | null = null;

  constructor(
    credentials: CinodeCredentials,
    options: CinodeAdapterOptions = {},
  ) {
    this.credentials = credentials;
    this.companyId = options.companyId;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.appUrl = options.appUrl ?? DEFAULT_APP_URL;
    this.rateLimitMs = options.rateLimitMs ?? 100;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    if (!this.companyId) {
      console.warn('Cinode adapter configured without companyId - skipping');
      return [];
    }

    // The two feeds need different Cinode modules and access levels, so a
    // company commonly has one and not the other. Losing access to one is a
    // configuration fact worth a warning, not a reason to fail the whole run -
    // but losing both means the credentials buy us nothing, so that throws.
    const outcomes = await Promise.all([
      this.collect('network requests', () => this.fetchNetworkRequests()),
      this.collect('project roles', () => this.fetchProjectRoles()),
    ]);

    const denied = outcomes.filter((outcome) => outcome.denied);
    if (denied.length === outcomes.length) {
      throw new Error(
        `Cinode denied access to every feed (${denied
          .map((outcome) => outcome.label)
          .join(
            ', ',
          )}) - the API user needs the Partners/Assignments modules and PartnerManager/CompanyManager access`,
      );
    }
    return outcomes.flatMap((outcome) => outcome.records);
  }

  private async collect(
    label: string,
    fetchFeed: () => Promise<SourceRecord[]>,
  ): Promise<{ label: string; denied: boolean; records: SourceRecord[] }> {
    try {
      return { label, denied: false, records: await fetchFeed() };
    } catch (err) {
      if (err instanceof CinodeAccessError) {
        console.warn(`Cinode ${label} unavailable: ${err.message}`);
        return { label, denied: true, records: [] };
      }
      throw err;
    }
  }

  /**
   * Network requests are assignments other companies in the partner network
   * have sent us. This is the "Network > Requests > Received" list in the app,
   * and for a subcontracting consultancy it is where openings actually appear.
   */
  private async fetchNetworkRequests(): Promise<SourceRecord[]> {
    const records: SourceRecord[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const payload = asRecord(
        await this.request(
          `/v0.1/companies/${this.companyId}/network/requests/received`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              statuses: [REQUEST_STATUS_OPEN],
              page,
              itemsPerPage: Math.min(this.pageSize, 100),
            }),
          },
        ),
      );
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      for (const entry of requests) {
        records.push(this.requestToSourceRecord(asRecord(entry)));
      }
      const totalItems = Number(pick(payload, 'totalItems') ?? records.length);
      if (requests.length === 0 || records.length >= totalItems) break;
    }
    return records;
  }

  private async fetchProjectRoles(): Promise<SourceRecord[]> {
    const summaries = await this.searchOpenProjects();
    const records: SourceRecord[] = [];
    for (const summary of summaries) {
      const project = await this.fetchProject(summary.id);
      if (!project) continue;
      for (const assignment of project.assignments) {
        const location = await this.fetchRoleLocation(
          project.id,
          assignment.id,
        );
        records.push(this.toSourceRecord(project, assignment, location));
      }
    }
    return records;
  }

  /**
   * Cinode signs API credentials into a short-lived bearer token. The token
   * endpoint sits outside the versioned API and is not part of the swagger doc.
   */
  private async authorize(): Promise<string> {
    if (this.token) return this.token;
    const basic = Buffer.from(
      `${this.credentials.accessId}:${this.credentials.accessSecret}`,
    ).toString('base64');
    const response = await this.fetcher(`${this.baseUrl}/token`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!response.ok) {
      throw new Error(
        `Cinode token request failed (${response.status}) - check CINODE_ACCESS_ID and CINODE_ACCESS_SECRET`,
      );
    }
    const payload = asRecord(await response.json());
    const token = pickString(payload, 'access_token', 'accessToken');
    if (!token)
      throw new Error('Cinode token response contained no access_token');
    this.token = token;
    return token;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const send = async () => {
      const token = await this.authorize();
      return this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    };

    let response = await send();
    if (response.status === 401 && this.token) {
      // Token expired mid-run; drop it and retry once with a fresh one.
      this.token = null;
      response = await send();
    }
    if (response.status === 401 || response.status === 403) {
      throw new CinodeAccessError(
        `${response.status} for ${path} - the API user lacks the required module or access level`,
      );
    }
    if (!response.ok) {
      throw new Error(`Cinode request failed (${response.status}) for ${path}`);
    }
    return response.json();
  }

  private async searchOpenProjects(): Promise<{ id: number }[]> {
    const found: { id: number }[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const payload = asRecord(
        await this.request(
          `/v0.1/companies/${this.companyId}/projects/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectStates: [PROJECT_STATE_OPEN, PROJECT_STATE_WON],
              pageAndSortBy: { Page: page, ItemsPerPage: this.pageSize },
            }),
          },
        ),
      );
      const result = Array.isArray(payload.result) ? payload.result : [];
      for (const item of result) {
        const id = pick(asRecord(item), 'id');
        if (id != null) found.push({ id: Number(id) });
      }
      const totalItems = Number(pick(payload, 'totalItems') ?? found.length);
      if (result.length === 0 || found.length >= totalItems) break;
    }
    return found;
  }

  private async fetchProject(projectId: number): Promise<CinodeProject | null> {
    const raw = asRecord(
      await this.request(
        `/v0.1/companies/${this.companyId}/projects/${projectId}`,
      ),
    );
    const id = pick(raw, 'id');
    if (id == null) return null;

    const assignments = (
      Array.isArray(raw.assignments) ? raw.assignments : []
    ).map((entry) => {
      const item = asRecord(entry);
      return {
        id: Number(pick(item, 'id')),
        title: pickString(item, 'title'),
        description:
          pick(item, 'description') != null
            ? pickString(item, 'description')
            : null,
        seoId: pick(item, 'seoId') != null ? pickString(item, 'seoId') : null,
        startDate:
          pick(item, 'startDate') != null
            ? pickString(item, 'startDate')
            : null,
        raw: item,
      };
    });

    return {
      id: Number(id),
      seoId: pick(raw, 'seoId') != null ? pickString(raw, 'seoId') : null,
      title: pickString(raw, 'title'),
      description:
        pick(raw, 'description') != null
          ? pickString(raw, 'description')
          : null,
      customerName: pickString(asRecord(raw.customer), 'name'),
      currentState:
        pick(raw, 'currentState') != null
          ? Number(pick(raw, 'currentState'))
          : null,
      estimatedCloseDate:
        pick(raw, 'estimatedCloseDate') != null
          ? pickString(raw, 'estimatedCloseDate')
          : null,
      createdDateTime:
        pick(raw, 'createdDateTime') != null
          ? pickString(raw, 'createdDateTime')
          : null,
      assignments: assignments.filter((a) => Number.isFinite(a.id)),
      raw,
    };
  }

  /**
   * Role location is a separate resource; a role without one simply has no
   * address on file, so a 404 is expected rather than exceptional.
   */
  private async fetchRoleLocation(
    projectId: number,
    roleId: number,
  ): Promise<string> {
    try {
      const raw = asRecord(
        await this.request(
          `/v0.1/companies/${this.companyId}/projects/${projectId}/roles/${roleId}/location`,
        ),
      );
      return pickString(raw, 'city', 'displayName', 'name', 'formattedAddress');
    } catch {
      return '';
    }
  }

  private requestToSourceRecord(raw: RawRecord): SourceRecord {
    const requestId = pick(raw, 'requestId');
    const status = pick(raw, 'status');
    const candidate = {
      id: `cinode-request-${requestId}`,
      sourceName: 'cinode',
      sourceJobId: requestId != null ? `request-${requestId}` : null,
      title: pickString(raw, 'title'),
      company: pickString(raw, 'requestSenderCompanyName'),
      location: this.requestLocation(raw),
      description:
        pick(raw, 'description') != null
          ? pickString(raw, 'description')
          : null,
      url: this.requestUrl(raw, requestId),
      applicationUrl: null,
      deadline: pickDate(raw, 'deadline'),
      status: Number(status) === REQUEST_STATUS_OPEN ? 'active' : 'closed',
      rawPayload: raw,
      fetchedAt: new Date(),
      sourcePublishedAt: pickDate(raw, 'createdDateTime'),
    };
    const parsed = SourceRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid Cinode record: ${parsed.error.message}`);
    }
    return parsed.data as SourceRecord;
  }

  /**
   * A fully remote request carries no address, so without this it would reach
   * the location filter as an empty string and be discarded as out of scope.
   */
  private requestLocation(raw: RawRecord): string {
    const location = asRecord(pick(raw, 'location'));
    const place = pickString(
      location,
      'city',
      'displayName',
      'name',
      'formattedAddress',
    );
    const isRemote = pick(raw, 'isRemote') === true;
    if (place && isRemote) return `${place} (Remote)`;
    if (place) return place;
    return isRemote ? 'Remote' : '';
  }

  /**
   * Cinode returns HATEOAS links for a request; when one is absolute we use it,
   * otherwise we fall back to the request's own API resource so that every
   * record still gets a unique, real URL for deduplication.
   */
  private requestUrl(raw: RawRecord, requestId: unknown): string {
    const links = Array.isArray(raw.links) ? raw.links : [];
    for (const link of links) {
      const href = pickString(asRecord(link), 'href');
      if (href.startsWith('http://') || href.startsWith('https://'))
        return href;
    }
    return `${this.baseUrl}/v0.1/companies/${this.companyId}/network/requests/${requestId}/received`;
  }

  private toSourceRecord(
    project: CinodeProject,
    assignment: CinodeAssignment,
    location: string,
  ): SourceRecord {
    const candidate = {
      id: `cinode-${project.id}-${assignment.id}`,
      sourceName: 'cinode',
      sourceJobId: `${project.id}-${assignment.id}`,
      title: assignment.title || project.title,
      company: project.customerName,
      location,
      description: assignment.description ?? project.description,
      url: this.roleUrl(project, assignment),
      applicationUrl: null,
      deadline: project.estimatedCloseDate
        ? pickDate({ d: project.estimatedCloseDate }, 'd')
        : null,
      status: this.mapStatus(project.currentState),
      rawPayload: {
        project: project.raw,
        assignment: assignment.raw,
        location,
      },
      fetchedAt: new Date(),
      sourcePublishedAt: project.createdDateTime
        ? pickDate({ d: project.createdDateTime }, 'd')
        : null,
    };
    const parsed = SourceRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid Cinode record: ${parsed.error.message}`);
    }
    return parsed.data as SourceRecord;
  }

  private roleUrl(
    project: CinodeProject,
    assignment: CinodeAssignment,
  ): string {
    const projectSlug = project.seoId ?? String(project.id);
    const roleSlug = assignment.seoId ?? String(assignment.id);
    return `${this.appUrl}/projects/${projectSlug}/roles/${roleSlug}`;
  }

  private mapStatus(state: number | null): JobStatus {
    if (state === PROJECT_STATE_OPEN) return 'active';
    if (state == null) return 'unknown';
    return 'closed';
  }
}
