# A pane-session module — the missing frontend IPC family

**Date:** 2026-08-03
**Type:** refactor. One deliberate behaviour change (a latent bug fix), called out below.
**Origin:** architecture review candidate 2 — the last of the four from 2026-08-03, after
`2026-08-03-deduce-flow-module.md`, `2026-08-03-settings-store-slices.md` and
`2026-08-03-git-runner-module.md`.

---

## Problem

Every IPC family had a typed module — `worktrees/api.ts`, `settings/api.ts`, `tiles/slack/api.ts`,
`tiles/pr/api.ts`. PTY had none. **Eleven** raw `invoke("pty_*")` calls sat across five modules
(the review counted ten; its grep `invoke[<(]"pty_` misses the type-argument form at
`useTerminal.ts:133` — use plain `grep -rn 'pty_' src`), and the invariants travelled with them:

- the `worktreeId:role` id format, paired by hand at four sites
- `Array.from(new TextEncoder().encode(...))`, twice — allocating an encoder **per keystroke**
- "clear the attention highlight when you kill", at two of the five kill sites
- the kill-ordering hazard, surviving only as a comment on `WorktreeBody.closePane`
- `paneRoles(worktreePanes[id] ?? EMPTY_PANE_SET)` verbatim in two view modules

## What changed — two layers

**`src/worktrees/ptyPane.ts`** — the typed IPC surface. Store-free on purpose: that is what keeps it
substitutable, which is what made `deduceFlow` testable.

```ts
export function ptyPane(worktreeId: string, role: string): PtyPane
export function writePty(ptyId: string, text: string): Promise<void>
// PtyPane: id · ensure · attach · onOutput · write · resize · kill · respawn
```

