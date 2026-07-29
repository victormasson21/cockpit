# Worktree Info button — design

**Date:** 2026-07-29
**Status:** approved, ready for a plan

## Problem

A worktree column's body currently spends a whole row on identity details it rarely needs to show:

```tsx
<div className="wt-col__path">
  {worktree.repoPath.split("/").pop()} · {worktree.branch} · {worktree.worktreePath.split("/").pop()}
</div>
```

That row (`WorktreeBody.tsx:70-72`, full variant only) sits between the chips/links row and the
terminal panes, costing vertical space in every column for information the user consults
occasionally. Terminals are the heart of the view; identity is reference material.

## Solution

Move the three details into a hover popup behind a circled ⓘ button placed at the **very start of
the chips/links row** — the leftmost element at the top of the worktree body, before the derived
Linear/PR/localhost chips. Delete the details row.

### Component

New `src/views/worktree-column/WorktreeInfo.tsx`, one prop `{ worktree }`:

```
<span className="wt-info">
  <button type="button" className="wt-info__btn" aria-label="worktree details"><InfoIcon /></button>
  <div className="wt-info__pop">
    <span className="wt-info__row"><FolderIcon />                          {repo basename}</span>
    <span className="wt-info__row"><span className="wt-ico wt-ico--branch" /> {worktree.branch}</span>
    <span className="wt-info__row"><span className="wt-ico wt-ico--tree" />   {worktree dir basename}</span>
  </div>
</span>
```

The three values and their order are exactly what the deleted row showed — the two basenames come
from the same `.split("/").pop()` expressions, moved verbatim.

### Icons

- **`InfoIcon`** — new inline SVG in `src/views/icons.tsx` (circle + dot + stem, same `viewBox="0 0 16 16"`
  `base`-stroke family as `GearIcon`/`PinIcon`/…).
- **Branch and tree** reuse the existing masked-glyph family from `WorktreePane.css`:
  `.wt-ico wt-ico--branch` (branch.png) and `.wt-ico wt-ico--tree`. The `--tree` variant does not
  exist yet — tree.svg is currently masked only through `.wt-col__icon--tree` — so add the one-line
  mask rule beside its siblings.
- **`FolderIcon`** — new inline SVG in `icons.tsx`. There is no folder image asset, and inventing
  one is out of scope; the SVG uses `currentColor` and is tinted `--tx-3` so it reads as the same
  weight/colour as the two masked glyphs next to it.

### Interaction: CSS-only hover

```css
.wt-info__pop { display: none; }
.wt-info:hover .wt-info__pop,
.wt-info:focus-within .wt-info__pop { display: flex; flex-direction: column; }
```

No JS state, no store slice, no outside-click listener. The gear menu needs those because it is
click-toggled; this popup is hover-driven, so the simplest thing that works is a CSS rule.
`:focus-within` means tabbing to the button also reveals the popup, which is why the trigger is a
real `<button>` rather than a `<span>`.

### Styling

The popup joins the existing floating-popover family (Dropdown popover, gear menu):
`background: var(--surface)`, `1px solid var(--bdr)`, `border-radius: var(--r)`,
`box-shadow: var(--menu-shadow)`, `padding: var(--space-1)`, `position: absolute; top: 100%; left: 0;
z-index: 10`, `white-space: nowrap`. The wrapper is `position: relative`.

Row text copies `.wt-col__path` verbatim so the popup reads identically to the row it replaces:
`font-family: var(--mono); font-size: var(--fs-xs); color: var(--tx-3)`. The masked glyphs are
sized down from their default 15.6px and tinted `--tx-3` inside the popup to sit level with
`--fs-xs` text.

### Removal

Delete the `.wt-col__path` div and its CSS rule in `WorktreeColumn.css`. The `variant === "full"`
fragment in `WorktreeBody` then wraps only the chips row, with `<WorktreeInfo>` as its first child.
Those are the only two live references — the remaining `wt-col__path` hits in the repo are
historical plan documents, which stay untouched.

Scope note: the details row is full-variant only, so the Calm view is unaffected; scratch and
pending bodies never had it.

## Testing

No new pure logic is introduced (two `.split("/").pop()` calls carried over unchanged), so no new
unit tests. The gate is `npx tsc --noEmit`, `npx vitest run`, and `npm run build` staying green,
plus human eyeball on the running app: the ⓘ sits leftmost in the top row, hovering it shows three
rows with the right glyphs and values, the old row is gone, and nothing else in the column shifted.

## Out of scope

- Click-to-pin-open, or the popup surviving pointer travel to its own body (hover on the wrapper
  covers the popup, since it is a descendant — no gap to cross).
- Showing full paths rather than basenames.
- Copy-to-clipboard on a row.
- A folder image asset to match the PNG glyph family.
