# Worktree top-row buttons iteration

**Date:** 2026-06-27
**Scope:** the row of buttons at the top of each worktree window (the "full" `WorktreeBody` variant). Small UI iteration, no Rust changes.

## Motivation

The top chip row and the bottom links list have drifted: a dead "CI" stub clutters
the row, the localhost link is mislabelled "Preview", and the editable links live at
the bottom — far from the chips they conceptually belong with.

## Changes

### 1. Drop the CI chip; rename `preview` → `localhost` (`chips.ts` + CSS)
- Remove the hardcoded `ci` chip push and the `"ci"` `ChipKind`. Remove `.wt-chip--ci`.
- Rename chip kind `preview` → `localhost`. Label `localhost` (or `localhost:<port>`
  when `host.address` carries a port). `url` stays `w.host.address` — the same dev URL
  the **host** terminal serves (`host.startCmd` → `host.address`), so the button opens
  exactly what's running in the pane below. CSS `.wt-chip--preview` → `.wt-chip--localhost`
  (chrome glyph unchanged).

### 2. Unified top row: links join the chips, "+ link" at the end (`WorktreeBody`, `LinksList`)
- The single `.wt-col__chips` row renders, in order: derived chips (linear / PR / localhost)
  → user links → a `+ link` button.
- User links render as chips: click opens the URL; a tiny `✎` enters edit, a tiny `✕`
  removes. In **edit mode** the chip becomes inline `label` + `url` inputs + a done (`✓`)
  control. A link with an empty URL is in edit mode automatically, so `+ link` appends a
  blank link ready to fill in. Reuses `addLink`/`updateLink`/`removeLink` from the model.
- Remove the bottom `<LinksList>` block. The links UI is reworked into a small
  `LinkChips`-style component rendered inside the chip row.

### 3. Linear deduce link — verify only (no code change)
- Confirm end-to-end: a Linear deduce stages `sourceLink` (`NewWorktreeForm.tsx`) → lands
  in `worktree.links` → renders as a link chip, and the `linear` chip becomes clickable
  via `findLink(links, "linear.app")`. Note any gap found; otherwise no change.

## Out of scope
- The `calm` variant (no chips/links) is untouched.
- No live CI integration (the reason the stub existed) — simply removed until a real
  provider lands.

## Tests
- `chips.test.ts`: drop the CI assertion; rename preview assertions to `localhost`.
- Keep `model.test.ts` green (link helpers unchanged).
- Manual GUI check for the unified row + Linear link verification.
