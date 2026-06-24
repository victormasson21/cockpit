# Existing-branch + Scratch-terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Worktrees-view slot be filled two new ways — by checking out an existing branch (still 3 panes) or by a single scratch login-shell — alongside today's deduce flow.

**Architecture:** A slot id now resolves to a *slot entity* = worktree | scratch. Scratch terminals are session-only entities (`scratch-<n>`) reusing the existing `pty_ensure` with `role="shell"`. Existing-branch reuses `BranchSpec::Existing`; the only new backend is a branch-listing command. `WorktreeColumn` becomes `SlotColumn` rendering one of two bodies.

**Tech Stack:** Tauri v2 + Rust core, React 19 + TypeScript (Vite), Zustand store, Vitest (frontend) + `cargo test` (Rust). xterm.js terminals via the unchanged `useTerminal` hook.

## Global Constraints

- **Top-of-file comment** on every new file: one concise line stating its role. **Top-of-block** comment on each significant function/wiring point. (CLAUDE.md code conventions.)
- **Smallest change that works.** No new dependencies. No React Testing Library (the repo has only pure-logic Vitest tests + manual GUI sign-off). Test pure helpers; verify components by build + manual GUI.
- **Scratch adds zero Rust.** Existing-branch adds exactly one Rust command (`list_branches`).
- **MVP = local branches only** for the branch picker (`refs/heads/`). Remote-branch checkout is deferred.
- Scratch terminals are **session-only** (not persisted to `cockpit.json`).
- Rust→JS structs that the frontend reads must serialize **camelCase** (`#[serde(rename_all = "camelCase")]`), matching `DeducedWorktree`.
- Frontend file paths use the existing tree: views in `src/views/`, worktree column in `src/views/worktree-column/`, forms in `src/tiles/worktree/`, IPC wrappers in `src/worktrees/api.ts`.

---

### Task 1: `list_branches` Rust command + pure parse

**Files:**
- Modify: `src-tauri/src/worktree.rs` (add `BranchInfo`, `parse_branch_lines`, `list_branches`, tests)
- Modify: `src-tauri/src/lib.rs:13-23` (register the command)

**Interfaces:**
- Produces (Rust): `pub fn parse_branch_lines(stdout: &str) -> Vec<BranchInfo>`; `#[tauri::command] pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String>`
- Produces (JS contract): IPC `list_branches({ repoPath })` → `BranchInfo[]` where `BranchInfo = { name: string, lastCommitRelative: string }`

- [ ] **Step 1: Write the failing parse test**

Add to the `mod tests` block in `src-tauri/src/worktree.rs`:

```rust
    #[test]
    fn parse_branch_lines_splits_tab_and_skips_blanks() {
        let out = "main\t2 hours ago\nvictor/fix\t3 days ago\n\n";
        let got = parse_branch_lines(out);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "main");
        assert_eq!(got[0].last_commit_relative, "2 hours ago");
        assert_eq!(got[1].name, "victor/fix");
        assert_eq!(got[1].last_commit_relative, "3 days ago");
    }

    #[test]
    fn parse_branch_lines_empty_is_empty() {
        assert!(parse_branch_lines("").is_empty());
        assert!(parse_branch_lines("\n  \n").is_empty());
    }

    #[test]
    fn parse_branch_lines_tolerates_missing_date() {
        let got = parse_branch_lines("orphan\n");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "orphan");
        assert_eq!(got[0].last_commit_relative, "");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test parse_branch_lines`
Expected: FAIL to compile — `cannot find function parse_branch_lines` / `cannot find type BranchInfo`.

- [ ] **Step 3: Implement `BranchInfo`, `parse_branch_lines`, and `list_branches`**

Add to `src-tauri/src/worktree.rs` (after the `BranchSpec` enum, before `slug`):

```rust
// One local branch + how long ago it was last committed to (for the recency-sorted picker).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub last_commit_relative: String,
}

// Parse `git for-each-ref` output (one `<name>\t<relative-date>` line per branch) into BranchInfo rows.
// git already sorted the input by committerdate desc, so we preserve line order. Blank lines are skipped.
pub fn parse_branch_lines(stdout: &str) -> Vec<BranchInfo> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut parts = l.splitn(2, '\t');
            BranchInfo {
                name: parts.next().unwrap_or("").to_string(),
                last_commit_relative: parts.next().unwrap_or("").to_string(),
            }
        })
        .collect()
}
```

Add this command after `create_worktree` (before the `#[cfg(test)]` block):

