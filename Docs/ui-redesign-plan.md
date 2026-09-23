# UI Redesign Plan (Lighter, Cleaner, Less Cluttered)

Status: **draft**. Goal: reduce visual density and icon use across the app, using the internal Devies `crm_new` frontend as the design reference. Written alongside [laya-integration-plan.md](laya-integration-plan.md), since that plan adds two new blocks (match %, reasoning text) to the same card this redesign targets — sequence them together (see "Sequencing" below).

## Design reference: Devies `crm_new`

Reference: `/Users/marcelohenriquescortez/Work/devies-tools/Frontend/src/crm_new`. This is the internal CRM's newer UI (dashboard, contacts, group customers, sales board) — the visual language this redesign should match.

**Important nuance found during inspection**: `crm_new` is a deliberate *bespoke* design system, not built on MUI components. Its own imports use none of `@mui/material`, `@mui/lab`, `@mui/system`, `@mui/x-date-pickers`, `@emotion/*`, or `tss-react` — those exist in the broader `devies-tools` app (`Frontend/package.json`) but `crm_new` itself opts out of them, using plain `div`/`button`/inline `<style>` blocks and `style={{}}` objects instead. The **only** MUI package `crm_new` actually uses is `@mui/icons-material`, and only 4 icons total. So "base the design on `crm_new`" in practice means: replicate its plain-CSS token system and its restrained icon usage — not adopt MUI's component library wholesale. See "Dependencies" below for how to reconcile this with the requested package list.

### Tokens to replicate

From `crm_new/shared/theme.ts`:

```
COLORS = {
  bg:      oklch(99% .004 100),
  surface: oklch(100% 0 0),
  fg:      oklch(5% .018 270),
  muted:   oklch(40% .008 250),
  border:  oklch(77% .028 230),
  accent:  oklch(47% .092 222),
  warm:    oklch(70% .15 55),
  success: oklch(55% .12 150),
  danger:  oklch(55% .16 25),
}
FONT_DISPLAY = 'DM Sans', ...
FONT_MONO    = ui-monospace, 'JetBrains Mono', ...
```

- **Flat, border-based elevation** — no box-shadows anywhere in `crm_new`. Cards separate from background via a single `1px solid border`, not shadow.
- **Radius scale**: cards `12px`, buttons `8px`, chips/pills `999px` (fully rounded).
- **Card padding**: `18-20px`.
- **Card density**: sparse. A stat card is 3 elements (label + small outlined icon, large numeric value, muted footer line). A content card is header row (title + count badge + one primary button) plus a list of simple rows below — 5-8 elements, well short of `job-list-fetcher`'s current 10-15+ per `JobCard`.

Compare against `apps/web/src/styles.css`'s existing tokens (`--bg`, `--fg`, `--muted`, `--card`, `--border`, `--accent*`, `--success`/`--danger`/`--warning`, `--radius`/`--radius-sm`, `--shadow-sm`/`--shadow-md`) — same *shape* of token system, different values and one structural difference (this app currently uses shadows; `crm_new` uses none). Redesign should retarget these existing variables to `crm_new`'s values/approach rather than introduce a parallel token system.

### Icons

