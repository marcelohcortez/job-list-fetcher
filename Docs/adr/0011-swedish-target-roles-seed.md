# ADR 0011: Curated Swedish Role Phrases in TARGET_ROLES

**Status**: Accepted
**Date**: 2026-09-16
**Author**: Claude Sonnet 5

**Context**:

Several source boards (Nion, Xamera, Deploja/Teamtailor, Keyman) post almost exclusively in Swedish. After fixing an unrelated crash that had been silently truncating ingestion runs (see below), these boards still produced zero accepted job openings — even for titles that were both in the right location (Gothenburg) and clearly the right role once translated, e.g. "Mjukvaruutvecklare" (Software Developer) and "Android-utvecklare ... i Göteborg".

Inspecting the `target_role_phrases` table (the vector-fallback vocabulary described in [ADR 0006](0006-vector-role-scope-and-candidate-dedup.md)) showed every `source = 'learned'` row was English. In practice, no Swedish title had ever cleared `ROLE_MATCH_MIN_SIMILARITY` (0.85) against the English-only `TARGET_ROLES` seed — the vector fallback ADR 0006 designed to catch unanticipated *phrasings* of a known role does not, in practice, bridge languages at that threshold. This is separate from — and was masked by — the ingestion-runner crash: `isTitleInScope` wasn't wrapped in try/catch, so any Ollama/Chroma hiccup mid-run aborted the whole loop and stranded every adapter queued behind the failing one, which also made "these sources return nothing" look like the same problem it wasn't.

**Decision**:

Add a curated set of Swedish equivalents for the platform's core software/data/cloud/DevOps/security/IT-consulting roles directly to `TARGET_ROLES` (`packages/domain/src/target-roles.ts`), alongside the existing English phrases.

This list does double duty for free: `matchesTargetTitle` uses `TARGET_ROLES` for the regex fast path, and `seedTargetRolePhrases` (`apps/api/src/role-scope.ts`) embeds every entry in the same list into `target_role_phrases` at startup. So the same ~30 additions both regex-match Swedish titles directly and seed the vector collection with Swedish anchor phrases, giving the similarity fallback something in-language to compare against for phrasings these exact entries don't cover.

**Considered Options**:

- **Lower `ROLE_MATCH_MIN_SIMILARITY`.** Rejected as the primary fix — it's a blunt, global change affecting every source's matching precision (not just Swedish-language ones), and the underlying problem isn't that 0.85 is slightly too strict, it's that the vector store held zero Swedish anchor phrases to be similar *to*. A Swedish title was never close to an English-only vocabulary at any reasonable threshold.
- **Treat this as the same "widen `TARGET_ROLES` by hand" tax ADR 0006 rejected.** Distinguished from that case: ADR 0006 rejected hand-chasing every new *English phrasing* of a role already covered ("Senior Fullstack Engineer II" vs. "Full-Stack Developer") — that's what the vector fallback exists to absorb automatically. Bootstrapping a second language's seed vocabulary is a one-time, small, curated addition the vector fallback structurally cannot do on its own (it can't invent Swedish anchor phrases from an English-only seed list); it does not reopen an ongoing per-phrasing maintenance tax.

**Consequences**:

- **Pro**: Nion/Xamera/Deploja/Keyman listings that are genuinely in scope (matching role + Gothenburg/EMEA location) are now reachable via the regex fast path, and no longer depend on the vector fallback clearing an untested cross-lingual similarity bar.
- **Pro**: Once a Swedish title is accepted (regex or, for phrasings not in the curated list, the now-seeded vector fallback), it's folded back into `target_role_phrases` as `learned`, so the vocabulary keeps growing from real Swedish postings the same self-correcting way it already does for English ones.
- **Con**: The curated Swedish list is scoped to the roles this platform already targets in English (software/data/cloud/DevOps/AI/security/IT-consulting); it's deliberately not exhaustive and will need occasional additions the same way the English list has, just not per-phrasing-variant.
- **Con**: `ROLE_MATCH_MIN_SIMILARITY`'s effectiveness for genuinely novel Swedish phrasings (not close to any curated entry) is still untested — this ADR doesn't resolve whether 0.85 is well-tuned for cross-lingual matching in general, only that the vocabulary now has Swedish content to match against at all.

**Addendum (same date): two bare generic-suffix entries.**

Swedish compounds a role and its qualifier into one fused word ("PHP-utvecklare", "SAP SuccessFactors-konsult") rather than the space-separated "Core Phrase + Suffix" shape `GENERIC_TITLE_SUFFIXES` (`packages/domain/src/target-filter.ts`) already makes optional for English phrases in this list — there's no finite prefix list to curate for every possible tech/domain qualifier a Swedish posting might compound onto "-utvecklare" or "-konsult". `TARGET_ROLES` now also includes bare `'Utvecklare'` and `'Konsult'` (matching on the suffix word alone, after `normalizeTitle` turns the hyphen into a space) to cover this. Deliberately not extended to `-ingenjör` or `-arkitekt`: both are common suffixes on unrelated mechanical/electrical engineering titles on the same boards (e.g. "Mekanikingenjör", "Elektronikingenjör", "Provledare/elektroingenjör") that plain word-suffix matching has no way to distinguish from the software/IT kind — those stay curated, specific-phrase-only (`Systemingenjör`, `DevOps-ingenjör`, `Lösningsarkitekt`, etc.).