```rust
// List a repo's local branches, most-recently-committed first, for the "open existing branch" picker.
#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let out = Command::new("git")
        .current_dir(&repo_path)
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%09%(committerdate:relative)",
            "refs/heads/",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(parse_branch_lines(&String::from_utf8_lossy(&out.stdout)))
}
```

- [ ] **Step 4: Run the parse tests to verify they pass**

Run: `cd src-tauri && cargo test parse_branch_lines`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the command in the invoke handler**

In `src-tauri/src/lib.rs`, add `worktree::list_branches` to the `generate_handler!` list (after `worktree::create_worktree,`):

```rust
            worktree::create_worktree,
            worktree::list_branches,
            deduce::deduce_worktree
```

- [ ] **Step 6: Verify the whole crate builds + all Rust tests pass**

Run: `cd src-tauri && cargo test`
Expected: PASS, no warnings about an unused `list_branches`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/worktree.rs src-tauri/src/lib.rs
git commit -m "feat(worktree): list_branches command (recency-sorted local branches)"
```

---

### Task 2: `listBranches` IPC wrapper + `ExistingBranchForm`

**Files:**
- Modify: `src/worktrees/api.ts` (add `BranchInfo` type + `listBranches` wrapper)
- Create: `src/tiles/worktree/branchName.ts` (+ test `branchName.test.ts`) — pure name-derivation helper
- Create: `src/tiles/worktree/ExistingBranchForm.tsx`
- Create: `src/tiles/worktree/ExistingBranchForm.css`

**Interfaces:**
- Consumes: IPC `list_branches({ repoPath })` from Task 1; store `cockpit.knownRepos`, `addWorktree`, `setRepoHost`; `createWorktree(repoPath, name, spec)` and `makeWorktree` (existing); `assignNewWorktreeSlot` is called by the parent (Task 3), not here.
- Produces: `export interface BranchInfo { name: string; lastCommitRelative: string }`; `export const listBranches: (repoPath: string) => Promise<BranchInfo[]>`; `export function deriveBranchName(branch: string): string`; `export function ExistingBranchForm({ onCreated }: { onCreated: (id: string) => void }): JSX.Element`

- [ ] **Step 1: Write the failing test for `deriveBranchName`**

Create `src/tiles/worktree/branchName.test.ts`:

```ts
// branchName.test.ts — pure default-name derivation for the existing-branch form.
import { describe, it, expect } from "vitest";
import { deriveBranchName } from "./branchName";

