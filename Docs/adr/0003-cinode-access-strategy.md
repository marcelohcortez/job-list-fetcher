# ADR 0003: Cinode Access Strategy — Public Market Board Alongside the Private API

**Status**: Accepted
**Date**: 2026-09-14
**Author**: Claude Opus 5

Cinode was named the MVP's first-priority source. Implementing it revealed that the assumption behind that priority — that Cinode exposes job openings through its documented API — does not hold, and that the API is unreachable on a default account. This ADR records what was found and how the source is obtained instead.

**Context**:

1. **Cinode has no job-ad endpoint.** Its v0.1 swagger (237 paths) and v0.2 (14 paths) contain no `jobs`, `career`, `vacancy`, `advert` or `position` resource. Openings are modelled either as **projects** with **roles** (project assignments), or as **requests received** from partner companies. `GET /v0.1/companies/{id}/projects` is additionally documented as returning only projects in the `WON` state, so listing openings requires `POST /projects/search`.
2. **Authentication is undocumented.** Credentials are exchanged for a bearer token at `GET /token` using HTTP Basic `accessId:accessSecret`. That endpoint appears in neither swagger document.
3. **A default API user is entitled to nothing.** `GET /token` and `GET /_whoami` both return 200, confirming valid credentials, while every company-scoped endpoint returns 403 — including `GET /capabilities`. The issued JWT carries no scope or role claims (only `companySub`), so authorization is resolved entirely server-side. No client-side change can affect it, and the account holder could not grant the access themselves.
4. **A public board exists.** [market.cinode.com](https://market.cinode.com) publishes assignment requests openly, with title, company, dates, rate and location, and requires no credentials.

**Decision**:

1. **Ship two independent adapters.** `CinodeAdapter` reads the private API; `CinodeMarketAdapter` reads the public market board. They share nothing but a vendor name, and appear as separate sources (`cinode`, `cinode-market`) in ingestion runs.
2. **Make the public market the default.** It is enabled unless `CINODE_MARKET_ENABLED=false`, so the vendor yields listings on a keyless install. The API adapter stays dormant until all three credential variables are set.
3. **Read the market through its own list contract, not by crawling.** The site's "load more" button issues `GET /?nextCursor=…` with `X-Requested-With: XMLHttpRequest` and receives the following cursor in an `X-Next-Cursor` response header. The adapter uses exactly that call, paginating with the site's own cursors and a request delay, rather than enumerating request IDs.
4. **Degrade per feed inside the API adapter.** The two private feeds require different modules and access levels, so one is commonly available without the other. A feed answering 401/403 logs a warning and contributes nothing; the run fails only when every feed is denied.

**Considered Options**:

- **Wait for API entitlement.** Correct but indefinite, and outside the repository's control; it would have left the MVP's first-priority source contributing nothing.
- **Authenticate as the human user against the app's own backend.** Would require handling a personal password or session cookie, storing a credential far more sensitive than an API key, and depends on a private interface with no stability contract. Rejected.
- **Crawl `/requests/{id}` by enumerating IDs.** Simpler to write, but issues far more requests than the site's own UI does for the same data. Rejected in favour of the cursor contract.

**Consequences**:

- **Pro**: Cinode contributes listings on a keyless install, and the API adapter starts working the moment entitlement is granted, with no further code change.
- **Con**: The market adapter parses HTML and will break when Cinode restyles the card markup. The failure is silent by nature — parsing simply yields nothing — so it is mitigated by a warning when the first page produces no cards, and by tests that pin the expected markup. Treat a sudden drop of `cinode-market` to zero as a parser failure, not an empty board.
- **Con**: The two Cinode sources cover **disjoint** sets. An assignment broadcast to a company's partner network is not published to the public market, and market listings are not in the network feed. Having one source working does not mean an opening seen in the Cinode app will appear.

## Trade-off Justification

The alternative to a fragile public source was no Cinode source at all, for an unknown period, for the source the specification ranked first. The brittleness is confined to one adapter, is visible in ingestion counts, and costs nothing when it breaks — the other sources are unaffected. The private API adapter is written, tested and ready, so the fragile path can be retired the day the account is entitled.
