import { Ollama } from 'ollama';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  PROFILE_FIELD_DESCRIPTIONS,
  SanitizedCandidateSchema,
  SanitizedJobSchema,
  type SanitizedCandidate,
  type SanitizedJob,
} from './schema';

/**
 * Node's global `fetch` (undici under the hood) times out a request that
 * hasn't received response headers within 300s. A long CV/job ad on a
 * locally-hosted 7B model can spend longer than that just on prompt
 * prefill before the first token - no data at all arrives until then, so
 * the request throws `UND_ERR_HEADERS_TIMEOUT` ("fetch failed") even
 * though Ollama is still working, not stuck. Confirmed as the cause of a
 * CV upload that failed every time (2026-09-22): a ~12k-char CV
 * consistently exceeded the default timeout on this hardware. Give Ollama
 * requests specifically a much longer allowance instead of raising the
 * global default, since Ollama is the only genuinely slow local call this
 * package makes.
 */
export function createOllamaFetch(): typeof fetch {
  const dispatcher = new Agent({
    headersTimeout: 20 * 60 * 1000,
    bodyTimeout: 20 * 60 * 1000,
  });
  return ((input, init) =>
    undiciFetch(input as string, { ...init, dispatcher } as never)) as typeof fetch;
}

export interface OllamaConfig {
  host: string;
  chatModel: string;
  embedModel: string;
  /** Context window (prompt + response) in tokens, passed as `options.num_ctx`. */
  numCtx?: number;
  /** Max tokens generated per chat call, passed as `options.num_predict`. `-1` (Ollama's own default) means unbounded. */
  numPredict?: number;
}

/**
 * The subset of Ollama capability this package needs - kept as an interface
 * so tests can inject a fake instead of talking to a real local model.
 */
export interface SanitizerClient {
  sanitizeJob(rawText: string): Promise<SanitizedJob>;
  sanitizeCandidate(rawText: string): Promise<SanitizedCandidate>;
  /**
   * Second, dedicated pass over the same source text that extracts ONLY
   * requiredSkills - see the `extractSkills` doc comment on
   * `createOllamaSanitizer` below for why this exists alongside
   * sanitizeJob/sanitizeCandidate rather than replacing them.
   */
  extractSkills(rawText: string): Promise<string[]>;
  embed(text: string): Promise<number[]>;
}

// Field `description`s are what actually reach the model - Ollama's
// structured-output `format` is a plain JSON schema, not the zod schema, so
// without these the requiredSkills/softSkills split (schema.ts) is nothing
// but two same-looking array fields with no guidance distinguishing them.
const PROFILE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: PROFILE_FIELD_DESCRIPTIONS.title },
    requiredSkills: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.requiredSkills,
    },
    softSkills: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.softSkills,
    },
    experienceProfile: {
      type: 'string',
      description: PROFILE_FIELD_DESCRIPTIONS.experienceProfile,
    },
    coreResponsibilities: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.coreResponsibilities,
    },
  },
  required: [
    'title',
    'requiredSkills',
    'softSkills',
    'experienceProfile',
    'coreResponsibilities',
  ],
};

const CANDIDATE_JSON_SCHEMA = {
  ...PROFILE_JSON_SCHEMA,
  properties: {
    ...PROFILE_JSON_SCHEMA.properties,
    candidateName: {
      type: 'string',
      description: PROFILE_FIELD_DESCRIPTIONS.candidateName,
    },
  },
  required: [...PROFILE_JSON_SCHEMA.required, 'candidateName'],
};

