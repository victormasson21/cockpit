# Session Restore + Clean Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitting cockpit stops every process it started, and reopening it restores the same tiles, the same panes, a running dev server, and a continued Claude conversation.

**Architecture:** One new `Option<Workspace>` block in `cockpit.json` holds the slot arrangement, scratch terminals and per-worktree pane sets. Session state in the Zustand store stays the single source of truth — the block is composed at *save* time by a pure helper, and restored at load time by another. Shutdown is a single Rust `RunEvent::Exit` hook calling a new `PtyManager::kill_all()`.

**Tech Stack:** Rust (Tauri v2.11, portable-pty, serde), React 19 + TypeScript, Zustand, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-07-29-session-restore-and-clean-shutdown-design.md`

## Global Constraints

- **No new dependencies** (neither npm nor cargo). Everything here uses what is already vendored.
- **Comment conventions (`CLAUDE.md`):** every new file opens with a one-line role comment; every
  non-obvious block gets a concise "what and why" line. Explain intent, never syntax.
- **Smallest change that works.** No refactoring beyond what a task needs.
- **Frontend tests:** `npx vitest run` (from the repo root). **Rust tests:** `cargo test` from `src-tauri/`.
- **Builds must stay clean:** `npm run build` (runs `tsc` first) and `cargo build` from `src-tauri/`.
- **Back-compat is mandatory:** an existing `cockpit.json` with no `workspace` field must load and behave
  exactly as today (first 3 ongoing worktrees in the slots).
- **Never persist:** attention flags, pending worktrees, the timer, `initialPromptPending`, or the new
  `restoredWorktrees` flag. These stay session-only.
- Branch is already created: `session-restore-clean-shutdown` (off `main`). Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/pty.rs` | **Modify** — add `PtyManager::kill_all()` beside the existing `pty_kill` command. |
| `src-tauri/src/lib.rs` | **Modify** — build the app, then run it with a `RunEvent::Exit` hook. |
| `src-tauri/src/settings.rs` | **Modify** — `Workspace` / `PaneSet` / `ScratchTerminal` serde structs + the `workspace` field on `CockpitConfig`. |
| `src/settings/types.ts` | **Modify** — the matching TS `WorkspaceState` + `workspace?` field. |
| `src/settings/workspace.ts` | **Create** — pure snapshot/restore helpers. All the arrangement logic lives here, so the store stays wiring. |
| `src/settings/workspace.test.ts` | **Create** — unit tests for those helpers. |
| `src/settings/store.ts` | **Modify** — restore on `init`, compose on save, `setSession` wrapper, `restoredWorktrees` slice, `setDefaultView`. |
| `src/settings/store.test.ts` | **Modify** — restore/fallback/persistence regressions. |
| `src/worktrees/claudeCmd.ts` | **Modify** — `restored` → `claude --continue \|\| claude`. |
| `src/worktrees/claudeCmd.test.ts` | **Modify** — precedence cases. |
| `src/views/worktree-column/WorktreeBody.tsx` | **Modify** — read the restored flag, clear it on first spawn. |
| `src/App.tsx` | **Modify** — persist the active view on switch. |
| `CLAUDE.md`, `docs/ROADMAP.md` | **Modify** — as-built note; delete the two now-shipped backlog items. |

---

### Task 1: Kill every PTY on app exit

**Files:**
- Modify: `src-tauri/src/pty.rs` (add `kill_all` after `pty_kill`, ~line 141; add a test in the existing `mod tests`)
- Modify: `src-tauri/src/lib.rs:17-54` (builder → build + run with an event hook)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `PtyManager::kill_all(&self) -> usize` — kills and deregisters every live PTY, returning how many were killed.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `mod tests` in `src-tauri/src/pty.rs`. It spawns a real long-lived PTY, registers
it by hand (the `pty_ensure` command needs an `AppHandle`, which a unit test has no cheap way to build),
then asserts both observable effects: the registry is drained, and a reader cloned from the master
completes instead of blocking forever — which only happens once the child is actually dead.

```rust
    // kill_all must both deregister and really kill: a reader cloned off the master only completes
    // (EOF, or EIO on macOS) once the child is gone, so a live child would time out here.
    #[test]
    fn kill_all_drains_the_registry_and_kills_the_child() {
        use std::time::Duration;
        let manager = PtyManager::default();
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = CommandBuilder::new("sleep");
        cmd.arg("60");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        manager.table.lock().unwrap().insert(
            pty_id("wt-test", "claude"),
            LivePty { master: pair.master, child, writer, scrollback: Arc::new(Mutex::new(Vec::new())) },
        );

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 64];
            // Err (EIO) and Ok(0) both mean "the pty is finished"; either ends the read.
            let _ = tx.send(reader.read(&mut buf).unwrap_or(0));
        });

        assert_eq!(manager.kill_all(), 1);
        assert!(manager.table.lock().unwrap().is_empty());
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 0, "child should be dead");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test kill_all`
Expected: FAIL — compile error, `no method named 'kill_all' found for struct 'PtyManager'`.

- [ ] **Step 3: Write minimal implementation**

