# Reset Staged Deduction Form State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a stale deduction from misrouting a later Create by resetting the hidden staged-deduction unit (`prNumber`/`sourceLink`/`banner`) on cancel, reopen, and prompt change.

**Architecture:** Extract the BranchSpec construction (where the `prNumber` leak fires) into a pure, unit-tested helper `branchSpecFrom` in `src/worktrees/model.ts`, plus a shared `FORM_DEFAULTS` constant. Then wire `NewWorktreeForm.tsx` to clear the staged unit on the confirmed triggers and to build its spec via the new helper.

**Tech Stack:** React 19 + TypeScript (Vite), Vitest for frontend tests.

## Global Constraints

- LEARNING project: every new function/non-obvious block gets a concise one-line role/intent comment; files keep their top-of-file role comment.
- MINIMALISM: smallest change that works; no new dependencies; no unrelated refactoring.
- Pure form logic lives in `src/worktrees/model.ts` with tests in `src/worktrees/model.test.ts` (mirrors the existing `sourceLinkFrom` seam).
- Frontend tests: `npm test` (Vitest). Also gate on `npx tsc --noEmit` and `npm run build`.
- The native GUI is a blocking window — verify via tsc/build/tests; human eyeballs the GUI flows.
- Reset semantics (confirmed in the spec): clear the staged unit `{prNumber, sourceLink, banner}` (always together) on **cancel**, **reopen**, and **prompt change**. Cancel/reopen do a **full reset** (staged unit + visible fields → `FORM_DEFAULTS` + prompt + errors). Prompt change clears the **unit only**. Never clear on manual edit of a deduced field.

---

### Task 1: Pure helpers in `model.ts` — `branchSpecFrom` + `FORM_DEFAULTS`

**Files:**
- Modify: `src/worktrees/model.ts`
- Test: `src/worktrees/model.test.ts`

**Interfaces:**
- Consumes: `BranchSpec` from `./api` (existing tagged union).
- Produces:
  - `branchSpecFrom(opts: { prNumber: number; mode: "existing" | "new"; branch: string; base: string }): BranchSpec`
  - `FORM_DEFAULTS: { name: string; repoPath: string; mode: "existing" | "new"; branch: string; base: string; startCmd: string; address: string }`

- [ ] **Step 1: Write the failing tests**

Append to `src/worktrees/model.test.ts`:

```ts
import { branchSpecFrom, FORM_DEFAULTS } from "./model";

describe("branchSpecFrom", () => {
  it("builds a pr spec when prNumber > 0 (pr wins over mode)", () => {
    expect(branchSpecFrom({ prNumber: 42, mode: "existing", branch: "feat", base: "main" }))
      .toEqual({ kind: "pr", number: 42, branch: "feat" });
  });
  it("builds an existing spec when no pr and mode is existing", () => {
    expect(branchSpecFrom({ prNumber: 0, mode: "existing", branch: "feat", base: "main" }))
      .toEqual({ kind: "existing", branch: "feat" });
  });
  it("builds a new spec with base otherwise", () => {
    expect(branchSpecFrom({ prNumber: 0, mode: "new", branch: "feat", base: "develop" }))
      .toEqual({ kind: "new", branch: "feat", base: "develop" });
  });
});

describe("FORM_DEFAULTS", () => {
  it("provides the fresh-form defaults", () => {
    expect(FORM_DEFAULTS).toEqual({
      name: "", repoPath: "", mode: "new",
      branch: "", base: "main", startCmd: "npm run dev", address: "http://localhost:3000",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/worktrees/model.test.ts`
Expected: FAIL — `branchSpecFrom`/`FORM_DEFAULTS` not exported.

- [ ] **Step 3: Add the implementation**

In `src/worktrees/model.ts`, update the `./api` import to also bring in `BranchSpec`:

```ts
import type { DeducedWorktree, BranchSpec } from "./api";
```

Append these to the file:

```ts
// Default editable-field values for a fresh new-worktree form (single source for init + reset).
export const FORM_DEFAULTS = {
  name: "", repoPath: "", mode: "new" as "existing" | "new",
  branch: "", base: "main", startCmd: "npm run dev", address: "http://localhost:3000",
};

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/worktrees/model.test.ts`
Expected: PASS (all `branchSpecFrom` + `FORM_DEFAULTS` cases, plus the existing suite).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/worktrees/model.ts src/worktrees/model.test.ts
git commit -m "feat(worktree): pure branchSpecFrom + FORM_DEFAULTS helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire reset semantics into `NewWorktreeForm.tsx`