const SKILL_SPLIT_INSTRUCTION =
  'requiredSkills and softSkills are NOT interchangeable buckets for ' +
  '"anything called a skill or requirement" - requiredSkills is ONLY named ' +
  'tools/languages/frameworks/platforms/methodologies (e.g. "Python", ' +
  '"Kubernetes", "Scrum"). Every behavioral, interpersonal, or mindset ' +
  'quality (e.g. "proactive", "strong communicator", "stakeholder ' +
  'management", "relationship-building") goes in softSkills instead, even ' +
  'when the source text phrases it as a requirement or lists it alongside ' +
  'technical ones. A customer-facing or non-technical role may legitimately ' +
  'have an empty requiredSkills list. Every requiredSkills item must be a ' +
  'single atomic technology name (1-3 words), never a sentence: split ' +
  '"experience with Kubernetes and Docker" into "Kubernetes" and "Docker" ' +
  'as two separate items, strip filler like "experience with"/' +
  '"familiarity with"/"understanding of"/"knowledge of", and drop any ' +
  'clause that names no specific technology at all. A base tool and a ' +
  'compound/derived term built on it are DISTINCT skills, never one ' +
  'subsuming the other - if the source text names both "Git" and ' +
  '"GitOps" (or "Kubernetes" and "GitOps", "Docker" and "Docker Compose", ' +
  'etc.), extract every one of them as its own separate item, never drop ' +
  'the base tool just because the compound term is also present.';

const JOB_SYSTEM_PROMPT =
  'You are an elite automated recruiter parser. Extract exact requirements ' +
  'and criteria fields into the requested JSON schema. Completely ignore ' +
  'company profiles, marketing fluff, company background history, cultural ' +
  'benefits like snacks or equity, and generic text. ' +
  SKILL_SPLIT_INSTRUCTION;

const SKILLS_ONLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    skills: {
      type: 'array',
      items: { type: 'string' },
      description: PROFILE_FIELD_DESCRIPTIONS.requiredSkills,
    },
  },
  required: ['skills'],
};

/**
 * A single call to sanitizeJob/sanitizeCandidate asks the model to produce
 * five different fields at once (title, requiredSkills, softSkills,
 * experienceProfile, coreResponsibilities) from a whole multi-section
 * document. Empirically (2026-09-25 matching-quality investigation, see
 * Docs/matching_pipeline.md) that's too much for a 7B local model to do
 * exhaustively: a real CV with a standalone "Skills" section plus three past
 * job entries' own tech lists reliably lost several skills every run -
 * inconsistent runs dropped different ones (a 14B model dropped a
 * *different* subset, including "C#"), so it isn't fixed by picking a
 * specific bigger model either. This is a narrower, single-purpose second
 * pass whose entire output is a skills list - nothing else for the model to
 * juggle - run over the SAME source text and unioned with
 * sanitizeJob/sanitizeCandidate's own requiredSkills (see pipeline.ts). Pure
 * recall booster: a duplicate the first pass already found costs nothing
 * (deduped on merge), so this only ever adds coverage, never removes it.
 */
const SKILLS_EXTRACTION_SYSTEM_PROMPT =
  'You extract EVERY named technical skill, tool, language, framework, ' +
  'platform, or technical methodology mentioned ANYWHERE in the following ' +
  'document - this is your only job, so be exhaustive rather than concise. ' +
  'Scan the entire document section by section: any standalone "Skills"/' +
  '"Competencies"/"Technologies" list, every past role or job entry and its ' +
  "own tools/technologies list, certificates, and the document's summary " +
  'text all count equally - do not stop after the first or most prominent ' +
  'section, and do not limit yourself to a single role or job entry. ' +
  'Repeating the same skill because it appears in multiple sections is ' +
  'fine; duplicates are removed later. ' +
  SKILL_SPLIT_INSTRUCTION;

const CANDIDATE_SYSTEM_PROMPT =
  'You are an elite automated CV parser. Extract the candidate\'s name and ' +
  "their skills/experience into the requested JSON schema. `title` is the " +
  "candidate's own most recent or target job title - but requiredSkills, " +
  'softSkills, and coreResponsibilities must be extracted from the ENTIRE ' +
  'CV, not just the most recent role: include every technology, tool, or ' +
  'skill named anywhere in the document - a standalone "Skills"/' +
  '"Competencies"/"Technologies" section, certificates, and every past job ' +
  "entry's own tools/technologies list all count equally, not only the " +
  "candidate's current or most recent position. Ignore formatting " +
  'artifacts and personal contact details other than the name. ' +
  SKILL_SPLIT_INSTRUCTION;