Insert into `src-tauri/src/pty.rs` immediately after the `PtyManager` struct definition (turn it into an
`impl` block below the `#[derive(Default)] pub struct PtyManager { … }`):

```rust
impl PtyManager {
    // Stop every live PTY (app shutdown). Killing the login shell is not enough on its own: dropping
    // the master closes its fd, which makes the kernel SIGHUP the pty's foreground process group —
    // that is what reaches grandchildren like `claude` or a `npm run dev` server. Returns the count killed.
    pub fn kill_all(&self) -> usize {
        let mut table = self.table.lock().unwrap();
        let n = table.len();
        for (_, mut pty) in table.drain() {
            let _ = pty.child.kill();
        }
        n
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test kill_all`
Expected: PASS (1 test).

- [ ] **Step 5: Hook it into app shutdown**

In `src-tauri/src/lib.rs`, add `use tauri::Manager;` under the `mod` declarations, then replace the
trailing `.run(tauri::generate_context!()).expect(…)` with a build + run pair:

```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // On the way out, stop everything we spawned. RunEvent::Exit covers both Cmd+Q and closing
        // the last window, and fires before the process goes away.
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                handle.state::<pty::PtyManager>().kill_all();
            }
        });
```

- [ ] **Step 6: Verify the build is clean**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: `Finished` with no warnings about `lib.rs`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat: kill every PTY when the app exits"
```

---

### Task 2: Persist the `workspace` block (Rust serde)

**Files:**
- Modify: `src-tauri/src/settings.rs` (new structs before `CockpitConfig` ~line 154; new field on
  `CockpitConfig`; `Default` impl ~line 182; tests in `mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `CockpitConfig.workspace: Option<Workspace>` serialised as `"workspace"`, with
  `Workspace { slots: Vec<Option<String>>, scratch: Vec<ScratchTerminal>, scratch_seq: u32 ("scratchSeq"), panes: HashMap<String, PaneSet> }`
  and `PaneSet { host: bool, extras: Vec<String>, seq: u32, open: HashMap<String, bool> }`.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/settings.rs`:

```rust
    // Pre-feature files have no workspace block at all: that ABSENCE is what selects the old
    // "first 3 ongoing worktrees" seeding in the frontend, so it must stay None (not a default struct).
    #[test]
    fn cockpit_without_workspace_field_loads_as_none() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.workspace, None);
        assert!(!serde_json::to_string(&cfg).unwrap().contains("workspace"));
    }

    // A present-but-empty arrangement ("the user closed every column") must survive the round trip
    // as Some([]) — distinguishable from absent.
    #[test]
    fn empty_workspace_slots_round_trip_as_some() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"workspace":{"slots":[],"scratch":[],"scratchSeq":0,"panes":{}},"preferences":{"theme":"system","defaultView":"worktrees"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        let ws = cfg.workspace.clone().unwrap();
        assert!(ws.slots.is_empty());
        let again: CockpitConfig = serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
        assert_eq!(again.workspace, cfg.workspace);
    }

    #[test]
    fn workspace_round_trips_slots_scratch_and_panes() {
        let json = r#"{"version":1,"tiles":[],"worktrees":[],"workspace":{"slots":["wt-1",null,"scratch-1"],"scratch":[{"id":"scratch-1","title":"Scratch 1"}],"scratchSeq":1,"panes":{"wt-1":{"host":true,"extras":["shell-1"],"seq":1,"open":{"claude":true,"shell-1":false}}}},"preferences":{"theme":"system","defaultView":"worktrees"}}"#;
        let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
        let ws = cfg.workspace.unwrap();
        assert_eq!(ws.slots, vec![Some("wt-1".to_string()), None, Some("scratch-1".to_string())]);
        assert_eq!(ws.scratch[0].title, "Scratch 1");
        assert_eq!(ws.scratch_seq, 1);
        let panes = &ws.panes["wt-1"];
        assert!(panes.host);
        assert_eq!(panes.extras, vec!["shell-1"]);
        assert_eq!(panes.seq, 1);
        assert_eq!(panes.open["shell-1"], false);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test workspace`
Expected: FAIL — compile error, `no field 'workspace' on type 'CockpitConfig'`.

- [ ] **Step 3: Write minimal implementation**

Add above `CockpitConfig` in `src-tauri/src/settings.rs`:

```rust
// A session-only scratch terminal (login shell, no repo), persisted so a restored slot holding one resolves.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScratchTerminal {
    pub id: String,
    pub title: String,
}

// One worktree's live pane set: whether the Run/host pane exists, the extra shells, the monotonic role
// counter, and each pane's collapse state. Mirrors WorktreePaneSet in src/worktrees/paneSet.ts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaneSet {
    pub host: bool,
    pub extras: Vec<String>,
    pub seq: u32,
    pub open: std::collections::HashMap<String, bool>,
}

