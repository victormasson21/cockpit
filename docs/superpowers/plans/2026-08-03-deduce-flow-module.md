# Deduce flow module — lift the deduce→create chain out of the store

**Date:** 2026-08-03
**Type:** pure refactor — no behaviour change, no new IPC, no Rust changes.
**Origin:** architecture review (candidate 3 of 5). The other four candidates are recorded at the
bottom of this file so a future review doesn't have to rediscover them.

---

## Problem

`startDeduceWorktree` was the app's most stateful logic — two IPC calls, two liveness guards, an
in-place swap across two slot surfaces, a context prepend, a host-precedence rule and a rollback
path — and it lived inside `useSettings`, a 72-member zustand object.

The pure helpers it composes (`slots.ts`, `model.ts`, `paneSet.ts`, `worktreeContext.ts`) were each
individually tested. **The composition was not.** Its only test surface was the whole store, reached
through a module-wide `vi.mock("../worktrees/api")` plus a `setTimeout(0)` flush hack — the classic
"pure functions extracted for testability, but the real bugs hide in how they're called".

## What changed

`src/worktrees/deduceFlow.ts` — new module:

```ts
export async function startDeduceFlow(
  { prompt, view, source }: DeduceFlowInput,
  { session, deduce, create }: DeduceFlowDeps,
): Promise<void>
```

It keeps **every decision**: both guards, the host precedence, the context prepend, `branchSpecFrom`,
the two-surface swap, the rollback. `store.ts`'s `startDeduceWorktree` is now a one-line delegation.

It returns a promise (the store does `void startDeduceFlow(...)`), so tests `await` it and the
`setTimeout(0)` flush is gone. It never rejects — by the time it settles there is no caller left to
catch.

## Decisions (and why)

**Scope: the deduce path only.** `ExistingBranchForm` (checkout) keeps its own synchronous path. The
two have genuinely different shapes — async-with-rollback owning a pending tile vs. synchronous with
an inline busy button. Unifying them needs either a pending tile for checkout (a product change) or a
`kind` flag widening the interface to serve two shapes. The apparent "shared tail" is three lines, two
of which (`makeWorktree`, `addWorktree`) are *already* the shared modules, and the host rule differs:
deduce falls back **per field** over the agent's guess, checkout takes the **whole object or blank**.

**Port shape: 14 granular, single-step operations — deliberately not 6 coarse semantic ones.** A
coarse `commit(pendingId, worktree)` would read beautifully and then absorb the swap, the repin and
the rollback into the port's *implementation* — i.e. straight back out of the test surface. That would
move complexity rather than concentrate it, and the deletion test would fail. **If you are tempted to
coarsen this port, that is the reason not to.**

**The port implementation is a private closure in `store.ts`, not new store actions.** Seven of the
14 ops didn't exist as actions (they were inline `set` calls inside the saga). Exposing them would
push `SettingsState` from 72 members to ~79 — making the store's width worse in order to fix the
saga's depth. `deduceSession` is therefore a `const` inside the `create()` closure over `set`/`get`;
the store's public interface grows by **zero**.

**Reads are getters on the port, not a snapshot passed at start.** `knownRepos` and
`worktreeContexts` are read *after* `deduce` resolves — 15-43 s later. Snapshotting them at submit
time would mean a repo host default saved during that window no longer reached the new worktree,
which is the exact bug fixed on 2026-07-31 (`resolveHost`, commits `e516aeb`/`e7448fb`). Two tests
pin this: one for per-field precedence, one for a default saved mid-deduce.

**IPC is injected, diverging from `teardown.ts`.** `teardown.ts` imports its IPC and its test
`vi.mock`s the module. That suffices there — it makes two calls and branches on neither. This flow
*branches on both* IPC results, and one test asserts `deduce` received the **bare** prompt while the
pane got the context-prefixed one. Injected fns give per-test control of resolve/reject order with no
module mock at all. (Realigning `teardown.ts` to match is deferred, below.)

