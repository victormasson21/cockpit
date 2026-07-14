# Calm mode declutter — design

**Date:** 2026-07-14
**Branch:** `add-nice-background`

## Goal

Strip the Calm view down to the essentials. In Calm mode each slot shows only:

1. a **switcher** — the tree identity glyph + the worktree dropdown (which doubles as
   the title and lets you swap worktrees), and
2. the **Claude terminal** for that worktree.

No column dividers, no gear menu, no pane card (border / surface background), and a
stripped-down borderless pane header (restart + attention indicator only). The 2–3
columns stay (one per slot) — they already match the Worktrees view because both
`CalmView` and `WorktreesView` render `SlotColumn` over the same `slots` / `slotCount`
store state. Content is centered horizontally within each column, floating on the app's
existing ground.

The actual "nice background" is a **separate follow-up** — this iteration only declutters
so that a future background reads through the empty space.

## Approach

CSS-driven off a `.wt-col--calm` ancestor class rather than threading a `calm` boolean
prop into `WorktreePane`. `SlotColumn` already receives `variant`; in calm it adds the
class and does the one genuinely-structural thing in JSX: **not rendering** the gear-menu
block (a whole interactive unit — cleaner omitted than hidden). Everything else is
descendant CSS. Keeps the change to two CSS blocks + a couple of one-line JSX guards; no
new props, no store or Rust changes.

*Alternative considered:* prop-drill `calm` into `WorktreePane` to conditionally render
buttons. Marginally better for tab-order, but more code across three files for a purely
visual result. Rejected on YAGNI / keep-the-codebase-small.

## Changes

- **`src/views/worktree-column/SlotColumn.tsx`** — add `wt-col--calm` to `.wt-col` when
  `variant === "calm"`; skip the gear-menu render in calm. Icon + dropdown stay.
- **`src/views/worktree-column/WorktreeColumn.css`** — `.wt-col--calm`: drop the
  `border-right` divider, center the header, constrain the panes container to a max-width
  and center it so the terminal floats.
- **`src/views/worktree-column/WorktreePane.css`** — under `.wt-col--calm`: remove the
  pane border + surface background + header border-bottom; hide the close / expand /
  chevron buttons (keep restart); drop the attention box-glow but keep the "Attention"
  text badge. The terminal body keeps its always-dark `--term` background (it *is* the
  terminal) with a soft radius and no border, so it reads as a floating terminal.

## Not changed

Store, slots model, Worktrees / Cockpit views, any Rust. `WorktreeBody`'s calm variant
already skips chips / path / Run-Add, so nothing there.

## Testing

Purely presentational — no new logic. Existing `npx vitest run` stays green. Verify
visually in the running app: Calm shows a centered icon + dropdown + floating Claude
terminal per slot; dividers / gear / card gone; the dropdown still swaps worktrees;
restart works; attention is still indicated.

## Follow-up tweaks (same iteration)

After the first cut, three header/sizing refinements:

- **Drop "Claude Code" + the copy-prompt button** in calm — the pane title text and the
  prompt-copy `action` are no longer shown.
- **Switcher moves into the pane header**, level with the restart button. `WorktreePane`
  gained an optional `lead` slot that replaces icon+title at the start of the header; for
  a calm worktree, `SlotColumn` skips its standalone `.wt-col__header` and hands the
  switcher (identity glyph + dropdown) down through `WorktreeBody` to render as the pane's
  `lead`. Result: one header row = `[glyph][dropdown] … [restart]`.
- **~10% vertical padding** — `.wt-col--calm .wt-col__panes` gets `padding: 10vh …` so the
  tile floats with roughly 10% breathing room from the top and bottom app edges; the tile
  stays width-capped (760px) and centered.