// Session-restore state: which entity sits in which Worktrees column (None = a shown-but-empty column),
// the live scratch terminals, and each worktree's pane set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workspace {
    #[serde(default)]
    pub slots: Vec<Option<String>>,
    #[serde(default)]
    pub scratch: Vec<ScratchTerminal>,
    #[serde(rename = "scratchSeq", default)]
    pub scratch_seq: u32,
    #[serde(default)]
    pub panes: std::collections::HashMap<String, PaneSet>,
}
```

Add the field to `CockpitConfig`, next to `cockpit_worktree_id`:

```rust
    // The previous session's arrangement (slots / scratch / pane sets). Option, NOT #[serde(default)]:
    // absent means "pre-feature file, seed the slots the old way", while Some with empty slots means
    // "the user really had every column closed".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<Workspace>,
```

And `workspace: None,` to the `Default for CockpitConfig` impl (alongside `cockpit_worktree_id: None,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: PASS — all existing tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat: add the optional workspace block to cockpit.json"
```

---

### Task 3: Pure snapshot/restore helpers

**Files:**
- Modify: `src/settings/types.ts` (add `WorkspaceState`; add `workspace?` to `CockpitConfig`)
- Create: `src/settings/workspace.ts`
- Create: `src/settings/workspace.test.ts`

**Interfaces:**
- Consumes: `Slots`, `ScratchTerminal`, `SLOT_COUNT` from `src/views/slots.ts`; `WorktreePaneSet` from
  `src/worktrees/paneSet.ts`; `CockpitConfig`, `Worktree` from `./types`.
- Produces:
  - `type WorkspaceSession = { slots: Slots; scratchTerminals: ScratchTerminal[]; scratchSeq: number; worktreePanes: Record<string, WorktreePaneSet> }`
  - `workspaceSnapshot(s: WorkspaceSession): WorkspaceState`
  - `withWorkspace(cockpit: CockpitConfig, s: WorkspaceSession): CockpitConfig`
  - `restoreWorkspace(ws: WorkspaceState, worktrees: Worktree[], mintKey: () => string, cockpitWorktreeId?: string): WorkspaceSession & { restoredWorktrees: Record<string, true> }`

- [ ] **Step 1: Add the TS types**

In `src/settings/types.ts`, add two type-only imports at the top (both erased at build time, so no new
runtime coupling) and the `WorkspaceState` interface above `CockpitConfig`:

```ts
import type { WorktreePaneSet } from "../worktrees/paneSet";
import type { ScratchTerminal } from "../views/slots";

// The previous session's arrangement (mirrors the Rust Workspace struct). `slots` holds entity ids in
// column order; null = a shown-but-empty column. Absent from the config entirely on a pre-feature file.
export interface WorkspaceState {
  slots: (string | null)[];
  scratch: ScratchTerminal[];
  scratchSeq: number;
  panes: Record<string, WorktreePaneSet>;
}
```

and the field on `CockpitConfig`, after `cockpitWorktreeId?: string;`:

```ts
  workspace?: WorkspaceState;
```

- [ ] **Step 2: Write the failing tests**

Create `src/settings/workspace.test.ts`:

```ts
// workspace.test.ts — pure snapshot/restore of the persisted session-restore block.
import { describe, it, expect } from "vitest";
import { workspaceSnapshot, withWorkspace, restoreWorkspace } from "./workspace";
import type { CockpitConfig, WorkspaceState, Worktree } from "./types";
import { EMPTY_PANE_SET } from "../worktrees/paneSet";

const wt = (id: string): Worktree => ({
  id, name: id, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status: "ongoing",
});
const minter = () => { let n = 0; return () => `k${++n}`; };
const paneSet = { host: true, extras: ["shell-1"], seq: 1, open: { claude: true, host: true, "shell-1": false } };
const baseCockpit: CockpitConfig = {
  version: 1, tiles: [], worktrees: [], knownRepos: [], todos: [],
  preferences: { theme: "system", defaultView: "worktrees" },
};

describe("workspaceSnapshot", () => {
  it("keeps slot ids in column order (empty columns included) and drops the keys", () => {
    const snap = workspaceSnapshot({
      slots: [{ key: "k1", id: "wt-1" }, { key: "k2", id: null }, { key: "k3", id: "scratch-1" }],
      scratchTerminals: [{ id: "scratch-1", title: "Scratch 1" }],
      scratchSeq: 1,
      worktreePanes: { "wt-1": paneSet },
    });
    expect(snap).toEqual({
      slots: ["wt-1", null, "scratch-1"],
      scratch: [{ id: "scratch-1", title: "Scratch 1" }],
      scratchSeq: 1,
      panes: { "wt-1": paneSet },
    });
  });
});

describe("withWorkspace", () => {
  it("injects the block without touching other config fields or mutating the input", () => {
    const session = { slots: [{ key: "k1", id: "wt-1" }], scratchTerminals: [], scratchSeq: 0, worktreePanes: {} };
    const out = withWorkspace(baseCockpit, session);
    expect(out.workspace).toEqual({ slots: ["wt-1"], scratch: [], scratchSeq: 0, panes: {} });
    expect(out.version).toBe(1);
    expect(baseCockpit.workspace).toBeUndefined();
  });
});

