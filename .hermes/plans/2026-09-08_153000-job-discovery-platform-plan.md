# Job Discovery Platform Implementation Plan

## Goal

Create a job discovery platform that consolidates IT and business job openings in Gothenburg from multiple sources into a single searchable interface with proper deduplication, normalization, and provenance tracking.

## Current context / assumptions

- This is a new project for collecting and displaying job openings in Gothenburg, Sweden, specifically in IT and business domains.
- The system must support both Swedish (`Göteborg`) and English (`Gothenburg`) location spelling variants.
- The initial focus is on Cinode as the primary data source with fallback to theirStack and jobspipe.
- The project follows a test-driven development approach where tests are written before implementation code.
- The platform should be designed for easy extension to additional sources.

## Architecture / proposed approach

The platform will follow a modular architecture:

1. Frontend: React + Vite application for displaying jobs
2. Backend: Node.js + TypeScript API with ingestion runners
3. Database: Turso/libSQL or SQLite for data persistence
4. Package structure:
   - `apps/web/`: React frontend
   - `apps/api/`: Node.js backend
   - `packages/domain/`: Canonical types and business rules
   - `packages/source-adapters/`: Provider-specific clients
   - `packages/database/`: Schema and repositories
   - `packages/test-utils/`: Test fixtures and helpers

## Step-by-step tasks

### Task 1: Set up repository structure and basic configuration

```bash
mkdir -p apps/web apps/api packages/domain packages/source-adapters packages/database packages/test-utils packages/config
```

### Task 2: Create domain package with core types (TDD approach)

First, create the test file for domain types:
File: `packages/domain/tests/types.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { JobOpening, JobSourceRecord, IngestionRun } from '../src/types';

describe('domain types', () => {
  it('should have correct structure for JobOpening', () => {
    const job: JobOpening = {
      id: 'test-123',
      canonicalKey: 'test-key',
      title: 'Test Developer',
      companyName: 'Test Corp',
      description: 'Test description',
      requirements: 'Test requirements',
      benefits: 'Test benefits',
      locationText: 'Gothenburg',
      normalizedLocation: 'Gothenburg',
      countryCode: 'SE',
      workModel: 'onsite',
      employmentType: 'Full-time',
      seniority: 'Mid-level',
      contractType: 'Permanent',
      contractDuration: 'Indefinite',
      salaryText: 'SEK 40,000-50,000',
      salaryMin: 40000,
      salaryMax: 50000,
      salaryCurrency: 'SEK',
      publishedAt: new Date(),
      deadlineAt: new Date(),
      status: 'active',
      sourceName: 'Cinode',
      sourceJobId: 'cinode-123',
      sourceUrl: 'https://example.com/job/123',
      applicationUrl: 'https://example.com/apply/123',
      rawPayload: {},
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      lastVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(job.id).toBe('test-123');
    expect(job.title).toBe('Test Developer');
  });

  it('should have correct structure for JobSourceRecord', () => {
    const record: JobSourceRecord = {
      id: 'record-123',
      jobOpeningId: 'test-123',
      sourceName: 'Cinode',
      sourceJobId: 'cinode-123',
      sourceUrl: 'https://example.com/job/123',
      rawPayload: {},
      fetchedAt: new Date(),
      sourcePublishedAt: new Date(),
      sourceDeadlineAt: new Date(),
      sourceStatus: 'open',
    };

    expect(record.id).toBe('record-123');
    expect(record.sourceName).toBe('Cinode');
  });

  it('should have correct structure for IngestionRun', () => {
    const run: IngestionRun = {
      id: 'run-123',
      startedAt: new Date(),
      completedAt: new Date(),
      sourcesProcessed: ['Cinode'],
      counts: {
        fetched: 5,
        accepted: 3,
        rejected: 1,
        created: 2,
        updated: 1,
        deduplicated: 0,
        failed: 0,
      },
      errors: [],
      rateLimits: {},
    };

    expect(run.id).toBe('run-123');
    expect(run.sourcesProcessed).toEqual(['Cinode']);
  });
});
```

Run the test to verify it fails (RED):

```bash
cd packages/domain && npm test
```

Now implement the types:
File: `packages/domain/src/types.ts`

