# Customisable worktree titles — design

**Date:** 2026-07-17
**Status:** approved (design), pending implementation plan

## Problem

A Worktrees/Calm/Cockpit slot column shows the worktree's git-derived `name` as its
heading, and the whole heading acts as the picker trigger — clicking anywhere on it
opens the worktree-selection dropdown. Users want to rename that heading to something
meaningful (e.g. "Fix the login bug") while keeping the ability to switch which
worktree the slot shows.

## Goal

- Clicking the **arrow-down (chevron)** opens the picker dropdown (unchanged capability,
  narrower target).
- Clicking the **title text** lets the user edit the slot's title inline.
- Titles apply to **worktrees and scratch terminals** (not pending entities).

## Decisions

| Question | Decision |
|----------|----------|
| Storage | **Overwrite in place** — no new field. |
| Where the title shows | **Header + picker rows** (both already read the stored name/title, so automatic). |
| Clearing a title | **No clear mechanism.** Empty/whitespace save is a no-op revert. |
| Which entities | **Worktrees + scratch terminals.** |
| Linear chip | Relabel to fixed **"Linear"**; make detection rename-robust. |
| Chevron styling | Match the nearby gear (`.icon-btn` baseline) with comfortable click padding. |

## Design

### 1. Interaction — split the switcher trigger

The switcher in `SlotColumn` is `glyph · title · chevron`. Today the title+chevron are
one `Dropdown` trigger button. Split the two targets:

- **Chevron (arrow-down)** → toggles the picker popover (existing worktree/scratch list).
- **Title text** → enters inline edit: the label becomes a text `<input>` seeded with
  the raw name/title (not the composed `name · repo` label).
  - **Enter** or **blur** → save.
  - **Escape** → revert.
  - Empty/whitespace save → no-op revert (no clear mechanism).

### 2. Data model — overwrite in place

- **Worktree:** save calls the existing `updateWorktree(id, { name })`, which persists to
  `cockpit.json`. Safe because `name` only drives (a) display and (b) the *creation-time*
  directory slug, which is already resolved and stored in `worktreePath`; the `branch` is a
  separate field set from the `BranchSpec`, never derived from `name` post-creation.
  Names may contain spaces — `slug()` sanitises spaces to dashes at creation time only.
- **Scratch:** save calls a **new session-only** store action `renameScratch(id, title)`
  that overwrites `ScratchTerminal.title`. Not persisted (scratch terminals never are).
- **Pending:** not editable (no rename affordance rendered).

### 3. Display scope

Both the trigger heading (`selectedLabel` over the picker groups) and the picker rows
already read `w.name` / `s.title`. After a rename both reflect the new value with no extra
wiring; picker rows keep the `title · repo` form.

### 4. Linear chip (`chips.ts`)

Overwriting `name` can erase the uppercase Linear ref the chip currently greps for
(`name.match(/\b[A-Z]{2,}-\d+\b/)`). Two changes:

- **Label:** render the fixed short string **"Linear"** instead of the raw ref — keeps the
  chip compact and decouples the visible label from the ref text.
- **Detection (rename-robust):** detect Linear-ness from the **branch** (which retains the
  ref, e.g. `eng-1234-…`, and is never renamed) and/or the presence of a `linear.app` link,
  rather than the now-mutable `name`. Exclude `pr-`/`issue-` prefixes so those don't
  false-positive as Linear. The chip's click-through URL stays `findLink(links, "linear.app")`.

### 5. Component approach

**Recommended:** extend the shared `Dropdown` (heading variant only) with optional props:
an editable raw value + an `onRename(value)` callback. When `onRename` is provided the
trigger splits into a clickable label region (→ inline edit) and a separate chevron
**button** (→ popover). When absent, the trigger behaves exactly as today — so Checkout's
two `form`-variant dropdowns are untouched (zero regression surface).

*Alternative considered:* keep `Dropdown` pure and render the inline-edit as a sibling in
`SlotColumn` with a chevron-only dropdown. Rejected — spreads the switcher logic across two
components for no benefit.

### 6. Chevron styling

The chevron button adopts the `.icon-btn` baseline (the same class the gear uses —
`padding: 6px 12px`, `--r-sm` radius, hover state layer) so it reads as a sibling affordance
to the nearby gear and has a comfortable click target. Sizing tweaks (icon size) live in
`Dropdown.css` / `WorktreeColumn.css` as needed.

## Testing

- **Dropdown:** rename callback fires on Enter and on blur; Escape reverts without calling
  rename; empty/whitespace save is a no-op; the chevron still toggles the popover; when
  `onRename` is absent the whole trigger opens the popover (regression guard).
- **chips.ts:** Linear chip renders label "Linear"; still detected after `name` is renamed
  to text without a ref (via branch and/or `linear.app` link); `pr-`/`issue-` branches do
  not produce a Linear chip.
- **store:** `renameScratch(id, title)` updates the matching scratch terminal's title and
  leaves others unchanged.

## Out of scope

- Persisting scratch titles across restarts (scratch is session-only by design).
- Any change to git identity, branch, or the on-disk worktree path on rename.
- Editing titles for pending entities.
