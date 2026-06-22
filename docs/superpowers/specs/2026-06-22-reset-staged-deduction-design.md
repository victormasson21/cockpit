# Reset deduced/staged form state — design

**Date:** 2026-06-22
**Scope:** `src/tiles/worktree/NewWorktreeForm.tsx` + a pure helper in `src/worktrees/model.ts`.
**Type:** small correctness follow-up to the three deduction source types (Linear/GitHub/Slack), all complete.

## Problem

The new-worktree form runs **deduce → preview/confirm → create**. The deduce step pre-fills
editable fields AND stashes a hidden *staged-deduction unit* that `submit` later acts on:

- `prNumber` — when `> 0`, `submit` builds a `{kind:"pr"}` BranchSpec (checks out the PR).
- `sourceLink` (`WorktreeLink | null`) — `submit` attaches it to the new worktree's `links`.
- `banner` — the "deduced from …" preview shown to the user.

This unit is **never reset** on cancel, on reopen, or when the prompt changes. So a deduction
from one prompt can silently leak into a later, unrelated Create: a stale `prNumber` makes a
fresh manual Create attempt a PR checkout; a stale `sourceLink` attaches the wrong link.

Today `cancel` is just `setOpen(false)`; the "+ new worktree" reopen is just `setOpen(true)`;
neither resets anything. Changing the prompt and re-deducing overwrites most fields, but a
*manual* Create after a prior deduce still carries the old `prNumber`/`sourceLink`.

## Decisions

The three staged values (`prNumber`, `sourceLink`, `banner`) are **one unit** — they describe a
single deduction and are always cleared together, never partially. The banner stays in lockstep
with the correctness-critical state so the user is always informed of what `submit` will do.

**When to clear (confirmed):** on the three triggers that unambiguously invalidate a deduction:

1. **cancel** — closing discards the session.
2. **reopen** ("+ new worktree") — start from a clean slate.
3. **prompt change** — the prompt that produced the deduction no longer matches it.

*Not* on manual edit of a deduced field — that would surprise the user mid-edit (e.g. fixing a
typo in the name would silently drop a valid PR checkout), and the still-visible banner already
warns what `submit` will do, so it is redundant.

**How much to reset (confirmed):**

- **cancel / reopen → full reset:** the staged unit *plus* the visible deduced fields back to
  their defaults *plus* the prompt and error messages. Cancel means discard, so a clean slate is
  coherent — no half-deduced fields lingering with no banner.
- **prompt change → unit only:** clear `prNumber`/`sourceLink`/`banner` (and any stale
  `deduceError`) but leave the visible fields untouched — the user may still be refining them.

## Design

### Pure helper (testable) — `src/worktrees/model.ts`

The `prNumber`-leak logic lives in the BranchSpec construction inside `submit`. Extract it into a
pure, unit-testable helper (mirrors the existing `sourceLinkFrom` seam):

```ts
// Build the git BranchSpec from form state: a deduced PR (prNumber > 0) checks out the PR;
// otherwise an existing or new branch per the mode.
export function branchSpecFrom(opts: {
  prNumber: number; mode: "existing" | "new"; branch: string; base: string;
}): BranchSpec {
  if (opts.prNumber > 0) return { kind: "pr", number: opts.prNumber, branch: opts.branch };
  if (opts.mode === "existing") return { kind: "existing", branch: opts.branch };
  return { kind: "new", branch: opts.branch, base: opts.base };
}
```

Add a single source of truth for the form's default editable-field values, so the initial
`useState` calls and the full reset agree:

```ts
// Default editable-field values for a fresh new-worktree form (single source for init + reset).
export const FORM_DEFAULTS = {
  name: "", repoPath: "", mode: "new" as "existing" | "new",
  branch: "", base: "main", startCmd: "npm run dev", address: "http://localhost:3000",
};
```

(`BranchSpec` is imported from `./api`, alongside the existing `DeducedWorktree` import.)

### Component — `src/tiles/worktree/NewWorktreeForm.tsx`

- Initialise the visible-field `useState`s from `FORM_DEFAULTS` (no behaviour change, just a
  shared source).
- `clearDeduction()` — clears the staged unit: `setPrNumber(0)`, `setSourceLink(null)`,
  `setBanner(null)`, `setDeduceError(null)`.
- `resetForm()` — full reset: `clearDeduction()` + visible fields back to `FORM_DEFAULTS` +
  `setPrompt("")` + `setError(null)`.
- prompt `onChange` → `setPrompt(v)` **and** `clearDeduction()` (unit only).
- cancel button → `resetForm()` then `setOpen(false)`.
- "+ new worktree" reopen → `resetForm()` then `setOpen(true)`.
- `submit` → build the spec via `branchSpecFrom({ prNumber, mode, branch, base })`.

`runDeduce` and `submit`'s create/persist path are otherwise unchanged.

## Testing

- **Unit (Vitest, `src/worktrees/model.test.ts`):** `branchSpecFrom` — `pr` when `prNumber > 0`
  (even if `mode === "existing"`, PR wins), `existing` when mode is existing and no PR, `new`
  with base otherwise. Confirms the prNumber-leak guard lives in tested pure code.
- The reset wiring is plain state-setter calls in the component; covered by `tsc`, the existing
  Vitest suite, and `npm run build`. The native GUI is a blocking window — human eyeballs the
  deduce→cancel→reopen and deduce→edit→Create flows.

## Acceptance

- After deduce → cancel/reopen, a subsequent Create does **not** carry the prior `prNumber`/`sourceLink`.
- After deduce → prompt change (without re-deduce), the staged unit and banner are gone.
- The plain manual-entry path stays fully working.
- The Linear/GitHub/Slack deduce → Create happy paths are unaffected.

## Out of scope

- Clearing on manual edit of a deduced field (rejected above).
- Any change to the Rust `deduce_worktree` / `create_worktree` side.