```typescript
export type JobOpening = {
  id: string;
  canonicalKey: string;
  title: string;
  companyName: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;

  locationText: string | null;
  normalizedLocation: string | null;
  countryCode: string | null;
  workModel: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  employmentType: string | null;
  seniority: string | null;
  contractType: string | null;
  contractDuration: string | null;

  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;

  publishedAt: Date | null;
  deadlineAt: Date | null;
  status: 'active' | 'expired_grace_period' | 'closed' | 'unknown';

  sourceName: string;
  sourceJobId: string | null;
  sourceUrl: string;
  applicationUrl: string | null;
  rawPayload: unknown;

  firstSeenAt: Date;
  lastSeenAt: Date;
  lastVerifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type JobSourceRecord = {
  id: string;
  jobOpeningId: string;
  sourceName: string;
  sourceJobId: string | null;
  sourceUrl: string;
  rawPayload: unknown;
  fetchedAt: Date;
  sourcePublishedAt: Date | null;
  sourceDeadlineAt: Date | null;
  sourceStatus: string | null;
};

export type IngestionRun = {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  sourcesProcessed: string[];
  counts: {
    fetched: number;
    accepted: number;
    rejected: number;
    created: number;
    updated: number;
    deduplicated: number;
    failed: number;
  };
  errors: string[];
  rateLimits: Record<string, any>;
};
```

Run the test again to verify it passes (GREEN):

```bash
cd packages/domain && npm test
```

### Task 3: Write tests for Gothenburg/Göteborg matching logic (TDD approach)

First, create test file:
File: `packages/domain/tests/location-matching.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { matchesGothenburgLocation } from '../src/location-matcher';

describe('location matching', () => {
  it('should match Göteborg with Gothenburg', () => {
    expect(matchesGothenburgLocation('Göteborg')).toBe(true);
    expect(matchesGothenburgLocation('Gothenburg')).toBe(true);
    expect(matchesGothenburgLocation('Göteborg, Sweden')).toBe(true);
    expect(matchesGothenburgLocation('Gothenburg, Sweden')).toBe(true);
  });

  it('should not match other locations', () => {
    expect(matchesGothenburgLocation('Stockholm')).toBe(false);
    expect(matchesGothenburgLocation('Malmö')).toBe(false);
  });

  it('should handle variant spellings and whitespace', () => {
    expect(matchesGothenburgLocation('  Göteborg   ')).toBe(true);
    expect(matchesGothenburgLocation('GOETEBORG')).toBe(true);
    expect(matchesGothenburgLocation('Gothenburg, SE')).toBe(true);
  });
});
```

Run test to verify it fails:

```bash
cd packages/domain && npm test
```

Now implement:
File: `packages/domain/src/location-matcher.ts`

```typescript
export function matchesGothenburgLocation(location: string): boolean {
  if (!location) return false;

  const normalizedLocation = location.trim().toLowerCase();

  // Check for Gothenburg or Göteborg variants (case insensitive, ignoring punctuation)
  return (
    normalizedLocation.includes('gothenburg') ||
    normalizedLocation.includes('göteborg')
  );
}
```

Run test again to confirm it passes:

```bash
cd packages/domain && npm test
```

### Task 4: Write tests for Cinode filtering logic (TDD approach)

First, create test file:
File: `packages/domain/tests/cinode-filter.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { isCinodeJobEligible } from '../src/cinode-filter';

describe('cinode filtering', () => {
  it('should accept jobs with valid Gothenburg location and active status', () => {
    const job = {
      location: 'Gothenburg',
      status: 'open',
      deadline: null,
    };

    expect(isCinodeJobEligible(job)).toBe(true);
  });

  it('should accept jobs within 7-day grace period', () => {
    const job = {
      location: 'Göteborg',
      status: 'expired',
      deadline: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    };

    expect(isCinodeJobEligible(job)).toBe(true);
  });

  it('should reject jobs older than 7-day grace period', () => {
    const job = {
      location: 'Gothenburg',
      status: 'closed',
      deadline: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    };

    expect(isCinodeJobEligible(job)).toBe(false);
  });

  it('should reject jobs with closed status', () => {
    const job = {
      location: 'Gothenburg',
      status: 'closed',
      deadline: null,
    };

    expect(isCinodeJobEligible(job)).toBe(false);
  });

  it('should handle jobs without location properly', () => {
    const job = {
      location: '',
      status: 'open',
      deadline: null,
    };

    expect(isCinodeJobEligible(job)).toBe(false);
  });
});
```

Run test to verify it fails:

```bash
cd packages/domain && npm test
```

Now implement:
File: `packages/domain/src/cinode-filter.ts`