**Files:**
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx`

**Interfaces:**
- Consumes: `branchSpecFrom`, `FORM_DEFAULTS` from `../../worktrees/model` (Task 1).
- Produces: no exported API change — internal `clearDeduction()` / `resetForm()` callbacks + updated handlers.

- [ ] **Step 1: Import the new helpers**

In `src/tiles/worktree/NewWorktreeForm.tsx`, extend the existing model import:

```ts
import { makeWorktree, sourceLinkFrom, branchSpecFrom, FORM_DEFAULTS } from "../../worktrees/model";
```

- [ ] **Step 2: Initialise visible fields from `FORM_DEFAULTS`**

Replace the visible-field `useState` initialisers (lines for `name`/`repoPath`/`mode`/`branch`/`base`/`startCmd`/`address`) so they share the single source of truth (no behaviour change):

```ts
  const [name, setName] = useState(FORM_DEFAULTS.name);
  const [repoPath, setRepoPath] = useState(FORM_DEFAULTS.repoPath);
  const [mode, setMode] = useState<"existing" | "new">(FORM_DEFAULTS.mode);
  const [branch, setBranch] = useState(FORM_DEFAULTS.branch);
  const [base, setBase] = useState(FORM_DEFAULTS.base);
  const [startCmd, setStartCmd] = useState(FORM_DEFAULTS.startCmd);
  const [address, setAddress] = useState(FORM_DEFAULTS.address);
```

Leave `error`, `busy`, `prompt`, `deducing`, `deduceError`, `prNumber`, `sourceLink`, `banner` as-is.

- [ ] **Step 3: Add the reset callbacks**

Insert just above `runDeduce` (after the `useState` declarations):

```ts
  // clearDeduction: drop the staged-deduction unit so a stale deduction can't misroute a later Create.
  const clearDeduction = () => {
    setPrNumber(0);
    setSourceLink(null);
    setBanner(null);
    setDeduceError(null);
  };

  // resetForm: full clean slate — staged unit + visible fields back to defaults + prompt + errors.
  const resetForm = () => {
    clearDeduction();
    setName(FORM_DEFAULTS.name);
    setRepoPath(FORM_DEFAULTS.repoPath);
    setMode(FORM_DEFAULTS.mode);
    setBranch(FORM_DEFAULTS.branch);
    setBase(FORM_DEFAULTS.base);
    setStartCmd(FORM_DEFAULTS.startCmd);
    setAddress(FORM_DEFAULTS.address);
    setPrompt("");
    setError(null);
  };
```

- [ ] **Step 4: Build the spec via `branchSpecFrom` in `submit`**

In `submit`, replace the inline `BranchSpec` construction:

```ts
    const spec: BranchSpec =
      prNumber > 0 ? { kind: "pr", number: prNumber, branch }
      : mode === "existing" ? { kind: "existing", branch }
      : { kind: "new", branch, base };
```

with:

```ts
    const spec = branchSpecFrom({ prNumber, mode, branch, base });
```

(The `BranchSpec` type import on line 3 is still used by `api.ts`'s `createWorktree`; if it becomes an unused import here, drop it from this file's import to keep `tsc` clean — verify in Step 7.)

- [ ] **Step 5: Clear the unit on prompt change**

Update the prompt `<textarea>` `onChange` (currently `onChange={(e) => setPrompt(e.target.value)}`):

```tsx
        onChange={(e) => { setPrompt(e.target.value); clearDeduction(); }} />
```

- [ ] **Step 6: Full reset on cancel and reopen**

The reopen button (currently `<button onClick={() => setOpen(true)}>+ new worktree</button>`):

```tsx
    return <div style={{ padding: 6 }}><button onClick={() => { resetForm(); setOpen(true); }}>+ new worktree</button></div>;
```

The cancel button (currently `<button disabled={busy} onClick={() => setOpen(false)}>cancel</button>`):

```tsx
        <button disabled={busy} onClick={() => { resetForm(); setOpen(false); }}>cancel</button>
```

Leave `submit`'s own `setOpen(false)` on success untouched — the next reopen does the reset.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `BranchSpec` is now an unused import in this file, remove it from the `../../worktrees/api` import line and re-run.

- [ ] **Step 8: Run the full frontend suite + build**

Run: `npm test`
Expected: PASS (existing 22 JS tests + the new `branchSpecFrom`/`FORM_DEFAULTS` tests).

Run: `npm run build`
Expected: clean build.

- [ ] **Step 9: Commit**

```bash
git add src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "fix(worktree): reset staged deduction on cancel/reopen/prompt change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Clear triggers (cancel/reopen/prompt change) → Task 2 Steps 5–6. ✓
- Full reset vs unit-only → `resetForm` (cancel/reopen) vs `clearDeduction` (prompt change). ✓
- Not clearing on manual field edit → no handler added to field `onChange`s. ✓
- Pure testable seam → Task 1 `branchSpecFrom` (prNumber-leak logic) + tests. ✓
- `FORM_DEFAULTS` single source → Task 1 + Task 2 Steps 2–3. ✓
- Manual path stays working / Linear-GitHub-Slack happy paths unaffected → `runDeduce` and `submit`'s persist path unchanged; `branchSpecFrom` is behaviour-equivalent to the old inline spec. ✓
- No Rust-side change → both tasks are frontend-only. ✓

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `branchSpecFrom`/`FORM_DEFAULTS` signatures match between Task 1 (definition) and Task 2 (consumption); `mode` typed `"existing" | "new"` everywhere; `BranchSpec` import handled in Step 7.

## Acceptance

- deduce → cancel/reopen → manual Create carries no stale `prNumber`/`sourceLink`.
- deduce → prompt change (no re-deduce) → staged unit + banner gone.
- plain manual-entry path fully working.
- Linear/GitHub/Slack deduce → Create happy paths unaffected.
- `npm test`, `npx tsc --noEmit`, `npm run build` all green; human eyeballs the GUI flows.