export function createOllamaSanitizer(config: OllamaConfig): SanitizerClient {
  const client = new Ollama({ host: config.host, fetch: createOllamaFetch() });

  async function chatJson(
    system: string,
    userText: string,
    format: object,
    numPredictOverride?: number,
  ): Promise<unknown> {
    const response = await client.chat({
      model: config.chatModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      format,
      options: {
        temperature: 0,
        num_ctx: config.numCtx,
        num_predict: numPredictOverride ?? config.numPredict,
      },
    });
    return JSON.parse(response.message.content);
  }

  // Capped for the same reason as EXTRACT_SKILLS_MAX_TOKENS below: with
  // config.numPredict at its usual -1 (unbounded), grammar-constrained JSON
  // decoding against this schema occasionally stalled for 20+ minutes on
  // real hardware for specific documents, then failed anyway once the
  // 20-minute fetch timeout in createOllamaFetch was hit - capping it turns
  // an indefinite hang into a fast, cheap-to-retry failure. 4096 (raised
  // from an initial 2048, see the 2026-09-26/27 Devies-resume ingestion) is
  // sized for a long CV's genuinely large output, e.g. one candidate with
  // 19 competence entries needed ~3.5K tokens - 2048 truncated that one
  // mid-string every time even though nothing was actually stuck.
  //
  // Separately, and NOT fixed by this cap: two of 39 real CVs ingested that
  // day (2026-09-26/27) deterministically produced invalid JSON (an
  // "Unterminated string" parse error at the exact same byte offset on
  // every retry, budget size irrelevant) with source text containing no
  // quotes or backslashes to blame - almost certainly the model emitting a
  // raw, unescaped newline inside a long free-text field (coreResponsibilities/
  // experienceProfile) instead of "\n". A real fix needs either a
  // JSON-repair fallback in chatJson (e.g. retry once with a "reply with
  // valid JSON, escape all newlines" nudge, or a permissive re-parse) or a
  // stricter prompt instruction against literal newlines in string values -
  // out of scope for this cap, which only bounds worst-case latency.
  const SANITIZE_MAX_TOKENS = 4096;

  return {
    async sanitizeJob(rawText) {
      const parsed = await chatJson(
        JOB_SYSTEM_PROMPT,
        `Extract the target schema from this job advertisement:\n\n${rawText}`,
        PROFILE_JSON_SCHEMA,
        SANITIZE_MAX_TOKENS,
      );
      return SanitizedJobSchema.parse(parsed);
    },

    async sanitizeCandidate(rawText) {
      const parsed = await chatJson(
        CANDIDATE_SYSTEM_PROMPT,
        `Extract the target schema from this CV:\n\n${rawText}`,
        CANDIDATE_JSON_SCHEMA,
        SANITIZE_MAX_TOKENS,
      );
      return SanitizedCandidateSchema.parse(parsed);
    },

    async extractSkills(rawText) {
      // Capped, unlike the other calls (which use config.numPredict,
      // usually -1/unbounded): the "be exhaustive" instruction this call
      // needs to counter recall misses (see SKILLS_EXTRACTION_SYSTEM_PROMPT
      // above) made num_predict=-1 genuinely open-ended in practice on real
      // hardware (2026-09-25) - one call ran for the better part of an hour
      // instead of the usual ~70s. Even a CV naming 100+ distinct skills
      // fits well under this in JSON-array form, so the cap only guards
      // against runaway generation, not real output.
      const EXTRACT_SKILLS_MAX_TOKENS = 1024;
      const parsed = (await chatJson(
        SKILLS_EXTRACTION_SYSTEM_PROMPT,
        `List every technical skill mentioned anywhere in this document:\n\n${rawText}`,
        SKILLS_ONLY_JSON_SCHEMA,
        EXTRACT_SKILLS_MAX_TOKENS,
      )) as { skills?: unknown };
      return Array.isArray(parsed.skills) ? parsed.skills.filter((s): s is string => typeof s === 'string') : [];
    },

    async embed(text) {
      const response = await client.embeddings({
        model: config.embedModel,
        prompt: text,
        options: { num_ctx: config.numCtx },
      });
      return response.embedding;
    },
  };
}