```typescript
import { matchesGothenburgLocation } from './location-matcher';

export function isCinodeJobEligible(job: any): boolean {
  // Check location - must be Göteborg or Gothenburg
  const hasValidLocation = matchesGothenburgLocation(job.location || '');

  if (!hasValidLocation) {
    return false;
  }

  // Check if job has a valid status or deadline
  if (job.status === 'closed' || job.status === 'filled') {
    return false;
  }

  const now = new Date();
  const deadline = job.deadline ? new Date(job.deadline) : null;

  // If no deadline is provided but the position is still active/available
  if (
    !deadline &&
    (job.status === 'open' ||
      job.status === 'active' ||
      job.status === 'published')
  ) {
    return true;
  }

  // Check if the deadline is within the grace period (7 days in the past)
  if (deadline) {
    const gracePeriod = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (deadline >= gracePeriod && deadline >= now) {
      return true;
    }

    // If job is within the 7 days past, it's still eligible
    if (deadline >= gracePeriod && deadline < now) {
      return true;
    }
  }

  return false;
}
```

Run test again to confirm it passes:

```bash
cd packages/domain && npm test
```

### Task 5: Create source adapter package structure with base class

File: `packages/source-adapters/src/base-adapter.ts`

```typescript
import { JobSourceRecord } from '../../domain/src/types';

export abstract class BaseSourceAdapter {
  abstract async fetchJobs(): Promise<JobSourceRecord[]>;

  abstract mapToCanonical(job: any): any;
}
```

### Task 6: Create database package with schema and basic setup

File: `packages/database/src/schema.ts`

```typescript
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS job_openings (
  id TEXT PRIMARY KEY,
  canonical_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT,
  description TEXT,
  requirements TEXT,
  benefits TEXT,
  location_text TEXT,
  normalized_location TEXT,
  country_code TEXT,
  work_model TEXT,
  employment_type TEXT,
  seniority TEXT,
  contract_type TEXT,
  contract_duration TEXT,
  salary_text TEXT,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  published_at DATETIME,
  deadline_at DATETIME,
  status TEXT,
  source_name TEXT NOT NULL,
  source_job_id TEXT,
  source_url TEXT NOT NULL,
  application_url TEXT,
  raw_payload TEXT,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  last_verified_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS job_source_records (
  id TEXT PRIMARY KEY,
  job_opening_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_job_id TEXT,
  source_url TEXT NOT NULL,
  raw_payload TEXT,
  fetched_at DATETIME NOT NULL,
  source_published_at DATETIME,
  source_deadline_at DATETIME,
  source_status TEXT,
  FOREIGN KEY (job_opening_id) REFERENCES job_openings (id)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  sources_processed TEXT NOT NULL,
  counts TEXT NOT NULL,
  errors TEXT,
  rate_limits TEXT
);
`;
```

### Task 7: Set up testing framework (Vitest) and create package.json files

File: `packages/domain/package.json`

```json
{
  "name": "@job-discovery/domain",
  "version": "1.0.0",
  "description": "Domain layer for job discovery platform",
  "main": "dist/index.js",
  "scripts": {
    "test": "vitest run",
    "build": "tsc"
  },
  "dependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

File: `packages/domain/vite.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

## Tests / validation

### Test: Domain types

- Write failing test for domain types (RED)
- Run to verify failure
- Implement minimal code to make it pass (GREEN)
- Run tests to verify pass

### Test: Location matching logic

- Write failing test for `matchesGothenburgLocation` with Göteborg/Gothenburg variants (RED)
- Run to verify failure
- Implement minimal code to make it pass (GREEN)
- Run tests to verify pass

### Test: Cinode job filtering

- Write failing test for `isCinodeJobEligible` functions using different deadline scenarios (RED)
- Run to verify failure
- Implement minimal filtering logic to make it pass (GREEN)
- Run tests to verify pass

## Risks, tradeoffs, and open questions

1. **Risk**: API rate limiting from sources
   - **Tradeoff**: We may need to implement sophisticated rate limiting and retry strategies
   - **Mitigation**: Configure appropriate delays and exponential backoff in source adapters

2. **Risk**: Data quality from different sources
   - **Tradeoff**: Need to design robust error handling and data validation
   - **Mitigation**: Use strict schema validation for all incoming data and implement fallback behavior

3. **Question**: How will timezone handling be managed consistently?
   - The documentation mentions using `Europe/Stockholm` timezone explicitly
   - Need to ensure all date/time operations use this explicitly

4. **Question**: What authentication approach for Cinode API?
   - Must confirm the Cinode API documentation provides clear access method
   - Should implement API key management in environment variables

5. **Risk**: Duplicated job detection and merging complexity
   - The canonical models are designed to avoid premature data loss
   - Need careful testing of the deduplication approach