`crm_new` uses exactly 4 icons, all `*Outlined` variants from `@mui/icons-material`: `PeopleAltOutlined`, `DescriptionOutlined`, `ScheduleOutlined`, `BlockOutlined` — small, consistent, monochrome. Everything else (close buttons, arrows) is a hand-drawn inline `<svg>`, not an icon-library glyph. No sidebar/nav component exists inside `crm_new` itself (nav chrome lives in the wider app's `AppContainer.tsx`, out of scope) — so there's no direct "sidebar icon" precedent to copy 1:1, but the pattern to follow is clear: **outlined, monochrome, used sparingly for a handful of top-level concepts** — not the current full-color emoji set.

## Current state (job-list-fetcher inventory)

- **Stack today**: plain CSS, one file — `apps/web/src/styles.css` (836 lines). Existing CSS custom properties already exist for light/dark themes. No Tailwind, no CSS modules, no component-scoped styles.
- **Icons today**: no icon library in `apps/web/package.json`. 5 raw emoji in the sidebar nav (`App.tsx:31-35`, `NAV_ITEMS`: 💼 Openings, ✅ Applied, 📄 Upload CV, 📚 Upload CVs, 🎯 Matches). Nowhere else in the app uses icons/emoji — the density problem is not "too many icons" literally, it's **badges, chips, and buttons stacking up on the job card**.
- **Pages**: 5 tabs sharing one shell (`App.tsx`) — Openings (`JobsTab`), Applied (`AppliedTab`), Upload CV (`UploadCvTab.tsx`), Upload CVs (`UploadCvsTab.tsx`), Matches (`MatchesTab.tsx`). `JobsTab`/`AppliedTab`/`MatchesTab` all render `components/JobCard.tsx` — one shared card is most of the app's visual surface.
- **The card** (`components/JobCard.tsx`, 201 lines) is the main clutter source. Per card, today:
  - Title (h2)
  - Status badge (`status-active`) + optional "Seen" badge — 2 badges
  - Meta row: company, location, source, published date — 4 text fields
  - Match block: similarity % badge + "X/Y required skills" text — 2 score indicators
  - Skill breakdown: matched-skill chips + missing-skill chips, each skill its own `<span class="skill-chip">` — can be 5-15+ individual chips
  - Description snippet
  - Salary text
  - Links row: view/apply — 2 links
  - "CVs sent" picker: a nested `<details>` with checkboxes
  - Marks row: 3 buttons (Seen, Applied, Not interested)

  Roughly 10-15+ distinct visual elements per card, well above `crm_new`'s 5-8/card ceiling — that gap is the concrete target for this redesign.

## Dependencies

Approved additions to `apps/web/package.json`:

- `@mui/material`, `@mui/lab`, `@mui/system`, `@mui/x-date-pickers`, `@mui/icons-material`
- `@emotion/react`, `@emotion/styled` (MUI's styling engine — required peer deps for the above)
- `tss-react` (dev dependency — CSS-in-JS theming helper used elsewhere in `devies-tools`)

**How to use them, given the `crm_new` nuance above**:
- `@mui/icons-material` — use directly, for the sidebar nav and anywhere else a small, consistent, outlined icon is warranted (see "Icons" above). This is the one package `crm_new` itself actually relies on.
- `@mui/material` / `@mui/lab` / `@mui/system` / `@emotion/*` / `tss-react` — available for genuinely complex interactive components where hand-rolled CSS would be more work than it's worth (e.g. a real date-range picker via `@mui/x-date-pickers`, a combobox/autocomplete). **Not** intended to replace the plain-CSS card/layout approach — `crm_new`'s own restraint here (bespoke divs + CSS, not `Card`/`Paper`/`Chip` from MUI) is the pattern to match, so default to extending `styles.css`'s token system first, and reach for a MUI component only when it solves a real interaction-complexity problem plain CSS doesn't.
- `@mui/x-date-pickers` in particular has no current use case in this app yet — pull it in only when a feature actually needs a date picker (e.g. filtering jobs by published date), not speculatively.

## Design direction

"Lighter, cleaner, less icons/clutter" breaks down into concrete moves, now calibrated against `crm_new`:

1. **Retarget existing tokens to `crm_new`'s values** — swap `styles.css`'s color variables toward the `oklch()` palette above, drop box-shadows in favor of `crm_new`'s flat/border-based elevation, align radius scale (`12px` cards / `8px` buttons / `999px` pills), adopt `DM Sans` for display type if not already close to it.
2. **Reduce simultaneous visual weight on the card** — group into a clear hierarchy (primary: title + match %; secondary: compact one-line meta; tertiary: skills/actions), matching `crm_new`'s sparse card shape instead of today's flat stack of 10-15 equally-weighted elements.
3. **Fewer, calmer badges** — collapse "status badge + Seen badge" into one indicator where possible; reserve color-coded badges for the one or two things that need it (e.g. match strength), everything else as plain text.
4. **Contain the skill-chip sprawl** — the single biggest density source. Cap visible chips (e.g. top 5-6 matched + a "+N more" disclosure) instead of rendering the full list inline.
5. **Sidebar icons: emoji → `@mui/icons-material` outlined set** — replace the 5 full-color emoji with monochrome outlined icons from `@mui/icons-material`, matching `crm_new`'s icon restraint (small, consistent, outlined). No longer "lowest priority / optional" — this is now the concrete direction per the dependency addition above.

## What does NOT change

- No new pages/routes — this is a density/hierarchy pass on existing components, not an IA change.
- No change to the 5-tab structure or shared-`JobCard` architecture.
- No wholesale migration of the card/layout to MUI components — see "Dependencies" above for why (`crm_new` itself doesn't do this either).

## Sequencing with the Laya plan

[laya-integration-plan.md](laya-integration-plan.md) Phase 5 adds two more blocks to this same card (match-percentage + verdict, and a reasoning-text paragraph). Doing the density pass **before** Laya's UI phase means the new content lands in the already-decluttered hierarchy instead of being bolted onto the current dense version and then needing to be touched again. Recommended order:

1. This redesign's Phase 1-3 (tokens, card hierarchy, chip containment) ship first.
2. Laya Phase 5 lands the two new blocks into the resulting layout — the reasoning-text block in particular needs calm typography (no icon, no colored box, plain body text, matching `crm_new`'s restraint) to not reintroduce the clutter this plan removes.

## Phased build tasks

**Phase 0 — dependencies**
- Add the packages listed in "Dependencies" above to `apps/web/package.json`.
- Confirm no version conflicts with existing `react`/`react-dom`/`react-router-dom` versions in `apps/web`.

**Phase 1 — token retarget** (`styles.css`)
- Update color variables toward `crm_new`'s `oklch()` palette (`bg`, `surface`/`card`, `fg`, `muted`, `border`, `accent`, `success`, `danger`; `warm` has no current equivalent — evaluate if needed).
- Drop `--shadow-sm`/`--shadow-md` usage in favor of border-only elevation; update `--radius`/`--radius-sm` to `12px`/`8px` (+ introduce a pill radius `999px` for chips/badges).
- Evaluate `DM Sans` for display typography.
- Drop the existing `prefers-color-scheme` dark-mode block — light-mode only, matching `crm_new` (Decision: no dark-mode variant needed).

**Phase 2 — card hierarchy pass** (`components/JobCard.tsx`, `styles.css`)
- Establish primary/secondary/tertiary visual tiers per "Design direction" #2.
- Merge status + "Seen" badge logic into a single state indicator where both can't be simultaneously true/relevant.
- Reduce border/background usage on sub-elements — rely on spacing and type-weight for separation, matching `crm_new`'s restraint.

**Phase 3 — skill chip containment** (`components/JobCard.tsx`)
- Cap inline-rendered chips (matched and missing separately) to a small number (e.g. 5-6), with a "+N more" expandable disclosure for the rest — reuses the existing `<details>` pattern already used for "CVs sent". Style chips as pills (`999px` radius) per the token update.

**Phase 4 — sidebar icons** (`App.tsx`, `styles.css`)
- Replace `NAV_ITEMS`' emoji with `@mui/icons-material` outlined icons — monochrome, sized/colored via the token palette (not full-color). Proposed mapping (swap freely later, these are a reasonable starting pick):

| Tab | Current emoji | Proposed icon |
| --- | --- | --- |
| Openings | 💼 | `WorkOutlineOutlined` |
| Applied | ✅ | `TaskAltOutlined` |
| Upload CV | 📄 | `UploadFileOutlined` |
| Upload CVs | 📚 | `LibraryBooksOutlined` |
| Matches | 🎯 | `TrackChangesOutlined` |

**Phase 5 — integrate with Laya UI** (coordinate with laya-integration-plan.md Phase 5)
- Land the match-percentage + verdict block and reasoning-text block into the Phase 2 hierarchy, following the "calm typography, no icon/colored box" note above.

