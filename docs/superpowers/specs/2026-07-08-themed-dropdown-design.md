# Themed Dropdown (custom select) — design

**Date:** 2026-07-08
**Status:** approved

## Problem

The worktree slot picker (and the two Checkout selects) are native `<select>` elements. The
*closed* control is themed by the global form baseline in `tokens.css`, but the *open popup
list* is rendered natively by macOS — CSS cannot change its font size, padding, radius, or
colours — so it appears as a white system menu that clashes with the Deep Slate theme.

## Goals

- The open dropdown list matches the app theme: slightly larger text, roomier rows,
  rounder corners, theme colours.
- One shared component improves **all** dropdowns in the app (3 call sites today).
- No new dependency; stay small (CLAUDE.md: simplest thing that works).

## Decision

Replace the native selects with a small custom **`Dropdown`** component (trigger button +
styled popover listbox), the same pattern as the existing gear-menu popover. CSS-only
polish was rejected because it cannot touch the popup; a component library was rejected
per the lean/no-deps priority.

## Component

`src/views/Dropdown.tsx` + `src/views/Dropdown.css` (lives beside `Modal.tsx`/`icons.tsx`).

```tsx
type DropdownOption = { value: string; label: string; hint?: string; disabled?: boolean };
type DropdownGroup = { label?: string; options: DropdownOption[] };

<Dropdown
  value={string | null}
  onChange={(value: string) => void}
  groups={DropdownGroup[]}          // a group without label renders ungrouped rows
  placeholder={string}              // trigger text when value resolves to no option
  variant={"heading" | "form"}
/>
```

Behaviour:

- Trigger is a real `<button>` (keyboard-focusable) showing the selected option's label,
  else the placeholder, with the themed chevron.
- Popover: absolutely positioned below the trigger, `min-width: 100%` of the trigger,
  `max-height` (~240px) with vertical scroll for long branch lists. Inside the modal
  (`.modal__content` is `overflow: auto`) an absolute popover extends the scrollable
  area rather than floating over the card — the modest max-height keeps that usable
  without resorting to a portal (deliberately avoided; YAGNI).
- Closes on: option click (fires `onChange`), click outside (document listener while
  open), and Escape.
- Disabled options render dimmed and ignore clicks.
- `hint` renders dim after the label (used for branch recency / "checked out" tags).
- The pending tile's synthetic entry stays as today: a disabled option whose label
  ("deducing…"/"creating…") the trigger displays because it is the selected value.
- **Deferred (YAGNI):** arrow-key/typeahead navigation; full ARIA listbox semantics.

Pure helper `selectedLabel(groups, value, placeholder)` (exported) resolves the trigger
text — unit-tested, matching the repo's pure-helper test style.

## Styling (theme tokens only)

- **Popover:** `--surface` background, `1px solid --bdr`, radius `--r` (the rounder one),
  small internal padding, and a soft floating shadow via a new **`--menu-shadow`** token
  added to `deepSlate.css` (keeps the no-literal-colours rule; flagged theme addition).
- **Rows:** `--fs-lg` text, `8px 14px` padding, hover = `--hover` pill with `--r-sm`
  corners; selected row `--tx-hi` + small tick on the right; disabled rows `--tx-3`.
- **Group labels:** uppercase, `--fs-2xs`, `--tx-3`, letter-spaced — themed optgroups.
- **Trigger variants:**
  - `heading` — reproduces the current picker look: bold `--fs-xl`, no background/border,
    ellipsized, chevron in `--tx-3`.
  - `form` — matches the global input baseline (`--bg-3`, `--bdr`, `--r-sm`,
    `6px 8px` padding + chevron) so Checkout looks unchanged when closed.

## Call sites

1. `SlotColumn` picker (heading variant): groups = optional pending entry, "Select…"
   as a plain first option (value `""` — choosing it clears the slot, as today),
   Worktrees group, Scratch group (when non-empty). The separate `.wt-col__caret` span
   and the select-specific `.wt-col__picker` CSS are removed.
2. `ExistingBranchForm` repo select (form variant).
3. `ExistingBranchForm` branch select (form variant): label = branch name,
   hint = `lastCommitRelative` (+ `· checked out` when disabled).

The native-select baseline in `tokens.css` **stays** — it is the documented element
default for any future form control.

## Consistency pass

The gear-menu popover (`.wt-col__menu-pop`) gets the same radius/shadow/row treatment so
the two floating menus read as one family — CSS value alignment only, no rebuild.

## Error handling

None new — the component is pure UI; empty `groups` just renders an empty popover
(callers already gate: branch select only renders when branches exist).

## Testing

- Unit: `selectedLabel` cases — placeholder when value is null/unmatched, matched label,
  disabled (pending) label, grouped lookup. Vitest, pure function.
- Manual GUI: open/close behaviours (click, click-outside, Escape), long branch list
  scroll, pending entry display, Checkout flow unchanged.