**`src/worktrees/paneLifecycle.ts`** — the sequences, where IPC meets the store. Deps injected with a
real default (`teardown.ts`'s idiom), so the orderings are unit-tested against a plain fake.

```ts
export function liveRoles(worktreeId: string): string[]
export function killPanes(worktreeId: string, roles: string[], deps?): Promise<void>
export function closePane(worktreeId: string, role: string, deps?): Promise<void>
```

### Decisions worth not undoing

**`write` takes text, not bytes.** `NEWLINE_ESCAPE` went from `[0x5c, 0x0d]` to `"\\\r"`, which
collapsed the two write shapes into one and moved encoding wholly inside the module. The encoder is
now hoisted to module scope, so **the keystroke hot path allocates less than it did** — the one thing
that path could not afford was extra work, `pty_write` being the one I/O-adjacent Rust command
deliberately left synchronous for latency. `keys.test.ts` keeps a test pinning the two bytes the
escape must still produce.

**`writePty` is the one id-keyed export, and only for the file drop.** Its DOM hit-test yields an
opaque `data-pty-id`; there is no pair to key on. Splitting the id back apart to feed `ptyPane` would
be worse. Everything else keys on `(worktreeId, role)`.

**`onOutput` moved in despite having a single caller.** `pty://{id}` is the same Rust-mirrored
convention as the id itself, and it makes `attach`/`onOutput` symmetric — both hand back
`Uint8Array`, so `useTerminal` no longer constructs one at two sites.

**`respawn` is a method, not a caller-side `.then()` chain.** It exists to name the ordering: the kill
must land **before** the ensure, because `pty_ensure` reattaches a still-alive entry. A test asserts
the order and that a failed kill never ensures.

**`liveRoles` reads the store internally.** Not a store member — `SettingsState` stays as wide as it
was, the deduceFlow lesson. Not a `paneSet` helper either: callers would still hand it the pane map,
so `EMPTY_PANE_SET` would still leak into the views. Both view sites now read `liveRoles(id)`.

**`roles` stays a required argument to `killPanes`.** Defaulting it to `liveRoles(worktreeId)` was
tempting (it would delete the argument from three call sites) and is a trap: a scratch terminal has no
entry in `worktreePanes`, so the default would compute `["claude"]` and kill the wrong thing — or
nothing. Explicit roles, no footgun.

**Two functions in the lifecycle layer, not one.** `killPanes` propagates a failure (teardown must
not reach `git worktree remove` with a process still holding the directory); `closePane` swallows it
(a pane left on screen with no process behind it blinks a cursor and eats keystrokes silently). Those
are opposite error policies for the same kill, so they cannot be one function. `pausePanes` was
sketched and dropped — Pause's tail is a store reset plus a UI callback, so it stays in `SlotColumn`.

## The one behaviour change

**Clearing the attention mark now belongs to the kill.** Before, only `useTerminal.respawn` and
`WorktreeBody.closePane` cleared it — **Pause, scratch Delete and teardown did not**. So pausing a
worktree whose Claude pane had belled left a live `attention[wt:claude]` entry, and re-selecting that
worktree later showed a stale glow with nothing behind it. Absorbing the rule into `killPanes` fixes
that. Approved before implementing; worth a look in the smoke.

## What deliberately stayed put

`makePtyId` and `isAttentionRole` remain in `ptyId.ts`: the id is also a **store key** (the attention
map) and a DOM attribute (`data-pty-id`), which are not IPC concerns. `useTerminal`'s mount effect
still holds `[worktreeId, role, cwd]` deps and still keeps `autostartCmd`/`onEnsured` in refs — the
pane handle joined them in a ref (`paneRef`) exactly where `ptyIdRef` used to sit, so nothing
recreates the xterm. `pty.rs` is untouched; the five commands were sufficient.

## Tests

`ptyPane.test.ts` (11) — id composition; `ensure` payload; `attach` → `Uint8Array`; `onOutput`
subscribing to `pty://<id>` and handing over bytes; UTF-8 encoding **by byte, not character** (`é🌳`);
the Shift+Enter escape still producing `[92, 13]`; `resize`/`kill` addressing by id; respawn's
kill-before-ensure; respawn not ensuring when the kill fails.

`paneLifecycle.test.ts` (7) — attention cleared before each kill; every live role walked in order; a
scratch's single shell through the same path; a kill failure propagating and stopping the walk;
`killPanes` never removing panes; `closePane` killing before dropping; and `closePane` **still**
dropping the pane when the kill fails.

288 → 306 JS tests (+18, one of them in `keys.test.ts`). `tsc --noEmit`, `npm run build` clean. Rust
untouched: 137 tests, unchanged.

## Verification

Behaviour is identical by construction except the attention fix, so the proof is the running app.
This touches every terminal path, so the smoke list is long: a worktree's Claude pane starting; Run
spawning the dev server; Add creating extra shells; Close on each kind (Claude respawns bare,
host/extras disappear); restart; Pause then re-select (**no stale glow** — the fix); Delete and Wipe
killing everything; a scratch terminal and its Delete; Calm view; Shift+Enter inserting a newline
rather than submitting; dragging a file from Finder onto a pane; and the attention glow clearing when
you type.

## `teardown.ts` realigned to injected deps

Routing `teardown.ts` through `killPanes` gave it a transitive dependency on the settings store, which
its test then had to drag in. Fixed in the same branch, closing the realignment the deduceFlow plan had
deferred: the tail is a **deps object** rather than a fifth positional parameter, so the signature got
*shorter*, not longer.

```ts
teardownWorktree(wt, opts, { killPtys: () => Promise<void>, removeModel: (id) => void })
```

**`killPtys` is a thunk, not `(id, roles)`.** Which panes are live is a pane concern; binding it at the
call site means teardown never models panes at all, and the `roles` parameter that the lazy-panes
iteration threaded through leaves the signature. `TeardownConfirm` passes
`() => killPanes(worktree.id, liveRoles(worktree.id))`, so the roles are read when the kill runs —
teardown's first statement, before any await, so identical to reading them at the call.

The git IPC (`removeWorktreeGit`/`deleteBranch`) stays imported and module-mocked. It could be injected
too, but the test branches on those results via `mockRejectedValueOnce` perfectly well, and the point
of this change was the store, not the mock.

Its test lost the `@tauri-apps/api/core` mock entirely, and the two per-role ordering tests collapsed
into one "kill before remove" — asserting *which* roles get killed belongs to `paneLifecycle.test.ts`,
which already does it. A new test covers the policy that matters here: a failed kill propagates and
never reaches the git remove. Still 7 tests, still 306 overall.

## Deferred

- **Unhandled rejections on the write path.** `write` returns its promise and the two terminal callers
  keep no `.catch`, exactly as before, so a write to a dead pty still logs an unhandled rejection.
  Preserved on purpose — it is the symptom that makes the dead-pane bug visible.
- **`WorktreePane`'s `data-pty-id`** is still composed with `makePtyId`. Correct today (it is a DOM
  attribute, not IPC), but it is the string `writePty` consumes, so the two are coupled at a distance.