describe("restoreWorkspace", () => {
  const ws: WorkspaceState = {
    slots: ["wt-1", null, "scratch-1"],
    scratch: [{ id: "scratch-1", title: "Scratch 1" }],
    scratchSeq: 1,
    panes: { "wt-1": paneSet },
  };

  it("restores ids in column order with freshly minted keys", () => {
    const r = restoreWorkspace(ws, [wt("wt-1")], minter());
    expect(r.slots).toEqual([{ key: "k1", id: "wt-1" }, { key: "k2", id: null }, { key: "k3", id: "scratch-1" }]);
    expect(r.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
  });

  it("turns an id that no longer resolves into an empty column, keeping the column", () => {
    const r = restoreWorkspace({ ...ws, slots: ["wt-gone", "wt-1"] }, [wt("wt-1")], minter());
    expect(r.slots.map((s) => s.id)).toEqual([null, "wt-1"]);
  });

  it("restores an all-columns-closed arrangement faithfully", () => {
    const r = restoreWorkspace({ slots: [], scratch: [], scratchSeq: 0, panes: {} }, [wt("wt-1")], minter());
    expect(r.slots).toEqual([]);
  });

  it("caps the restored columns at SLOT_COUNT", () => {
    const r = restoreWorkspace({ ...ws, slots: ["wt-1", "wt-1", "wt-1", "wt-1"] }, [wt("wt-1")], minter());
    expect(r.slots).toHaveLength(3);
  });

  it("lifts scratchSeq above the highest restored scratch id so ids cannot collide", () => {
    const r = restoreWorkspace(
      { ...ws, slots: [], scratch: [{ id: "scratch-7", title: "Scratch 7" }], scratchSeq: 1 },
      [], minter(),
    );
    expect(r.scratchSeq).toBe(7);
  });

  it("prunes pane sets whose worktree is gone", () => {
    const r = restoreWorkspace({ ...ws, panes: { "wt-1": paneSet, "wt-gone": EMPTY_PANE_SET } }, [wt("wt-1")], minter());
    expect(Object.keys(r.worktreePanes)).toEqual(["wt-1"]);
  });

  it("marks every restored worktree — slot ids, pane keys and the cockpit pin", () => {
    const r = restoreWorkspace(
      { ...ws, slots: ["wt-1"], panes: { "wt-2": paneSet } },
      [wt("wt-1"), wt("wt-2"), wt("wt-3")], minter(), "wt-3",
    );
    expect(r.restoredWorktrees).toEqual({ "wt-1": true, "wt-2": true, "wt-3": true });
  });

  it("never marks a scratch id (only worktrees have a claude pane)", () => {
    const r = restoreWorkspace(ws, [wt("wt-1")], minter());
    expect(r.restoredWorktrees).toEqual({ "wt-1": true });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/settings/workspace.test.ts`
Expected: FAIL — `Failed to resolve import "./workspace"`.

- [ ] **Step 4: Write minimal implementation**

Create `src/settings/workspace.ts`:

```ts
// workspace.ts — pure snapshot/restore of the persisted `workspace` block (which tile shows what, which
// panes are live). Session state stays the source of truth; this is the only place it meets the file.
import type { CockpitConfig, WorkspaceState, Worktree } from "./types";
import type { ScratchTerminal, Slots } from "../views/slots";
import { SLOT_COUNT } from "../views/slots";
import type { WorktreePaneSet } from "../worktrees/paneSet";

// The slice of store state the block is composed from (structurally satisfied by SettingsState).
export type WorkspaceSession = {
  slots: Slots;
  scratchTerminals: ScratchTerminal[];
  scratchSeq: number;
  worktreePanes: Record<string, WorktreePaneSet>;
};

// Session state → the persisted block. Slot `key`s are React reconciliation identity, so only ids travel.
export function workspaceSnapshot(s: WorkspaceSession): WorkspaceState {
  return {
    slots: s.slots.map((slot) => slot.id),
    scratch: s.scratchTerminals,
    scratchSeq: s.scratchSeq,
    panes: s.worktreePanes,
  };
}

// Compose the block into the config being written. Called at save time so the in-memory cockpit never
// carries a second copy of the session state that could drift out of sync.
export function withWorkspace(cockpit: CockpitConfig, s: WorkspaceSession): CockpitConfig {
  return { ...cockpit, workspace: workspaceSnapshot(s) };
}

// Highest n across `scratch-<n>` ids; guards against a hand-edited seq minting a colliding id.
function highestScratchN(scratch: ScratchTerminal[]): number {
  return scratch.reduce((max, s) => {
    const n = Number(s.id.replace(/^scratch-/, ""));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
}

// The persisted block → session state. An id that no longer resolves becomes an empty column (the column
// count is what the user left, and an empty slot already renders a picker); pane sets for vanished
// worktrees are dropped; every restored worktree is flagged so its claude pane resumes exactly once.
export function restoreWorkspace(
  ws: WorkspaceState,
  worktrees: Worktree[],
  mintKey: () => string,
  cockpitWorktreeId?: string,
): WorkspaceSession & { restoredWorktrees: Record<string, true> } {
  const scratchTerminals = ws.scratch ?? [];
  const scratchIds = new Set(scratchTerminals.map((s) => s.id));
  const worktreeIds = new Set(worktrees.map((w) => w.id));
  const slots: Slots = (ws.slots ?? []).slice(0, SLOT_COUNT).map((id) => ({
    key: mintKey(),
    id: id && (worktreeIds.has(id) || scratchIds.has(id)) ? id : null,
  }));
  const worktreePanes = Object.fromEntries(
    Object.entries(ws.panes ?? {}).filter(([id]) => worktreeIds.has(id)),
  );
  // Restored = every worktree the arrangement brings back, wherever it shows (slot, Cockpit pin, or
  // just a live pane set) — a Claude-only worktree has no `panes` entry, so slots must be included.
  const restored = [...slots.map((s) => s.id), ...Object.keys(worktreePanes), cockpitWorktreeId]
    .filter((id): id is string => !!id && worktreeIds.has(id));
  return {
    slots,
    scratchTerminals,
    scratchSeq: Math.max(ws.scratchSeq ?? 0, highestScratchN(scratchTerminals)),
    worktreePanes,
    restoredWorktrees: Object.fromEntries(restored.map((id) => [id, true as const])),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/settings/workspace.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/settings/types.ts src/settings/workspace.ts src/settings/workspace.test.ts
git commit -m "feat: pure snapshot/restore helpers for the workspace block"
```

---

### Task 4: Wire the store — restore on load, persist on change

**Files:**
- Modify: `src/settings/store.ts` (imports; `create` body; `scheduleSave`; `init`; every session-mutating action)
- Modify: `src/settings/store.test.ts` (append new `describe` blocks)

**Interfaces:**
- Consumes: `workspaceSnapshot` / `withWorkspace` / `restoreWorkspace` from `./workspace` (Task 3).
- Produces on the store: `restoredWorktrees: Record<string, true>`, `clearRestored(id: string): void`,
  `setDefaultView(v: View): void`. All session-mutating actions now schedule a disk write.

- [ ] **Step 1: Write the failing tests**

Append to `src/settings/store.test.ts`. Note the first line of the file's existing mock block already
mocks `./api`; add `import { saveSettings } from "./api";` under the existing imports so the mock can be
asserted on.

```ts
describe("session restore", () => {
  const layout = { version: 1, views: {} };
  const three: Worktree[] = [sampleWt, { ...sampleWt, id: "wt-2" }, { ...sampleWt, id: "wt-3" }];

  // The store is module-global and `init` only writes the keys its branch owns — the fallback branch
  // deliberately leaves scratch/panes/restored alone. Reset here or an earlier test leaks into the next.
  beforeEach(() => {
    useSettings.setState({
      slots: [], slotSeq: 0, scratchTerminals: [], scratchSeq: 0,
      worktreePanes: {}, restoredWorktrees: {},
    });
  });

  it("init restores the persisted arrangement instead of the first-ongoing default", () => {
    const cockpit: CockpitConfig = {
      ...structuredClone(baseCockpit),
      worktrees: three,
      workspace: {
        slots: ["wt-3", null],
        scratch: [{ id: "scratch-1", title: "Scratch 1" }],
        scratchSeq: 1,
        panes: { "wt-3": { host: true, extras: [], seq: 0, open: {} } },
      },
    };
    useSettings.getState().init({ cockpit, layout });
    const st = useSettings.getState();
    expect(slotIds()).toEqual(["wt-3", null]);
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.worktreePanes["wt-3"].host).toBe(true);
    expect(st.restoredWorktrees).toEqual({ "wt-3": true });
  });

  it("init falls back to the first ongoing worktrees when the file has no workspace block", () => {
    const cockpit: CockpitConfig = { ...structuredClone(baseCockpit), worktrees: three };
    useSettings.getState().init({ cockpit, layout });
    expect(slotIds()).toEqual(["wt-1", "wt-2", "wt-3"]);
    expect(useSettings.getState().restoredWorktrees).toEqual({});
  });

  it("clearRestored drops one flag and no-ops on an unflagged id", () => {
    useSettings.setState({ restoredWorktrees: { "wt-1": true } });
    const before = useSettings.getState().restoredWorktrees;
    useSettings.getState().clearRestored("wt-9");
    expect(useSettings.getState().restoredWorktrees).toBe(before); // referentially unchanged
    useSettings.getState().clearRestored("wt-1");
    expect(useSettings.getState().restoredWorktrees).toEqual({});
  });

  // A session-only change (no setCockpit call) must still reach disk, or the arrangement is lost.
  it("a slots-only change schedules a save carrying the workspace block", () => {
    vi.useFakeTimers();
    vi.mocked(saveSettings).mockClear();
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout });
    useSettings.getState().addEmptySlot();
    vi.advanceTimersByTime(600);
    const written = vi.mocked(saveSettings).mock.calls.at(-1)![0];
    expect(written.cockpit.workspace).toEqual({ slots: [null], scratch: [], scratchSeq: 0, panes: {} });
    vi.useRealTimers();
  });

  it("setDefaultView persists the active view as the launch view", () => {
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout });
    useSettings.getState().setDefaultView("cockpit");
    expect(useSettings.getState().cockpit.preferences.defaultView).toBe("cockpit");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings/store.test.ts`
Expected: FAIL — `restoredWorktrees` undefined / `clearRestored is not a function`.

- [ ] **Step 3: Add the imports and the state declarations**

In `src/settings/store.ts`, extend the `./workspace` import and the interface:

```ts
import { restoreWorkspace, withWorkspace } from "./workspace";
```

Add to `interface SettingsState`, next to `initialPromptPending`:

```ts
  // Session-only "this worktree came back from the previous session" flags, keyed by worktree id.
  // Read by the claude pane to resume the conversation; cleared on its first spawn. Not persisted.
  restoredWorktrees: Record<string, true>;
  clearRestored: (id: string) => void;
  setDefaultView: (v: View) => void;
```

and the initial value next to `initialPromptPending: {},`:

```ts
  restoredWorktrees: {},
```

- [ ] **Step 4: Compose the workspace block at save time**

Replace the body of `scheduleSave` in `src/settings/store.ts:108-114`:

```ts
function scheduleSave(get: () => SettingsState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = get();
    // The workspace block is composed HERE, from live session state, so the in-memory cockpit never
    // holds a copy that could drift out of sync with the slots/panes actually on screen.
    saveSettings({ cockpit: withWorkspace(st.cockpit, st), layout: st.layout })
      .catch((e) => console.error("save failed", e));
  }, 500);
}
```

- [ ] **Step 5: Add the `setSession` wrapper**

`create` at `src/settings/store.ts:125` currently takes an arrow that *is* an object literal
(`create<SettingsState>((set, get) => ({ … }))`). Turn it into a block that declares the wrapper and then
returns that same literal — the literal's contents are untouched by this step.

Insert before the literal:

```ts
export const useSettings = create<SettingsState>((set, get) => {
  // setSession: for the session state the persisted `workspace` block covers (slots, scratch, pane sets).
  // Same as set(), plus the debounced disk write setCockpit already triggers — so the arrangement is
  // restored next launch. Typed explicitly rather than as `typeof set`: zustand's setState is overloaded,
  // and a rest-spread wrapper over it does not typecheck.
  const setSession = (patch: Partial<SettingsState> | ((st: SettingsState) => Partial<SettingsState>)) => {
    set(patch);
    scheduleSave(get);
  };
  return {
```

so the head reads `… => { const setSession = …; return {` and the tail closes with `  };\n});` in place of
the existing `}));`.

- [ ] **Step 6: Route every session-mutating action through it**

In `src/settings/store.ts`, swap `set(` for `setSession(` in exactly these actions (each one changes
slots, scratch or pane sets — the state the block persists):

`setSlot`, `addEmptySlot`, `removeSlot`, `swapSlots`, `placeNewEntity`, `addScratch`, `removeScratch`,
`renameScratch`, `runHostPane`, `addShellPane`, `removeWorktreePane`, `toggleWorktreePane`,
`expandWorktreePane`, `resetWorktreePanes`, the `set((st) => ({ slots: clearEntity(...) }))` line inside
`removeWorktree`, and the two `set(` calls in `startDeduceWorktree` that touch `slots`
(the `swapSlotId` success path and the `clearEntity` failure path).

Leave `set(` alone for purely ephemeral state: `attention`, `initialPromptPending`, `restoredWorktrees`,
the timer, `worktreeError`, and the pending-status update in `startDeduceWorktree`.

Also add the two new actions next to `clearInitialPrompt`:

```ts
  // No-op (same object) when absent, so clearing an unflagged worktree never triggers a re-render.
  clearRestored: (id) =>
    set((st) => {
      if (!st.restoredWorktrees[id]) return st;
      const { [id]: _, ...rest } = st.restoredWorktrees;
      return { restoredWorktrees: rest };
    }),
  // The view you switch to becomes the view you launch into (defaultView has no other writer).
  setDefaultView: (v) => get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, defaultView: v } })),
```

and sweep the flag in `removeWorktree`, after the existing `get().clearInitialPrompt(id);`:

```ts
    get().clearRestored(id); // the worktree is gone; nothing to resume
```

- [ ] **Step 7: Restore on init**

Replace `init` in `src/settings/store.ts:143-146`:

```ts
  init: (s) => set((st) => {
    const base = {
      cockpit: s.cockpit, layout: s.layout, loaded: true,
      fontScale: clampZoom(s.cockpit.preferences.fontScale ?? 1),
    };
    let seq = st.slotSeq;
    const mint = () => { seq += 1; return `slot-${seq}`; };
    // No workspace block = a pre-feature config: seed the slots the old way (first 3 ongoing worktrees).
    if (!s.cockpit.workspace) {
      return { ...base, slots: initSlots(s.cockpit.worktrees, mint), slotSeq: seq };
    }
    const r = restoreWorkspace(s.cockpit.workspace, s.cockpit.worktrees, mint, s.cockpit.cockpitWorktreeId);
    return {
      ...base, slotSeq: seq,
      slots: r.slots,
      scratchTerminals: r.scratchTerminals,
      scratchSeq: r.scratchSeq,
      worktreePanes: r.worktreePanes,
      restoredWorktrees: r.restoredWorktrees,
    };
  }),
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/settings/store.test.ts`
Expected: PASS — the 5 new tests plus every pre-existing one (the composing-writes and
`startDeduceWorktree` regressions must stay green).

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat: restore the workspace on load and persist it on change"
```

---

### Task 5: Resume the Claude conversation in a restored pane

**Files:**
- Modify: `src/worktrees/claudeCmd.ts`
- Modify: `src/worktrees/claudeCmd.test.ts`
- Modify: `src/views/worktree-column/WorktreeBody.tsx:51,79-80`

**Interfaces:**
- Consumes: `restoredWorktrees` / `clearRestored` from the store (Task 4).
- Produces: `claudePaneAutostart(prompt: string | undefined, pending: boolean, restored?: boolean): string`
  — third parameter defaults to `false`, so existing call sites are unaffected.

- [ ] **Step 1: Write the failing tests**

Add to the `claudePaneAutostart` describe block in `src/worktrees/claudeCmd.test.ts`:

```ts
  it("resumes the previous conversation on a restored pane, falling back if there is none", () => {
    expect(claudePaneAutostart(undefined, false, true)).toBe("claude --continue || claude");
    expect(claudePaneAutostart("fix it", false, true)).toBe("claude --continue || claude");
  });
  it("lets a pending one-shot prompt win over resuming", () => {
    expect(claudePaneAutostart("fix it", true, true)).toBe("claude 'fix it'");
  });
  it("defaults to plain claude when the pane is not restored", () => {
    expect(claudePaneAutostart(undefined, false, false)).toBe("claude");
    expect(claudePaneAutostart(undefined, false)).toBe("claude");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/worktrees/claudeCmd.test.ts`
Expected: FAIL — received `"claude"`, expected `"claude --continue || claude"`.

- [ ] **Step 3: Write minimal implementation**

Replace `claudePaneAutostart` in `src/worktrees/claudeCmd.ts`:

```ts
// Resume this worktree's last conversation when the pane came back from a previous session. `|| claude`
// covers `--continue` exiting non-zero because there is nothing to continue (claude was never used
// here), which would otherwise leave the pane on a bare shell showing an error.
export const CONTINUE_CMD = "claude --continue || claude";

// Autostart for the claude pane, in precedence order: a pending one-shot deduce prompt, then resuming a
// restored pane, then a plain session.
export function claudePaneAutostart(prompt: string | undefined, pending: boolean, restored = false): string {
  if (pending && prompt) return claudeAutostart(prompt);
  return restored ? CONTINUE_CMD : "claude";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/worktrees/claudeCmd.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread the flag through the pane**

In `src/views/worktree-column/WorktreeBody.tsx`, add next to the existing `promptPending` line (~51):

```tsx
  // True only for the first spawn after a restart, on a worktree the previous session had open.
  const restored = useSettings((s) => Boolean(s.restoredWorktrees[worktree.id]));
```

and update the Claude pane's two props (~79-80):

```tsx
          autostartCmd={claudePaneAutostart(worktree.prompt, promptPending, restored)}
          onEnsured={() => {
            // Both one-shots are consumed by the first ensure: a later restart runs plain `claude`.
            useSettings.getState().clearInitialPrompt(worktree.id);
            useSettings.getState().clearRestored(worktree.id);
          }}
```

- [ ] **Step 6: Verify the suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/worktrees/claudeCmd.ts src/worktrees/claudeCmd.test.ts src/views/worktree-column/WorktreeBody.tsx
git commit -m "feat: resume the claude conversation in a restored pane"
```

---

### Task 6: Launch into the view you quit on

**Files:**
- Modify: `src/App.tsx:44-45` (add the store selector + a `changeView` helper), `:89` (Cmd+1..3),
  `:145` (`pinToCockpit`), `:160` (nav buttons)

**Interfaces:**
- Consumes: `setDefaultView` from the store (Task 4).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the helper**

In `src/App.tsx`, next to the other store selectors (~line 44):

```tsx
  const setDefaultView = useSettings((s) => s.setDefaultView);
```

and just below the `useState` declarations:

```tsx
  // Every deliberate view switch also persists it: reopening the app lands where you left off.
  // (The load effect below intentionally uses the raw setter — restoring is not a switch.)
  const changeView = (v: View) => { setView(v); setDefaultView(v); };
```

- [ ] **Step 2: Route the three switch sites through it**

- the Cmd+1..3 handler (~line 89): `if (v) { e.preventDefault(); changeView(v.id); }`
- `pinToCockpit` (~line 145): `const pinToCockpit = (id: string) => { setCockpitWorktree(id); changeView("cockpit"); };`
- the nav buttons (~line 160): `onClick={() => changeView(v.id)}`

Then extend that effect's dependency array (`src/App.tsx:94`) from `[view, addEmptySlot]` to
`[view, addEmptySlot, changeView]`.

Leave the startup effect's `setView(normalizeView(...))` untouched.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass. (`App.tsx` has no unit test — it is verified in the manual
smoke in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: launch into the view you quit on"
```

---

### Task 7: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (append an as-built note in the "Status" area, after the terminal-file-drop bullet)
- Modify: `docs/ROADMAP.md` (delete the two shipped items)

- [ ] **Step 1: Run everything**

```bash
npx vitest run
npx tsc --noEmit
npm run build
cd src-tauri && cargo test && cargo build 2>&1 | tail -3
```
Expected: all suites green, no type errors, both builds clean.

- [ ] **Step 2: Delete the shipped backlog items**

In `docs/ROADMAP.md`, remove the **"Persist slot assignments to disk"** bullet (under *Worktrees &
Checkout*) and the **"Persist scratch terminals across restarts"** bullet (under *Scratch terminals*).

- [ ] **Step 3: Write the as-built note**

Append to `CLAUDE.md`:

```markdown
- **Session restore + clean shutdown (2026-07-29).** Quitting now stops what the app started and
  reopening restores the previous arrangement. **Shutdown:** `PtyManager::kill_all()` (`pty.rs`) drains the
  registry, kills each child AND drops each master — closing the master fd is what SIGHUPs the pty's
  foreground process group, so grandchildren (`claude`, `npm run dev`) die too; killing the login shell
  alone would orphan them. Hooked on `RunEvent::Exit` in `lib.rs` (covers Cmd+Q and last-window close),
  which required switching `.run(generate_context!())` → `.build(…)` + `.run(|handle, event| …)`.
  **Restore:** a new **`Option<Workspace>`** block in `cockpit.json` — `slots` (entity ids in column
  order, `null` = shown-but-empty), `scratch` (+ `scratchSeq`), and `panes` (the per-worktree
  `WorktreePaneSet`, collapse state included — this brings back the `paneOpen`-style persistence the
  lazy-panes iteration deleted, now covering pane *existence* too). It's `Option`, **not**
  `#[serde(default)]`, deliberately: **absent** = pre-feature file → fall back to the old
  `initSlots` (first 3 ongoing), **`Some` with empty slots** = the user really closed every column.
  **No duplicated state:** session state stays the source of truth and the block is composed at *write*
  time — `scheduleSave` calls `withWorkspace(cockpit, state)` (pure, in the new `src/settings/workspace.ts`
  with `workspaceSnapshot`/`restoreWorkspace`), so the in-memory `cockpit` never holds a drifting copy.
  Session-mutating actions call a new `setSession()` wrapper (`set` + `scheduleSave`) to trigger the same
  debounced write; a missed call site therefore only delays persistence rather than writing stale data.
  Restore rules: fresh slot keys (keys are React identity, meaningless on disk); an unresolvable id becomes
  an **empty column** (count preserved, picker already rendered); `scratchSeq` lifts to
  `max(persisted, highest scratch-<n>)`; pane sets for vanished worktrees are pruned. **Processes:**
  a restored `host: true` re-runs `startCmd` via the existing autostart, and the claude pane runs
  **`claude --continue || claude`** (the `||` covers `--continue` exiting non-zero when there's no
  conversation to resume; the rejected alternative was probing `~/.claude/projects/<mangled-cwd>/`).
  That's driven by the session-only `restoredWorktrees` flag, seeded from **slots ∪ pane keys ∪
  `cockpitWorktreeId`** (NOT the pane map alone — a Claude-only worktree has no pane entry) and cleared on
  the pane's first `onEnsured`, so restart still runs plain `claude`. The active view now persists into
  `preferences.defaultView` on every switch. Known accepted cost: a change made in the last 500 ms before
  quitting is lost to the debounce (a `CloseRequested` flush handshake was rejected — it can hang quit).
  Spec: `docs/superpowers/specs/2026-07-29-session-restore-and-clean-shutdown-design.md`.
```

- [ ] **Step 4: Commit the docs**

```bash
git add CLAUDE.md docs/ROADMAP.md
git commit -m "docs: as-built note for session restore + clean shutdown"
```

- [ ] **Step 5: Manual smoke (needs a human — the native window is not headlessly drivable)**

Run `npm run tauri dev`, then walk the checklist:

1. Arrange three tiles that are **not** the first three ongoing worktrees; add a scratch terminal;
   press **Run** on one worktree (dev server up); **Add** an extra shell and collapse it; hold a short
   Claude conversation in one pane (ask it something memorable). Switch to the **Cockpit** view last.
2. Note the dev server's port and confirm it is held: `lsof -i :<port>`.
3. Quit with **Cmd+Q**. Confirm nothing is left behind:
   `lsof -i :<port>` (silent) and `ps aux | grep -E "claude|npm run|vite" | grep -v grep` (no orphans).
4. Relaunch. Confirm: opens on the **Cockpit** view; the same three tiles in the same order; the scratch
   terminal is back; the dev server is running again; the extra shell is present and still collapsed;
   the Claude pane resumed the earlier conversation (ask it what you just discussed).
5. Repeat step 3's check after closing the window with the **red button** instead of Cmd+Q.
6. Back-compat: quit, restore an old config (`cp cockpit.json.bak`-style — or hand-delete the
   `"workspace"` key from `~/Library/Application Support/com.cockpit.app/cockpit.json`), relaunch, and
   confirm the app still opens with the first three ongoing worktrees rather than erroring.

Record the outcome in the final report; a failure here is a bug to fix, not a note to file.