**Split writes on the success path are accepted.** Today's single `setSession` becomes four calls,
but they run with **no await between them**, so no intermediate state is observable; React 19 batches
the renders and the 500 ms `scheduleSave` debounce absorbs the writes. Today's path was already two
writes, not one.

## Tests — replaced, not layered

| Where | What |
|---|---|
| `worktrees/deduceFlow.test.ts` (new) | 16 tests against a plain fake session: sync placement, `deducing`→`creating`, in-place swap, commit ordering, cockpit repin (and leaving an unrelated pin alone), context prepend, prompt + one-shot arm, host precedence, live `knownRepos` read, source-link attach, deduce failure, create failure, cockpit-failure unpin, and both mid-flight discards. No store, no `vi.mock`. |
| `settings/store.test.ts` | The 6 sequence tests + the mid-flight test **removed**. `clearInitialPrompt` and `clearWorktreeError` stay. **One** new wiring test drives the real store end-to-end so the private `deduceSession` implementation is proven against real zustand state — this is the only place `vi.mock("../worktrees/api")` is still needed. |

254 → 264 JS tests. `tsc --noEmit` clean, `npm run build` clean. No Rust touched.

## Verification

Behaviour is identical by construction, so the real proof is the running app: `+ New` → prompt →
modal closes instantly → `deducing…` → `creating…` → the real tile appears **in the same slot**. Also
worth exercising: the failure path (bad prompt → modal reopens prefilled with the error), and a
create from the Cockpit view (right column repins to the real id).

## Deferred

- **The checkout path** (`ExistingBranchForm`) and its near-duplicate tail. Revisit if it ever grows
  a pending tile — at that point the two shapes converge and one module is right.
- **The `worktreeError` → `App` reopen coupling.** Store state used as a one-shot event: the flow
  writes it, `App`'s `useEffect` watches it, `NewWorktreeForm` seeds from it, the modal clears it. Left
  exactly as-is; `session.setError` preserves it. Converting it to a callback would touch two UI
  modules and need a GUI re-check for no coverage gain.
- **Realigning `teardown.ts`** to injected deps, so the codebase has one idiom for flow modules.
- **An orphaned git worktree** if the user discards the tile in the window between `create`
  resolving and the commit. Pre-existing, accepted, unchanged.

## Sibling candidates from the same review (not done)

1. **A `git` runner module (Rust)** — *strong.* 17 hand-rolled `Command::new("git")` + `.output()` +
   `if !status.success() { Err(stderr) }` blocks across `worktree.rs` (15), `deduce.rs` and
   `github.rs`; two cwd dialects (`.current_dir` vs `-C`); `repo_default_branch` duplicated in
   `worktree.rs` and `deduce.rs` with a comment calling the duplication deliberate. `run_gh`,
   `run_claude` and `api_get` already establish the pattern — git is the missing sibling.
2. **A pane-session module (frontend)** — *strong.* Every IPC family has a typed module except PTY:
   10 raw `invoke("pty_*")` calls across `useTerminal.ts`, `WorktreeBody.tsx`, `SlotColumn.tsx`,
   `teardown.ts`, `App.tsx`. The id format, the `TextEncoder` conversion (3 sites), the
   clear-attention-on-kill rule (3 sites) and the documented kill-ordering hazard all travel with the
   call sites. `paneRoles(worktreePanes[id] ?? EMPTY_PANE_SET)` appears verbatim in two view modules.
4. **Slice the store per concern** — *worth exploring.* 72 members over 8 concerns. Concrete cost
   already present: ten modules subscribe with bare `useSettings()` (no selector), so `SlotColumn` —
   which holds the terminals — re-renders every second while the timer runs. Do this *after* the
   present refactor, which removes the store's only deep implementation.
5. **Extract the provider seam at SP5 (Linear)** — *speculative.* `keychain.rs` already has a real
   two-adapter seam; the *provider* shape (poll cadence, at-most-one-thread, snapshot emission, 429
   backoff) exists once, as `slack.rs` internals, and `pr_reviews.rs` already reaches into it. Linear
   is the second adapter that makes the seam real — and the moment copying `slack.rs` would lock the
   duplication in.
