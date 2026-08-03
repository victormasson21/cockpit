# Settings store slices + the timer's own store

**Date:** 2026-08-03
**Type:** pure refactor — no behaviour change, no new IPC, no Rust changes.
**Origin:** architecture review candidate 4, taken up straight after candidate 3
(`2026-08-03-deduce-flow-module.md`), which had to land first because it removed the store's only deep
implementation.

---

## Problem

`store.ts` was 474 lines and 64 members fronting eight unrelated concerns (config, worktree models,
known repos, zoom, todos + tabs, Slack/PR config, the workspace arrangement, the timer), with a
576-line test file to match. Each action was a thin wrapper over an already-pure helper — interface
nearly as complex as implementation.

The width had a **measured** cost, not just an aesthetic one: ten modules subscribed with a bare
`useSettings()` (no selector), so they re-rendered on *every* store write. The timer wrote once a
second, which meant `SlotColumn` — the module that holds the terminals — re-rendered every second while
the countdown ran.

## What changed, and what deliberately didn't

**1. The timer got its own store.** `tiles/timer/timerStore.ts` (`useTimer`) owns
minutes/remaining/running and the clamp. It's the one concern that is genuinely separable: session-only,
nothing persisted, three consumer files, no cross-concern reads. Fixing it at the root means even a
careless bare `useSettings()` can never pick the tick up again. Still a store rather than component
state, because the countdown must survive the view switches that unmount the tile.

**2. The rest became slice files behind the same interface.** `store.ts` is now a 54-line assembly
point: it composes the slice creators and owns `init`, the one action that hydrates every slice at once.

```
settings/
  store.ts            assembly + init
  storeState.ts       the combined SettingsState type
  slices/
    persist.ts        THE single writer to disk (debounce + workspace composition)
    config.ts         cockpit/layout/loaded, setCockpit, worktree CRUD, known repos, contexts
    zoom.ts           fontScale + clamp
    todos.ts          items + list tabs
    integrations.ts   Slack + PR Reviews config
    workspace.ts      slots, scratch, pending, panes, flag maps, the deduce port
```

**3. Ten bare subscriptions became selectors.** Including the two that mattered most — `TodoTile`
(9 members) and `SlotColumn` (the terminals). No `useSettings()` without a selector remains.

**It is still ONE store, not several.** That was the review card's literal suggestion and it does not
survive contact with the code: the persisted `workspace` block is composed from session state *at save
time* (`withWorkspace(cockpit, state)`), and several actions genuinely span concerns — `removeWorktree`
drops a model AND clears the slot, both one-shot flag maps and the pane set; `placeNewEntity` writes the
cockpit pin AND the slots; `setFontScale` writes session state AND a persisted preference; `init` seeds
everything. Separate stores would turn that coupling into cross-store reads, which is worse. Slices are
typed over the whole `SettingsState` precisely so those actions keep working through `get()`.

**Honest scope note:** what this buys is **implementation locality**, not a narrower interface. With
zustand's slices pattern the interface consumers see is still the whole store — that's what `useSettings`
exposes. The win is that each concern's code and tests now live in one place, and the single writer is
named and unavoidable.

## Tests

The test file split the same way, one per slice, over a shared `slices/fixtures.ts`. Splitting made
per-concern gaps obvious, so this also **added** coverage that didn't exist: `updateWorktree`, the
`removeWorktree` flag/pane sweep, the Slack config writers' sibling-preservation, the todo item
lifecycle (cycle-and-wrap, delete-on-empty-edit), `swapSlots`, the attention map, pane sets
(run/add/cap/toggle/expand/reset), an unresolvable restored slot id, and cross-slice save coalescing.

264 → 271 (timer) → 288 tests. `tsc --noEmit` clean, `npm run build` clean. No Rust touched.

## Verification

Behaviour is identical by construction. In the app, worth exercising: the timer still counts across a
view switch (that's why it's a store at all), the To Do tile's tabs/edit/drag still work, a worktree
column still picks/renames/tears down, and Settings → Connections still saves.

## Deferred

- The remaining two candidates from the review: the **`git` runner module** (Rust) and the
  **pane-session module** (frontend). Both still open, both described at the bottom of
  `2026-08-03-deduce-flow-module.md`.
- **A selector-discipline lint rule.** Nothing stops the next bare `useSettings()` from reappearing;
  an ESLint rule (or a thin `useSettingsValue` wrapper that requires a selector) would make it
  structural rather than a convention. There is no ESLint config in the repo today, so this would mean
  adding one.
