# Tree icon — design

**Date:** 2026-07-08 · **Status:** approved

## Goal

Adopt the tree glyph (`~/Downloads/tree.svg`, a solid-white 24×24 SVG) as the worktree identity
icon in two places:

1. **Slot column header** — next to the worktree dropdown, replacing the branch glyph there.
   Must keep the attention-mode tint (warm-red on Claude bell).
2. **Header brand** — next to the "cockpit" name, top-left.

## Scope decision

`branch.png` currently appears in three places. Only the **slot column header** switches to the
tree. The **git terminal pane** header and the **Checkout** section heading in the + New modal
keep the branch glyph — those are about git branches, not worktrees.

## Approach — masked-SVG glyph (existing pattern)

All column/pane identity glyphs are masked images tinted via `background` (`.wt-col__icon`,
`.wt-ico`). The tree joins that pattern; masks read only the alpha channel, so the white-filled
SVG needs no conversion. Rejected alternatives: raw `<img>` (can't tint → attention coloring
impossible); inline React `TreeIcon` component (works, but diverges from the masked-glyph pattern
and touches more markup).

## Changes

- **Asset:** copy the SVG to `src/assets/icons/tree.svg`.
- **Slot column** (`WorktreeColumn.css`, `SlotColumn.tsx`): add a `.wt-col__icon--tree` mask
  rule; `iconKind` for worktree and empty slots becomes `"tree"` (scratch keeps `"terminal"`).
  The attention tint (`.wt-col__icon--attention` → `--bad`) keys off the shared background and
  works unchanged.
- **Header brand** (`App.tsx`, `App.css`): a masked `<span className="app__logo">` before the
  app name, ~18px, tinted `--tx-hi`. `.app__brand` aligns on `baseline` for the version tag, so
  the logo span gets `align-self: center`.
- **Docs:** update CLAUDE.md — the header is no longer logo-free (that note guarded against the
  detailed persimmon drawing, not a monochrome glyph); the logo now has three display sites
  (favicon, app/dock icons, header brand glyph — the first two remain the persimmon artwork).

## Out of scope

No Rust, no store changes, no app/dock icon or favicon changes. Verification: tsc + vitest +
Vite build; GUI eyeball by the user.
