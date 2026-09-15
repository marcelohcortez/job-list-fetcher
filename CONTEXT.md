# Job Discovery Platform — Domain Context

## Single Context

### Description

This platform aggregates and normalizes job openings from multiple sources (JobSources) to provide a single, canonical view of a job's opportunity. It is designed to assist job seekers by providing filtered and deduplicated listings of IT, Business, Data, and Cybersecurity roles.

### Language

**JobSource**: A provider of streaming or periodic job openings (e.g., Cinode, public ATS sites, job search engines). Each source has a unique name and an API connector to retrieve raw job data.
_Includes_: JobTech Dev, Greenhouse, Lever, Cinode Market, Cinode API, TheirStack
_Avoid_: JobSpipe, (unless specified as a source)

**JobOpening**: The canonical, normalized entity representing one specific job opportunity. It aggregates data from one or more JobSources and can be filtered to match a user's declared interests.
_Avoid_: RawJobListing, (raw data returned by source APIs)

**SourceRecord**: A single piece of raw job data ingested from one specific JobSource for a unique JobOpening. This link preserves the original source context and raw data.

**CanonicalKey**: A unique identifier (hash) derived from Title + Company Name + Location, used to detect and group near-identical job postings across different JobSources, facilitating deduplication.
_Avoid_: (simple UUIDs, as they don't indicate content duplication)

**Status**: The lifecycle status of a job posting:
: Active: The job is currently open and accepting applications.
: Expired\_GracePeriod: The application deadline was within the last 7 days (based on EEST/Europe/Stockholm time zone), but the listing is kept for historical review. This status is visualized in a separate section from active roles.
: Closed: The job is permanently closed and rejected as a source record.

### Relationships

- A **JobOpening** is composed of one or more **SourceRecords** from various **JobSources**.
- **SourceRecords** contribute to the stable **CanonicalKey**.
- Failed ingests create **IngestionRuns**, which process one or more **JobSources** to identify new records.

### Example dialogue

> **Dev:** "If the same role is posted today on both Cinode and Greenhouse, do we create two JobOpenings?"
> **Domain expert:** "No. We create one **JobOpening** linked by a **CanonicalKey**, with two distinct **SourceRecords** linking back to the respective source."
>
> **Dev:** "What happens to jobs that close/expire?"
> **Domain expert:** "If the end date falls within the 7-day window, it transitions to **Expired\_GracePeriod**. Otherwise, it's archived/deleted after the next run."

### Flagged ambiguities

- **'Job'**: In this context refers to the canonical job role (`JobOpening`), not the search query itself.
- **Filtering**: This platform limits the scope to IT, Business, Data, and Cybersecurity skills/roles.

## Rules

- **SourceRecord** must carry the necessary fields to calculate the **CanonicalKey** reliably.
- The status **Expired\_GracePeriod** is a hard, business rule: 7 days from the actual close date.
- The primary concern is the **JobOpening**'s canonical representation, deduplication is paramount.
