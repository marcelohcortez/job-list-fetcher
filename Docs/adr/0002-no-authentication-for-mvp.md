# ADR 0002: Single-User/Local-First Authentication Scope

**Status**: Accepted (MVP Scope)
**Date**: 2026-09-11
**Author**: opencode

This ADR formalizes the absence of formal user accounts, Single Sign-On (SSO), and multi-tenancy for the Minimum Viable Product (MVP). This heavily simplifies the authentication and data management layers.

**Decision**:

1. **Authentication**: The system will operate under a single, unauthenticated user context. No user login, tokens, or credentials tied to an identity provider are required.
2. **State Management**: All user-specific persisted data, including watchlist keywords, manual filters, or preferences, will be stored exclusively in the local client's `localStorage` or a local database file (SQLite/Turso container).
3. **Data Scope**: The platform will not track user profiles or personal career paths beyond the basic input used for immediate filtering (e.g., a single search query).

**Considered Options**:

- **Cloud/Email Authentication**: Significantly increases complexity (user signup flow, email sending, secure password hashing, etc.) and introduces external dependencies.
- **Multi-Tenant IDs**: Requires every single source record and job opening to be scoped by a user partition ID, complicating every database query.

**Consequences**:

- **Pro**: Simplest data model and highest developer velocity for MVP. Avoids immediate GDPR/CCPA concerns related to user identity.
- **Con**: Cannot support multi-user organizations without significant future refactoring to introduce a user/tenant layer.

## Trade-off Justification

By confining the MVP to a single local user context, we minimize technical debt until the core job discovery pipeline is proven reliable. Authentication and user identity should be considered a V2 feature only.