describe("deriveBranchName", () => {
  it("uses the last path segment of a slashed branch", () => {
    expect(deriveBranchName("feature/login-fix")).toBe("login-fix");
    expect(deriveBranchName("victor/eng-1234-thing")).toBe("eng-1234-thing");
  });
  it("returns the branch unchanged when there is no slash", () => {
    expect(deriveBranchName("main")).toBe("main");
  });
  it("returns empty string for empty input", () => {
    expect(deriveBranchName("")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/tiles/worktree/branchName.test.ts`
Expected: FAIL — cannot resolve `./branchName`.

- [ ] **Step 3: Implement `deriveBranchName`**

Create `src/tiles/worktree/branchName.ts`:

```ts
// branchName.ts — derive a friendly default worktree name from a branch ref (its last path segment).
export function deriveBranchName(branch: string): string {
  return branch.split("/").pop() ?? branch;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/tiles/worktree/branchName.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the IPC wrapper + type to `api.ts`**

Append to `src/worktrees/api.ts`:

```ts
// One local branch row for the existing-branch picker (mirrors Rust BranchInfo).
export interface BranchInfo {
  name: string;
  lastCommitRelative: string;
}

// List a repo's local branches, most-recently-committed first.
export const listBranches = (repoPath: string) => invoke<BranchInfo[]>("list_branches", { repoPath });
```

- [ ] **Step 6: Implement `ExistingBranchForm`**

Create `src/tiles/worktree/ExistingBranchForm.tsx`:

```tsx
// ExistingBranchForm.tsx — pick a known repo + one of its branches (recency-sorted), then check it out as a worktree.
import { useState } from "react";
import { createWorktree, listBranches, type BranchInfo } from "../../worktrees/api";
import { makeWorktree } from "../../worktrees/model";
import { deriveBranchName } from "./branchName";
import { useSettings } from "../../settings/store";
import "./ExistingBranchForm.css";

export function ExistingBranchForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const { cockpit, addWorktree } = useSettings();
  const [repoPath, setRepoPath] = useState("");
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pickRepo: load the chosen repo's branches (recency-sorted by the backend) and reset the selection.
  const pickRepo = async (path: string) => {
    setRepoPath(path);
    setBranch("");
    setName("");
    setBranches([]);
    setError(null);
    if (!path) return;
    setLoading(true);
    try {
      setBranches(await listBranches(path));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // pickBranch: select a branch and pre-fill the (editable) worktree name from it.
  const pickBranch = (b: string) => {
    setBranch(b);
    setName(deriveBranchName(b));
  };

  // submit: check out the existing branch into a new worktree, persist the model, hand the id to the parent.
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const worktreePath = await createWorktree(repoPath, name, { kind: "existing", branch });
      const id = `wt-${Date.now()}`;
      // Reuse the repo's saved host default if present; else leave host blank (user can fill in the column later).
      const host = cockpit.knownRepos.find((r) => r.path === repoPath)?.host ?? { startCmd: "", address: "" };
      addWorktree(makeWorktree({ id, name, repoPath, branch, worktreePath, host }));
      onCreated(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eb-form">
      <select className="eb-form__repo" value={repoPath} onChange={(e) => pickRepo(e.target.value)}>
        <option value="">select repo…</option>
        {cockpit.knownRepos.map((r) => (<option key={r.path} value={r.path}>{r.path}</option>))}
      </select>
      {cockpit.knownRepos.length === 0 && (
        <div className="eb-form__hint">Add a known repo (in the New worktree form) to enable this.</div>
      )}
      {loading && <div className="eb-form__hint">loading branches…</div>}
      {repoPath && !loading && branches.length === 0 && !error && (
        <div className="eb-form__hint">no local branches found.</div>
      )}
      {branches.length > 0 && (
        <select className="eb-form__branch" value={branch} onChange={(e) => pickBranch(e.target.value)}>
          <option value="">select branch…</option>
          {branches.map((b) => (
            <option key={b.name} value={b.name}>{b.name} — {b.lastCommitRelative}</option>
          ))}
        </select>
      )}
      <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <div className="eb-form__error">{error}</div>}
      <button className="eb-form__create" disabled={busy || !repoPath || !branch || !name} onClick={submit}>
        {busy ? "creating…" : "create"}
      </button>
    </div>
  );
}
```

Create `src/tiles/worktree/ExistingBranchForm.css`:

```css
/* ExistingBranchForm.css — vertical stack mirroring NewWorktreeForm's controls. */
.eb-form { display: flex; flex-direction: column; gap: var(--space-2); }
.eb-form select, .eb-form input { font: inherit; }
.eb-form__hint { color: var(--text-muted); font-size: 0.85em; }
.eb-form__error { color: var(--attention); font-size: 0.85em; white-space: pre-wrap; }
```

- [ ] **Step 7: Verify the build typechecks + existing tests stay green**

Run: `npx tsc --noEmit && npx vitest run src/tiles/worktree/branchName.test.ts`
Expected: tsc clean; PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/worktrees/api.ts src/tiles/worktree/branchName.ts src/tiles/worktree/branchName.test.ts src/tiles/worktree/ExistingBranchForm.tsx src/tiles/worktree/ExistingBranchForm.css
git commit -m "feat(worktree): ExistingBranchForm + listBranches IPC wrapper"
```

---

### Task 3: Modal mode switch + `+ Existing branch` header button

**Files:**
- Modify: `src/views/NewWorktreeModal.tsx` (segmented control: Deduce | Existing branch; initial mode prop)
- Modify: `src/views/NewWorktreeModal` styling — add to an existing CSS file if present, else inline minimal classes (see step)
- Modify: `src/App.tsx` (second header button; track which mode to open)

**Interfaces:**
- Consumes: `NewWorktreeForm` (existing, Deduce), `ExistingBranchForm` (Task 2), store `assignNewWorktreeSlot`.
- Produces: `NewWorktreeModal` accepts `initialMode: "deduce" | "existing"`; renders the matching form, both calling `onCreated → assignNewWorktreeSlot(id) + onClose()`.

- [ ] **Step 1: Rework `NewWorktreeModal` to host both modes**

Replace `src/views/NewWorktreeModal.tsx` with:

```tsx
// NewWorktreeModal.tsx — hosts the two repo-based create flows (deduce | existing branch) behind a mode toggle.
import { useState } from "react";
import { Modal } from "./Modal";
import { NewWorktreeForm } from "../tiles/worktree/NewWorktreeForm";
import { ExistingBranchForm } from "../tiles/worktree/ExistingBranchForm";
import { useSettings } from "../settings/store";

type Mode = "deduce" | "existing";

export function NewWorktreeModal({ initialMode = "deduce", onClose }: { initialMode?: Mode; onClose: () => void }) {
  const { assignNewWorktreeSlot } = useSettings();
  const [mode, setMode] = useState<Mode>(initialMode);
  const created = (id: string) => { assignNewWorktreeSlot(id); onClose(); };
  return (
    <Modal title="New worktree" onClose={onClose}>
      {/* Mode toggle — the header button sets the initial mode; this lets the user switch without reopening. */}
      <div className="nw-modal__modes">
        <button className={mode === "deduce" ? "nw-modal__mode nw-modal__mode--active" : "nw-modal__mode"} onClick={() => setMode("deduce")}>Deduce</button>
        <button className={mode === "existing" ? "nw-modal__mode nw-modal__mode--active" : "nw-modal__mode"} onClick={() => setMode("existing")}>Existing branch</button>
      </div>
      {mode === "deduce"
        ? <NewWorktreeForm onCreated={created} />
        : <ExistingBranchForm onCreated={created} />}
    </Modal>
  );
}
```

- [ ] **Step 2: Add the mode-toggle styles**

Append to `src/views/Modal.css`:

```css
/* Mode toggle for the New-worktree modal (Deduce | Existing branch). */
.nw-modal__modes { display: flex; gap: var(--space-1); margin-bottom: var(--space-3); }
.nw-modal__mode { font: inherit; padding: var(--space-1) var(--space-2); background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.nw-modal__mode--active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
```

- [ ] **Step 3: Add the `+ Existing branch` header button + mode state in `App.tsx`**

In `src/App.tsx`, replace the `creating` state and the button + modal wiring.

Change the state declaration (line ~26):

```tsx
  const [creating, setCreating] = useState<null | "deduce" | "existing">(null);
```

Replace the single `+ New worktree` button (line ~52) with two buttons:

```tsx
        <div className="app__actions">
          <button className="app__new" onClick={() => setCreating("deduce")}>+ New worktree</button>
          <button className="app__new" onClick={() => setCreating("existing")}>+ Existing branch</button>
        </div>
```

Replace the modal render (line ~59):

```tsx
      {creating && <NewWorktreeModal initialMode={creating} onClose={() => setCreating(null)} />}
```

- [ ] **Step 4: Add `.app__actions` layout to `App.css`**

Append to `src/App.css`:

```css
/* Group the header create buttons together on the right. */
.app__actions { display: flex; gap: var(--space-2); }
```

- [ ] **Step 5: Verify build typechecks**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual GUI check (existing-branch end-to-end)**

Run: `npm run tauri dev` (or the project's launch command). Confirm: clicking **+ Existing branch** opens the modal on the Existing-branch tab; picking a known repo lists its branches newest-first; selecting one pre-fills the name; **create** adds a worktree that appears in a slot with its 3 panes. Clicking **+ New worktree** still opens on the Deduce tab and behaves exactly as before. Switching tabs inside the modal works.

- [ ] **Step 7: Commit**

```bash
git add src/views/NewWorktreeModal.tsx src/views/Modal.css src/App.tsx src/App.css
git commit -m "feat(worktrees): existing-branch modal mode + header button"
```

---

### Task 4: Scratch session state in the store

**Files:**
- Modify: `src/views/slots.ts` (rename `clearWorktree` → `clearEntity`; add `ScratchTerminal` type + `resolveSlotEntity`)
- Modify: `src/views/slots.test.ts` (rename-through + `resolveSlotEntity` tests)
- Modify: `src/settings/store.ts` (`scratchTerminals`, `scratchSeq`, `addScratch`, `removeScratch`; `removeWorktree` uses `clearEntity`)
- Modify: `src/settings/store.test.ts` (add scratch tests)

**Interfaces:**
- Produces (slots.ts): `export type ScratchTerminal = { id: string; title: string }`; `export type SlotEntity = { kind: "worktree"; worktree: Worktree } | { kind: "scratch"; scratch: ScratchTerminal } | null`; `export function clearEntity(slots: Slots, id: string): Slots`; `export function resolveSlotEntity(id: string | null, worktrees: Worktree[], scratch: ScratchTerminal[]): SlotEntity`
- Produces (store): `scratchTerminals: ScratchTerminal[]`; `addScratch: () => string`; `removeScratch: (id: string) => void`

- [ ] **Step 1: Write the failing slots tests**

In `src/views/slots.test.ts`, update the import line and add tests. Change line 3 import from `clearWorktree` to `clearEntity` and add `resolveSlotEntity`, `type ScratchTerminal`:

```ts
import { SLOT_COUNT, initSlots, setSlotAt, assignNewWorktree, clearEntity, resolveSlotEntity, type ScratchTerminal } from "./slots";
```

Rename the existing `clearWorktree` test body to call `clearEntity` (line ~30):

```ts
  it("clearEntity removes a deleted id from every slot", () => {
    expect(clearEntity(["a", "b", "a"], "a")).toEqual([null, "b", null]);
  });
```

Add new tests before the closing `});`:

```ts
  it("clearEntity also clears scratch ids", () => {
    expect(clearEntity(["scratch-1", "b", null], "scratch-1")).toEqual([null, "b", null]);
  });
  it("resolveSlotEntity finds a worktree, then a scratch, else null", () => {
    const scratch: ScratchTerminal[] = [{ id: "scratch-1", title: "Scratch 1" }];
    expect(resolveSlotEntity(null, [wt("a")], scratch)).toBeNull();
    expect(resolveSlotEntity("a", [wt("a")], scratch)).toEqual({ kind: "worktree", worktree: wt("a") });
    expect(resolveSlotEntity("scratch-1", [wt("a")], scratch)).toEqual({ kind: "scratch", scratch: scratch[0] });
    expect(resolveSlotEntity("ghost", [wt("a")], scratch)).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/views/slots.test.ts`
Expected: FAIL — `clearEntity`/`resolveSlotEntity`/`ScratchTerminal` not exported.

- [ ] **Step 3: Update `slots.ts`**

In `src/views/slots.ts`: rename `clearWorktree` to `clearEntity` (keep the body + comment, update the name in the comment to "an entity"), and append the scratch types + resolver:

```ts
// clearEntity: drop a deleted entity (worktree or scratch) from every slot referencing it.
export function clearEntity(slots: Slots, id: string): Slots {
  return slots.map((s) => (s === id ? null : s));
}

// A scratch terminal: a session-only single-shell entity that can occupy a slot (no repo/branch).
export type ScratchTerminal = { id: string; title: string };

// What a slot id resolves to: a worktree, a scratch terminal, or nothing.
export type SlotEntity =
  | { kind: "worktree"; worktree: Worktree }
  | { kind: "scratch"; scratch: ScratchTerminal }
  | null;

// resolveSlotEntity: look an id up as a worktree first, then a scratch (ids never collide — scratch is `scratch-*`).
export function resolveSlotEntity(
  id: string | null,
  worktrees: Worktree[],
  scratch: ScratchTerminal[],
): SlotEntity {
  if (!id) return null;
  const w = worktrees.find((x) => x.id === id);
  if (w) return { kind: "worktree", worktree: w };
  const s = scratch.find((x) => x.id === id);
  if (s) return { kind: "scratch", scratch: s };
  return null;
}
```

- [ ] **Step 4: Run slots tests to verify pass**

Run: `npx vitest run src/views/slots.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store tests**

Append to `src/settings/store.test.ts` (inside the existing `describe`, after the last test; the `beforeEach` already resets state — extend it to also clear scratch). First extend the `beforeEach` reset (around line 25) to include scratch fields:

```ts
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true, slots: [null, null, null], scratchTerminals: [], scratchSeq: 0 });
```

Then add tests:

```ts
  it("addScratch creates a scratch entity and auto-displays it in a slot", () => {
    const id = useSettings.getState().addScratch();
    const st = useSettings.getState();
    expect(id).toBe("scratch-1");
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.slots[0]).toBe("scratch-1");
  });

  it("removeScratch drops the entity and clears its slot", () => {
    const id = useSettings.getState().addScratch();
    useSettings.getState().removeScratch(id);
    const st = useSettings.getState();
    expect(st.scratchTerminals).toEqual([]);
    expect(st.slots).toEqual([null, null, null]);
  });
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/settings/store.test.ts`
Expected: FAIL — `addScratch`/`removeScratch` not functions; `scratchTerminals` undefined.

- [ ] **Step 7: Add scratch state to the store**

In `src/settings/store.ts`:

Update the import from `../views/slots` (line 5) to use `clearEntity` and import the type:

```ts
import { initSlots, setSlotAt, assignNewWorktree, clearEntity, type Slots, type ScratchTerminal } from "../views/slots";
```

Add to the `SettingsState` interface (after `assignNewWorktreeSlot`):

```ts
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  addScratch: () => string;
  removeScratch: (id: string) => void;
```

Add to the initial state object (after `slots: [null, null, null],`):

```ts
  scratchTerminals: [],
  scratchSeq: 0,
```

Change `removeWorktree` to use `clearEntity`:

```ts
  removeWorktree: (id) => {
    get().setCockpit((c) => ({ ...c, worktrees: c.worktrees.filter((w) => w.id !== id) }));
    set((st) => ({ slots: clearEntity(st.slots, id) }));
  },
```

Add the scratch actions (after `assignNewWorktreeSlot`):

```ts
  // Scratch terminals are session-only single-shell entities; a monotonic seq keeps ids/titles unique across removals.
  addScratch: () => {
    const n = get().scratchSeq + 1;
    const id = `scratch-${n}`;
    set((st) => ({
      scratchSeq: n,
      scratchTerminals: [...st.scratchTerminals, { id, title: `Scratch ${n}` }],
      slots: assignNewWorktree(st.slots, id),
    }));
    return id;
  },
  removeScratch: (id) =>
    set((st) => ({
      scratchTerminals: st.scratchTerminals.filter((s) => s.id !== id),
      slots: clearEntity(st.slots, id),
    })),
```

- [ ] **Step 8: Run all frontend tests to verify pass**

Run: `npx vitest run`
Expected: PASS (all suites, including the renamed `clearEntity` and new scratch tests).

- [ ] **Step 9: Commit**

```bash
git add src/views/slots.ts src/views/slots.test.ts src/settings/store.ts src/settings/store.test.ts
git commit -m "feat(worktrees): scratch-terminal session state + clearEntity rename"
```

---

### Task 5: Refactor `WorktreeColumn` → `SlotColumn` + extract `WorktreeBody` (no behavior change)

**Files:**
- Create: `src/views/worktree-column/SlotColumn.tsx` (the renamed column; for now worktree-only behavior)
- Create: `src/views/worktree-column/WorktreeBody.tsx` (extracted body)
- Delete: `src/views/worktree-column/WorktreeColumn.tsx`
- Modify: `src/views/WorktreesView.tsx`, `src/views/CalmView.tsx` (import `SlotColumn`)

**Interfaces:**
- Consumes: store `cockpit`, `slots`, `setSlot`, `removeWorktree`; `makePtyId`, `WorktreePane`, `worktreeChips`, `LinksList` (all existing); `resolveSlotEntity` (Task 4).
- Produces: `export function SlotColumn({ slotIndex, variant }: { slotIndex: number; variant?: "full" | "calm" })`; `export function WorktreeBody({ worktree, variant }: { worktree: Worktree; variant: "full" | "calm" })`

This task is a pure refactor: the app must look and behave identically. Scratch rendering is added in Task 6.

- [ ] **Step 1: Create `WorktreeBody.tsx` from the current column body**

Create `src/views/worktree-column/WorktreeBody.tsx`:

```tsx
// WorktreeBody.tsx — the worktree slot body: chips + path + 3 terminal panes (+ links in full variant).
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";

export function WorktreeBody({ worktree, variant }: { worktree: Worktree; variant: "full" | "calm" }) {
  const attention = false; // stub: live "Claude is calling" detection deferred to a provider sub-project.
  return (
    // Re-keyed by id upstream so switching the picker remounts panes (detach old, attach new) without killing PTYs.
    <div className="wt-col__body">
      {variant === "full" && (
        <>
          <div className="wt-col__chips">
            {worktreeChips(worktree).map((c, i) => (
              <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="wt-col__path">
            {worktree.repoPath.split("/").pop()} · {worktree.branch} · {worktree.worktreePath.split("/").pop()}
          </div>
        </>
      )}
      <div className="wt-col__panes">
        {variant === "full" && (
          <>
            <WorktreePane title="localhost" icon={<span className="wt-ico wt-ico--host">●</span>} worktreeId={worktree.id} role="host" cwd={worktree.worktreePath} autostartCmd={worktree.host.startCmd} />
            <WorktreePane title="git" icon={<span className="wt-ico wt-ico--git">◆</span>} worktreeId={worktree.id} role="git" cwd={worktree.worktreePath} />
          </>
        )}
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude">✳</span>}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath} autostartCmd="claude"
          badge={attention ? <span className="wt-attention">Attention</span> : null}
        />
      </div>
      {variant === "full" && <LinksList worktreeId={worktree.id} links={worktree.links} />}
    </div>
  );
}
```

- [ ] **Step 2: Create `SlotColumn.tsx` (worktree-only for now)**

Create `src/views/worktree-column/SlotColumn.tsx`:

```tsx
// SlotColumn.tsx — one Worktrees-view column: picker + gear menu over a slot's entity body (worktree today; scratch in Task 6).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { resolveSlotEntity } from "../slots";
import { WorktreeBody } from "./WorktreeBody";
import "./WorktreeColumn.css";

const WORKTREE_ROLES = ["git", "host", "claude"] as const;

export function SlotColumn({ slotIndex, variant = "full" }: { slotIndex: number; variant?: "full" | "calm" }) {
  const { cockpit, slots, setSlot, removeWorktree, scratchTerminals } = useSettings();
  const ongoing = cockpit.worktrees.filter((w) => w.status === "ongoing");
  const activeId = slots[slotIndex];
  const entity = resolveSlotEntity(activeId, cockpit.worktrees, scratchTerminals);
  const [menuOpen, setMenuOpen] = useState(false);

  // deleteActive: stop the entity's PTY(s), then drop the model (the store also clears it from this slot).
  const deleteActive = async () => {
    if (!entity) return;
    setMenuOpen(false);
    if (entity.kind === "worktree") {
      for (const role of WORKTREE_ROLES) await invoke("pty_kill", { ptyId: makePtyId(entity.worktree.id, role) });
      removeWorktree(entity.worktree.id);
    }
  };

  const attention = false; // stub: live "Claude is calling" detection deferred to a provider sub-project.

  return (
    <div className="wt-col">
      <div className="wt-col__header">
        <span className={attention ? "wt-col__dot wt-col__dot--attention" : "wt-col__dot"} />
        <div className="wt-col__picker-wrap">
          <select className="wt-col__picker" value={activeId ?? ""} onChange={(e) => setSlot(slotIndex, e.target.value || null)}>
            <option value="">Select worktree</option>
            {ongoing.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
          <span className="wt-col__caret" aria-hidden>⌄</span>
        </div>
        {entity && (
          <div className="wt-col__menu">
            <button className="wt-col__gear" aria-label="column settings" onClick={() => setMenuOpen((o) => !o)}>⚙</button>
            {menuOpen && (
              <div className="wt-col__menu-pop" onMouseLeave={() => setMenuOpen(false)}>
                <button onClick={() => { setSlot(slotIndex, null); setMenuOpen(false); }}>Hide</button>
                <button className="wt-col__danger" onClick={deleteActive}>Delete</button>
              </div>
            )}
          </div>
        )}
      </div>

      {!entity ? (
        <div className="wt-col__empty">No worktree in this slot.</div>
      ) : entity.kind === "worktree" ? (
        // Key on the component (not a wrapper div) so the remount preserves the .wt-col → .wt-col__body flex chain.
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Point the views at `SlotColumn` and delete the old file**

In `src/views/WorktreesView.tsx`, replace the import + usage:

```tsx
import { SlotColumn } from "./worktree-column/SlotColumn";
```
```tsx
        <SlotColumn key={i} slotIndex={i} />
```

In `src/views/CalmView.tsx`, same:

```tsx
import { SlotColumn } from "./worktree-column/SlotColumn";
```
```tsx
        <SlotColumn key={i} slotIndex={i} variant="calm" />
```

Delete the old column:

```bash
git rm src/views/worktree-column/WorktreeColumn.tsx
```

- [ ] **Step 4: Verify typecheck + build + existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests PASS.

- [ ] **Step 5: Manual GUI check (no visible change)**

Run the app. Worktrees + Calm views render and behave exactly as before — picker selects worktrees, Hide/Delete work, panes stream. This step guards the refactor.

- [ ] **Step 6: Commit**

```bash
git add src/views/worktree-column/SlotColumn.tsx src/views/worktree-column/WorktreeBody.tsx src/views/WorktreesView.tsx src/views/CalmView.tsx
git commit -m "refactor(worktrees): WorktreeColumn -> SlotColumn + extracted WorktreeBody"
```

---

### Task 6: Scratch rendering in `SlotColumn` + picker optgroup + scratch delete

**Files:**
- Create: `src/views/worktree-column/ScratchBody.tsx`
- Modify: `src/views/worktree-column/SlotColumn.tsx` (scratch body branch, scratch optgroup in picker, scratch-delete dispatch)

**Interfaces:**
- Consumes: `WorktreePane` (role `"shell"`), `homeDir` from `@tauri-apps/api/path`, store `scratchTerminals` + `removeScratch`, `makePtyId`.
- Produces: `export function ScratchBody({ scratchId }: { scratchId: string }): JSX.Element | null`

- [ ] **Step 1: Implement `ScratchBody`**

Create `src/views/worktree-column/ScratchBody.tsx`:

```tsx
// ScratchBody.tsx — a slot holding a single scratch login-shell pane (no repo/branch, no chips/path/links).
import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { WorktreePane } from "./WorktreePane";

export function ScratchBody({ scratchId }: { scratchId: string }) {
  // The shell needs a real cwd; default it to the user's home (resolved once via the Tauri path API).
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => { homeDir().then(setHome).catch(() => setHome("")); }, []);
  if (home === null) return <div className="wt-col__empty">starting terminal…</div>;
  return (
    <div className="wt-col__body">
      <div className="wt-col__panes">
        <WorktreePane title="Terminal" icon={<span className="wt-ico wt-ico--host">●</span>} worktreeId={scratchId} role="shell" cwd={home} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire scratch into `SlotColumn`**

In `src/views/worktree-column/SlotColumn.tsx`:

Add the import:

```tsx
import { ScratchBody } from "./ScratchBody";
```

Pull `removeScratch` from the store (extend the destructure):

```tsx
  const { cockpit, slots, setSlot, removeWorktree, removeScratch, scratchTerminals } = useSettings();
```

Extend `deleteActive` to handle scratch:

```tsx
  const deleteActive = async () => {
    if (!entity) return;
    setMenuOpen(false);
    if (entity.kind === "worktree") {
      for (const role of WORKTREE_ROLES) await invoke("pty_kill", { ptyId: makePtyId(entity.worktree.id, role) });
      removeWorktree(entity.worktree.id);
    } else {
      await invoke("pty_kill", { ptyId: makePtyId(entity.scratch.id, "shell") });
      removeScratch(entity.scratch.id);
    }
  };
```

Replace the picker `<select>` body with grouped options (placeholder + Worktrees optgroup + Scratch optgroup):

```tsx
          <select className="wt-col__picker" value={activeId ?? ""} onChange={(e) => setSlot(slotIndex, e.target.value || null)}>
            <option value="">Select…</option>
            <optgroup label="Worktrees">
              {ongoing.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
            </optgroup>
            {scratchTerminals.length > 0 && (
              <optgroup label="Scratch">
                {scratchTerminals.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
              </optgroup>
            )}
          </select>
```

Replace the body render (the `{!entity ? … : entity.kind === "worktree" ? … : null}` block) with:

```tsx
      {!entity ? (
        <div className="wt-col__empty">Nothing in this slot.</div>
      ) : entity.kind === "worktree" ? (
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} />
      ) : (
        <ScratchBody key={entity.scratch.id} scratchId={entity.scratch.id} />
      )}
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/views/worktree-column/ScratchBody.tsx src/views/worktree-column/SlotColumn.tsx
git commit -m "feat(worktrees): render scratch terminals in slots + picker optgroup"
```

---

### Task 7: `+ Terminal` header button (end-to-end scratch)

**Files:**
- Modify: `src/App.tsx` (third header button → `addScratch`)

**Interfaces:**
- Consumes: store `addScratch` (Task 4).
- Produces: nothing downstream — this is the final wiring.

- [ ] **Step 1: Add the button**

In `src/App.tsx`, pull `addScratch` from the store (extend the existing destructure near line 24):

```tsx
  const { loaded, init, addScratch } = useSettings();
```

Add the button inside `.app__actions` (after the Existing-branch button):

```tsx
          <button className="app__new" onClick={() => addScratch()}>+ Terminal</button>
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual GUI check (scratch end-to-end)**

Run the app. Clicking **+ Terminal** immediately fills a slot (first empty, else displaces the last) with a single "Terminal" pane running an interactive shell — type `pwd` (shows home), `ls`, `cd` into a repo. The slot's picker lists it under **Scratch**; **Hide** frees the slot but keeps it selectable; re-selecting it from another slot's picker reattaches the same shell; **Delete** kills it and removes it from the pickers. Worktree slots are unaffected.

- [ ] **Step 4: Final full verification**

Run: `npx tsc --noEmit && npx vitest run && (cd src-tauri && cargo test)`
Expected: tsc clean; all frontend tests PASS; all Rust tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(worktrees): + Terminal button spawns a scratch shell into a slot"
```

---

## Notes for the implementer

- **`makePtyId(id, role)`** produces `"<id>:<role>"`; a scratch's pty is `scratch-<n>:shell`, distinct from every worktree pty. `pty_ensure` with `role="shell"` and no `autostartCmd` spawns a plain login shell (only `host`/`claude` autostart).
- **Same scratch in two slots simultaneously** is not specially handled — it inherits today's worktree behavior (two panes attaching one PTY). Don't add logic for it.
- **A branch already checked out in the main repo** makes `git worktree add` fail; that stderr surfaces inline in `ExistingBranchForm` (the `error` state). This is expected, not a bug to pre-empt.
- If `homeDir()` ever rejects with a permission error, add `"core:path:default"` to `src-tauri/capabilities/default.json` — but `core:default` already includes it, so this shouldn't happen.

## Out of scope (deferred — do not build)

- Remote-branch checkout in the picker (tracking-branch logic).
- Persisting scratch terminals across restarts.
- Live branch-status decoration (ahead/behind, author) in the picker.
- Renaming a scratch terminal.
- Live Claude "Attention" detection (still a stub).
