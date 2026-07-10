# Worktree Lazy Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A worktree column starts as a single full-height Claude terminal; the localhost terminal starts on demand via a `▶ Run` button, up to 2 extra plain shells via a `+ Add` button (both at the bottom of the column, 50% width each); the dedicated git pane is removed; a pin button (Worktrees view only) sets the worktree as the Cockpit view's right-column worktree.

**Architecture:** A new session-only Zustand slice `worktreePanes: Record<worktreeId, WorktreePaneSet>` (mirroring `scratchTerminals`) holds each worktree's dynamic pane set; pure helpers in a new `src/worktrees/paneSet.ts` do all the logic. `WorktreeBody` renders panes from the slice. Teardown/Pause kill the live pane roles instead of the fixed `["git","host","claude"]` list. The persisted `paneOpen` field (TS + Rust) is deleted; collapse/expand state moves into the slice.

**Tech Stack:** React 19 + TypeScript (Vite), Zustand, Vitest; Rust (serde) only for the `pane_open` field deletion. No new dependencies. No PTY/Rust-command changes — `pty_ensure`/`pty_kill` are reused as-is.

**Spec:** `docs/superpowers/specs/2026-07-10-worktree-lazy-panes-design.md`

## Global Constraints

- **Learning project comment conventions (CLAUDE.md):** every file starts with a one-line role comment; each significant block gets a concise intent comment. Explain role and intent, not syntax.
- **Smallest change that works.** No polish beyond what's specified; plainest styling that functions.
- **PTY roles:** `claude` (always), `host` (Run), `shell-<n>` (Add, monotonic per worktree, never reused). PTY id format is `{worktreeId}:{role}` via `makePtyId`.
- **Cap:** `MAX_EXTRAS = 2` extra shells per worktree.
- **Session-only:** nothing in this feature is persisted; restart ⇒ every worktree is Claude-only.
- **Back-compat:** old `cockpit.json` files containing `paneOpen` must still load (serde ignores unknown fields — verified by a test).
- **Verification commands:** `npx vitest run` (frontend, run from repo root), `cargo test` (run from `src-tauri/`), `npx tsc --noEmit && npm run build` (type + build check).
- Repo root: `/Users/victormasson/CockpitWorktrees/cockpit/worktree-improve`. Branch: `feat/worktree-improvements`.

---

### Task 1: `paneSet.ts` pure helpers

**Files:**
- Create: `src/worktrees/paneSet.ts`
- Test: `src/worktrees/paneSet.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `WorktreePaneSet` type, `EMPTY_PANE_SET`, `MAX_EXTRAS`, and pure fns `paneRoles(set): string[]`, `runHost(set)`, `addExtra(set)`, `removePane(set, role)`, `isPaneOpen(set, role): boolean`, `togglePane(set, role)`, `expandPane(set, role)` — all `(WorktreePaneSet, …) → WorktreePaneSet` unless noted. Tasks 3, 5, 7 use these exact names.

- [ ] **Step 1: Write the failing tests**

Create `src/worktrees/paneSet.test.ts`:

```ts
// paneSet.test.ts — the dynamic pane-set rules: cap, monotonic roles, remove, collapse/expand.
import { describe, it, expect } from "vitest";
import {
  EMPTY_PANE_SET, MAX_EXTRAS, paneRoles, runHost, addExtra, removePane,
  isPaneOpen, togglePane, expandPane, type WorktreePaneSet,
} from "./paneSet";

describe("paneRoles", () => {
  it("default set is claude only", () => {
    expect(paneRoles(EMPTY_PANE_SET)).toEqual(["claude"]);
  });

  it("orders claude, then host, then extras", () => {
    const set = addExtra(addExtra(runHost(EMPTY_PANE_SET)));
    expect(paneRoles(set)).toEqual(["claude", "host", "shell-1", "shell-2"]);
  });
});

describe("runHost", () => {
  it("turns the host pane on (open)", () => {
    const set = runHost(EMPTY_PANE_SET);
    expect(set.host).toBe(true);
    expect(isPaneOpen(set, "host")).toBe(true);
  });

  it("is idempotent", () => {
    const once = runHost(EMPTY_PANE_SET);
    expect(runHost(once)).toBe(once);
  });
});

describe("addExtra", () => {
  it("adds shell-1 then shell-2, open by default", () => {
    const set = addExtra(addExtra(EMPTY_PANE_SET));
    expect(set.extras).toEqual(["shell-1", "shell-2"]);
    expect(isPaneOpen(set, "shell-2")).toBe(true);
  });

  it("is a no-op at the cap", () => {
    let set: WorktreePaneSet = EMPTY_PANE_SET;
    for (let i = 0; i < MAX_EXTRAS; i++) set = addExtra(set);
    expect(addExtra(set)).toBe(set);
  });

  it("never reuses a removed pane's role (monotonic seq)", () => {
    const set = addExtra(removePane(addExtra(EMPTY_PANE_SET), "shell-1"));
    expect(set.extras).toEqual(["shell-2"]);
  });
});

describe("removePane", () => {
  it("removes the host pane and forgets its collapse state", () => {
    const set = removePane(togglePane(runHost(EMPTY_PANE_SET), "host"), "host");
    expect(set.host).toBe(false);
    expect(set.open).not.toHaveProperty("host");
  });

  it("removes one extra, keeps the other", () => {
    const set = removePane(addExtra(addExtra(EMPTY_PANE_SET)), "shell-1");
    expect(set.extras).toEqual(["shell-2"]);
  });
});

describe("open state", () => {
  it("panes default to open; toggle closes then reopens", () => {
    expect(isPaneOpen(EMPTY_PANE_SET, "claude")).toBe(true);
    const closed = togglePane(EMPTY_PANE_SET, "claude");
    expect(isPaneOpen(closed, "claude")).toBe(false);
    expect(isPaneOpen(togglePane(closed, "claude"), "claude")).toBe(true);
  });

  it("expandPane opens the target and collapses every other live pane", () => {
    const set = expandPane(addExtra(runHost(EMPTY_PANE_SET)), "shell-1");
    expect(isPaneOpen(set, "shell-1")).toBe(true);
    expect(isPaneOpen(set, "claude")).toBe(false);
    expect(isPaneOpen(set, "host")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/worktrees/paneSet.test.ts`
Expected: FAIL — cannot resolve `./paneSet`.

- [ ] **Step 3: Write the implementation**

Create `src/worktrees/paneSet.ts`:

```ts
// paneSet.ts — pure helpers for a worktree's session-only dynamic pane set (claude + optional host + extra shells).

export type WorktreePaneSet = {
  host: boolean; // Run pressed and pane not closed
  extras: string[]; // extra-shell roles ("shell-<n>"), max MAX_EXTRAS
  seq: number; // monotonic per worktree — a closed pane's role (and PTY scrollback) is never reused
  open: Record<string, boolean>; // collapse state per role; absent = open
};

export const MAX_EXTRAS = 2;
export const EMPTY_PANE_SET: WorktreePaneSet = { host: false, extras: [], seq: 0, open: {} };

// All live roles in render order: claude first, then host, then extras.
export function paneRoles(set: WorktreePaneSet): string[] {
  return ["claude", ...(set.host ? ["host"] : []), ...set.extras];
}

export function runHost(set: WorktreePaneSet): WorktreePaneSet {
  return set.host ? set : { ...set, host: true, open: { ...set.open, host: true } };
}

// No-op at the cap; a new pane always starts open.
export function addExtra(set: WorktreePaneSet): WorktreePaneSet {
  if (set.extras.length >= MAX_EXTRAS) return set;
  const role = `shell-${set.seq + 1}`;
  return { ...set, seq: set.seq + 1, extras: [...set.extras, role], open: { ...set.open, [role]: true } };
}

// Close on host/extras: drop the pane and its collapse state (the claude pane can't be removed).
export function removePane(set: WorktreePaneSet, role: string): WorktreePaneSet {
  const { [role]: _, ...open } = set.open;
  if (role === "host") return { ...set, host: false, open };
  return { ...set, extras: set.extras.filter((r) => r !== role), open };
}

export function isPaneOpen(set: WorktreePaneSet, role: string): boolean {
  return set.open[role] ?? true;
}

export function togglePane(set: WorktreePaneSet, role: string): WorktreePaneSet {
  return { ...set, open: { ...set.open, [role]: !isPaneOpen(set, role) } };
}

// Expand = open me, collapse every other live pane.
export function expandPane(set: WorktreePaneSet, role: string): WorktreePaneSet {
  return { ...set, open: Object.fromEntries(paneRoles(set).map((r) => [r, r === role])) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/worktrees/paneSet.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worktrees/paneSet.ts src/worktrees/paneSet.test.ts
git commit -m "feat(panes): pure pane-set helpers for the lazy worktree panes"
```

---

### Task 2: `isAttentionRole` covers `shell-<n>` extras

**Files:**
- Modify: `src/worktrees/ptyId.ts`
- Test: `src/worktrees/ptyId.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isAttentionRole(role: string): boolean` now true for `"claude"`, `"shell"` (scratch), and any `"shell-<n>"` extra.

- [ ] **Step 1: Add failing test cases**

In `src/worktrees/ptyId.test.ts`, extend the existing `isAttentionRole` describe block (read the file first; add these cases alongside the current ones):

```ts
it("arms worktree extra shells (shell-<n>)", () => {
  expect(isAttentionRole("shell-1")).toBe(true);
  expect(isAttentionRole("shell-2")).toBe(true);
});

it("still excludes host and git", () => {
  expect(isAttentionRole("host")).toBe(false);
  expect(isAttentionRole("git")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify the new cases fail**

Run: `npx vitest run src/worktrees/ptyId.test.ts`
Expected: FAIL — `isAttentionRole("shell-1")` returns false.

- [ ] **Step 3: Implement**

In `src/worktrees/ptyId.ts`, replace the `isAttentionRole` definition (and its comment) with:

```ts
// Panes that may be running Claude Code arm the bell-based "needs attention" highlight:
// the claude pane, scratch shells ("shell"), and worktree extra shells ("shell-<n>").
// host is excluded (dev server output must not trigger it).
export const isAttentionRole = (role: string) =>
  role === "claude" || role === "shell" || role.startsWith("shell-");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/worktrees/ptyId.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktrees/ptyId.ts src/worktrees/ptyId.test.ts
git commit -m "feat(panes): extra worktree shells arm the attention highlight"
```

---

### Task 3: `worktreePanes` store slice

**Files:**
- Modify: `src/settings/store.ts`

**Interfaces:**
- Consumes: Task 1's `WorktreePaneSet`, `EMPTY_PANE_SET`, `runHost`, `addExtra`, `removePane`, `togglePane`, `expandPane`.
- Produces (used by Tasks 5–7): store state `worktreePanes: Record<string, WorktreePaneSet>` and actions
  `runHostPane(id: string)`, `addShellPane(id: string)`, `removeWorktreePane(id: string, role: string)`,
  `toggleWorktreePane(id: string, role: string)`, `expandWorktreePane(id: string, role: string)`,
  `resetWorktreePanes(id: string)`.

No new unit tests: the actions are one-line wrappers over the Task-1 helpers (the repo's tested-pure-helper idiom); existing tests must stay green.

- [ ] **Step 1: Add the slice to the `SettingsState` interface**

In `src/settings/store.ts`, add to the imports:

```ts
import { runHost, addExtra, removePane, togglePane, expandPane, EMPTY_PANE_SET, type WorktreePaneSet } from "../worktrees/paneSet";
```

In the `SettingsState` interface, after the `initialPromptPending` / `clearInitialPrompt` lines, add:

```ts
  // Session-only dynamic pane set per worktree (claude + Run host + Add shells). Not persisted:
  // the Rust PTY registry dies with the app, so on restart every worktree is Claude-only again.
  worktreePanes: Record<string, WorktreePaneSet>;
  runHostPane: (id: string) => void;
  addShellPane: (id: string) => void;
  removeWorktreePane: (id: string, role: string) => void;
  toggleWorktreePane: (id: string, role: string) => void;
  expandWorktreePane: (id: string, role: string) => void;
  resetWorktreePanes: (id: string) => void;
```

- [ ] **Step 2: Implement the slice**

In the `create<SettingsState>(...)` body, after the `initialPromptPending: {}` initial-state line, add `worktreePanes: {},`.

After the `clearInitialPrompt` action, add:

```ts
  // Pane-set actions: thin wrappers over the pure paneSet helpers, keyed by worktree id.
  runHostPane: (id) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: runHost(st.worktreePanes[id] ?? EMPTY_PANE_SET) } })),
  addShellPane: (id) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: addExtra(st.worktreePanes[id] ?? EMPTY_PANE_SET) } })),
  removeWorktreePane: (id, role) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: removePane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
  toggleWorktreePane: (id, role) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: togglePane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
  expandWorktreePane: (id, role) =>
    set((st) => ({ worktreePanes: { ...st.worktreePanes, [id]: expandPane(st.worktreePanes[id] ?? EMPTY_PANE_SET, role) } })),
  // No-op (same object) when absent, so resetting an untouched worktree never re-renders.
  resetWorktreePanes: (id) =>
    set((st) => {
      if (!st.worktreePanes[id]) return st;
      const { [id]: _, ...rest } = st.worktreePanes;
      return { worktreePanes: rest };
    }),
```

In the existing `removeWorktree` action, after the `get().clearInitialPrompt(id);` line, add:

```ts
    get().resetWorktreePanes(id); // the pane set is meaningless once the worktree is gone
```

- [ ] **Step 3: Verify types + existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean compile, all existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/settings/store.ts
git commit -m "feat(panes): session-only worktreePanes store slice"
```

---

### Task 4: `WorktreePane` optional `onClose` override

**Files:**
- Modify: `src/views/worktree-column/WorktreePane.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorktreePane` accepts optional `onClose?: () => void`; when provided the header close button calls it INSTEAD of the built-in kill-and-respawn-bare close. Task 5 passes it for host/extra panes.

- [ ] **Step 1: Add the prop**

In `src/views/worktree-column/WorktreePane.tsx`, extend `PaneChrome`:

```ts
  // Overrides the built-in close (kill + respawn bare). Removable panes (host/extras) pass a
  // handler that kills the PTY and removes the pane from the column instead.
  onClose?: () => void;
```

Change the component signature to destructure it:

```ts
export function WorktreePane({ title, icon, badge, action, open: openProp, onToggle, onExpand, onClose, ...args }: UseTerminalArgs & PaneChrome) {
```

And change the close button's handler from `onClick={close}` to:

```tsx
<button className="icon-btn wt-pane__close" title="close" aria-label="close process" onClick={onClose ?? close}><CloseIcon /></button>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all tests PASS (prop is optional — no caller changes yet).

- [ ] **Step 3: Commit**

```bash
git add src/views/worktree-column/WorktreePane.tsx
git commit -m "feat(panes): WorktreePane accepts an onClose override for removable panes"
```

---

### Task 5: `WorktreeBody` rewrite — dynamic panes + Run/Add bar

**Files:**
- Modify: `src/views/worktree-column/WorktreeBody.tsx` (full rewrite of the pane section)
- Modify: `src/views/icons.tsx` (add `PlayIcon`, `PlusIcon`)
- Modify: `src/views/worktree-column/WorktreeColumn.css` (action-bar styles)

**Interfaces:**
- Consumes: Task 3's slice + actions; Task 4's `onClose`; Task 1's `EMPTY_PANE_SET`, `MAX_EXTRAS`, `isPaneOpen`; existing `makePtyId`, `claudePaneAutostart`, `worktreeChips`, `LinksList`.
- Produces: `WorktreeBody({ worktree, variant })` — same signature as today (Task 6 adds `pinnable`). New CSS classes `.wt-col__actions`, `.wt-col__action`. New icons `PlayIcon`, `PlusIcon` in `src/views/icons.tsx`.

No new unit tests (JSX rendering; the repo doesn't component-test). Verification is compile + existing suite + the Task 9 GUI checklist.

- [ ] **Step 1: Add the icons**

Append to `src/views/icons.tsx`:

```tsx
// Play: triangle (Run — start the worktree's localhost dev server).
export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M5.5 3.5v9l7-4.5z" />
    </svg>
  );
}

// Plus: add an extra terminal pane in the worktree.
export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}
```

- [ ] **Step 2: Rewrite `WorktreeBody.tsx`**

Replace the whole file with:

```tsx
// WorktreeBody.tsx — the worktree slot body: chips + path + dynamic panes (claude always; host via Run; extra shells via Add) + the bottom Run/Add bar.
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";
import { claudePaneAutostart } from "../../worktrees/claudeCmd";
import { makePtyId } from "../../worktrees/ptyId";
import { EMPTY_PANE_SET, MAX_EXTRAS, isPaneOpen } from "../../worktrees/paneSet";
import { CopyIcon, PlayIcon, PlusIcon } from "../icons";

export function WorktreeBody({ worktree, variant }: { worktree: Worktree; variant: "full" | "calm" }) {
  // Session-only dynamic pane set: which panes exist + their collapse state (absent = Claude only).
  const paneSet = useSettings((s) => s.worktreePanes[worktree.id]) ?? EMPTY_PANE_SET;
  const runHostPane = useSettings((s) => s.runHostPane);
  const addShellPane = useSettings((s) => s.addShellPane);
  const toggleWorktreePane = useSettings((s) => s.toggleWorktreePane);
  const expandWorktreePane = useSettings((s) => s.expandWorktreePane);

  // Full variant routes collapse/expand through the slice so expand can collapse the LIVE siblings.
  const paneProps = (role: string) =>
    variant === "full"
      ? {
          open: isPaneOpen(paneSet, role),
          onToggle: () => toggleWorktreePane(worktree.id, role),
          onExpand: () => expandWorktreePane(worktree.id, role),
        }
      : {}; // calm: single pane, self-managed, no expand

  // Close on host/extras REMOVES the pane: kill the PTY, drop any attention mark, drop it from the set.
  const closePane = (role: string) => {
    const ptyId = makePtyId(worktree.id, role);
    useSettings.getState().clearAttention(ptyId);
    invoke("pty_kill", { ptyId }).catch((e) => console.error("pty_kill failed", e));
    useSettings.getState().removeWorktreePane(worktree.id, role);
  };

  // One-shot: true only in the session that created this worktree, until the claude PTY's first ensure.
  const promptPending = useSettings((s) => Boolean(s.initialPromptPending[worktree.id]));
  const prompt = worktree.prompt; // captured so TS narrowing survives into the JSX callbacks (no `!`)
  const startCmd = worktree.host.startCmd.trim();
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
            {/* user links live in the same row as the derived chips, with + link at the end. */}
            <LinksList worktreeId={worktree.id} links={worktree.links} />
          </div>
          <div className="wt-col__path">
            {worktree.repoPath.split("/").pop()} · {worktree.branch} · {worktree.worktreePath.split("/").pop()}
          </div>
        </>
      )}
      <div className="wt-col__panes">
        {/* attention highlight (border/glow + badge) is owned by WorktreePane via the live store. */}
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath}
          autostartCmd={claudePaneAutostart(worktree.prompt, promptPending)}
          onEnsured={() => useSettings.getState().clearInitialPrompt(worktree.id)}
          action={prompt ? (
            <button
              className="icon-btn" title={`copy prompt: ${prompt}`}
              onClick={() => navigator.clipboard.writeText(prompt).catch((e) => console.error("copy prompt failed", e))}
            ><CopyIcon /></button>
          ) : undefined}
          {...paneProps("claude")}
        />
        {variant === "full" && paneSet.host && (
          <WorktreePane
            title="localhost" icon={<span className="wt-ico wt-ico--chrome" aria-hidden />}
            worktreeId={worktree.id} role="host" cwd={worktree.worktreePath}
            autostartCmd={worktree.host.startCmd}
            onClose={() => closePane("host")}
            {...paneProps("host")}
          />
        )}
        {variant === "full" && paneSet.extras.map((role) => (
          <WorktreePane
            key={role}
            title="terminal" icon={<span className="wt-ico wt-ico--terminal" aria-hidden />}
            worktreeId={worktree.id} role={role} cwd={worktree.worktreePath}
            onClose={() => closePane(role)}
            {...paneProps(role)}
          />
        ))}
      </div>
      {variant === "full" && (
        <div className="wt-col__actions">
          <button
            className="wt-col__action"
            disabled={paneSet.host || !startCmd}
            title={!startCmd ? "no start command configured" : paneSet.host ? "already running" : `run: ${startCmd}`}
            onClick={() => runHostPane(worktree.id)}
          ><PlayIcon /> Run</button>
          <button
            className="wt-col__action"
            disabled={paneSet.extras.length >= MAX_EXTRAS}
            title={paneSet.extras.length >= MAX_EXTRAS ? `max ${MAX_EXTRAS} extra terminals` : "add a terminal in this worktree"}
            onClick={() => addShellPane(worktree.id)}
          ><PlusIcon /> Add</button>
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer:
- The old imports `PaneOpenState` and `updateWorktree` are gone; do not re-add them.
- The claude pane in the calm variant keeps working: `paneProps` returns `{}` so it self-manages, and the Run/Add bar + host/extras are `variant === "full"` only.
- `wt-ico--terminal` already exists (used by the modal's Terminal heading and scratch bodies).

- [ ] **Step 3: Add the action-bar CSS**

In `src/views/worktree-column/WorktreeColumn.css`, after the `.wt-col__panes` rule, add:

```css
/* bottom action bar: Run (start the dev server) + Add (extra shell), 50/50 width. */
.wt-col__actions { display: flex; gap: var(--space-2); padding: 0 var(--space-3) var(--space-3); }
.wt-col__action {
  flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--surface); color: var(--tx); border: 1px solid var(--bdr);
  border-radius: var(--r-sm); padding: 6px 0; font-size: var(--fs-md); cursor: pointer;
}
.wt-col__action:not(:disabled):hover { background: var(--hover); }
.wt-col__action:disabled { opacity: 0.5; cursor: default; }
.wt-col__action svg { width: 13px; height: 13px; }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean compile + build, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/worktree-column/WorktreeBody.tsx src/views/icons.tsx src/views/worktree-column/WorktreeColumn.css
git commit -m "feat(panes): Claude-first worktree body with lazy Run/Add terminals; git pane removed"
```

---

### Task 6: Pin-to-Cockpit button (Worktrees view only)

**Files:**
- Modify: `src/views/icons.tsx` (add `PinIcon`)
- Modify: `src/views/worktree-column/WorktreeBody.tsx` (button + `pinnable` prop)
- Modify: `src/views/worktree-column/SlotColumn.tsx` (thread `pinnable`)
- Modify: `src/views/WorktreesView.tsx` (pass `pinnable`)
- Modify: `src/views/worktree-column/WorktreeColumn.css` (pin styles)

**Interfaces:**
- Consumes: existing store `setCockpitWorktree(id: string | null)` and `cockpit.cockpitWorktreeId`.
- Produces: `SlotColumn` and `WorktreeBody` accept optional `pinnable?: boolean` (default false). Only `WorktreesView` passes `pinnable` — `CalmView` and `CockpitView` are NOT modified.

- [ ] **Step 1: Add `PinIcon`**

Append to `src/views/icons.tsx`:

```tsx
// Pin: map-pin (set this worktree as the Cockpit view's right-column worktree).
export function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M8 14.5S3.5 9.9 3.5 7a4.5 4.5 0 1 1 9 0c0 2.9-4.5 7.5-4.5 7.5z" />
      <circle cx="8" cy="7" r="1.6" />
    </svg>
  );
}
```

- [ ] **Step 2: Thread `pinnable` and render the button**

`src/views/WorktreesView.tsx` — pass the prop:

```tsx
<SlotColumn key={i} value={slots[i]} onSelect={(id) => setSlot(i, id)} pinnable />
```

`src/views/worktree-column/SlotColumn.tsx` — accept + forward (only the signature and the `WorktreeBody` call change):

```tsx
export function SlotColumn({ value, onSelect, variant = "full", pinnable = false }: { value: string | null; onSelect: (id: string | null) => void; variant?: "full" | "calm"; pinnable?: boolean }) {
```

```tsx
<WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} pinnable={pinnable} />
```

`src/views/worktree-column/WorktreeBody.tsx` — accept the prop:

```tsx
export function WorktreeBody({ worktree, variant, pinnable = false }: { worktree: Worktree; variant: "full" | "calm"; pinnable?: boolean }) {
```

Add the selectors near the other store reads:

```ts
  // Pin (Worktrees view only): toggles this worktree as the Cockpit view's right-column worktree.
  const pinned = useSettings((s) => s.cockpit.cockpitWorktreeId === worktree.id);
  const setCockpitWorktree = useSettings((s) => s.setCockpitWorktree);
```

Add `PinIcon` to the icons import, and render the button at the END of the `.wt-col__chips` row (after `<LinksList …/>`):

```tsx
{pinnable && (
  <button
    className={`icon-btn wt-col__pin${pinned ? " wt-col__pin--active" : ""}`}
    title={pinned ? "unpin from Cockpit view" : "pin to Cockpit view"}
    aria-pressed={pinned}
    onClick={() => setCockpitWorktree(pinned ? null : worktree.id)}
  ><PinIcon /></button>
)}
```

- [ ] **Step 3: Pin styles**

In `src/views/worktree-column/WorktreeColumn.css`, after the `.wt-chip--add` rule, add:

```css
/* pin-to-Cockpit toggle: pushed to the right edge of the chips row; accent when active. */
.wt-col__pin { margin-left: auto; color: var(--tx-3); }
.wt-col__pin:hover { color: var(--tx); }
.wt-col__pin--active { color: var(--accent); }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/icons.tsx src/views/worktree-column/WorktreeBody.tsx src/views/worktree-column/SlotColumn.tsx src/views/WorktreesView.tsx src/views/worktree-column/WorktreeColumn.css
git commit -m "feat(panes): pin-to-Cockpit toggle in the Worktrees-view chips row"
```

---

### Task 7: Teardown/Pause kill the live pane set

**Files:**
- Modify: `src/worktrees/teardown.ts`
- Modify: `src/worktrees/teardown.test.ts`
- Modify: `src/views/worktree-column/SlotColumn.tsx` (Pause call site)
- Modify: `src/views/worktree-column/TeardownConfirm.tsx` (Delete/Wipe call site)

**Interfaces:**
- Consumes: Task 1's `paneRoles`, `EMPTY_PANE_SET`; Task 3's `worktreePanes` state + `resetWorktreePanes`.
- Produces: `killWorktreePtys(worktreeId: string, roles: string[])` and `teardownWorktree(wt, opts, removeWorktreeModel, roles: string[])`. `WORKTREE_ROLES` is DELETED.

- [ ] **Step 1: Update the tests first**

In `src/worktrees/teardown.test.ts`:

Replace the first test with:

```ts
it("kills every live pane role, in order, before removing the worktree", async () => {
  const removeModel = vi.fn();
  await teardownWorktree(WT, { wipe: false, force: false }, removeModel, ["claude", "host", "shell-1", "shell-3"]);
  expect(calls).toEqual([
    "pty_kill:wt-1:claude", "pty_kill:wt-1:host", "pty_kill:wt-1:shell-1", "pty_kill:wt-1:shell-3", "remove",
  ]);
});

it("a Claude-only worktree kills just the claude PTY", async () => {
  await teardownWorktree(WT, { wipe: false, force: false }, vi.fn(), ["claude"]);
  expect(calls).toEqual(["pty_kill:wt-1:claude", "remove"]);
});
```

Every other `teardownWorktree(WT, {...}, ...)` call in the file gains a 4th argument `["claude"]`, e.g.:

```ts
const warning = await teardownWorktree(WT, { wipe: false, force: false }, removeModel, ["claude"]);
```

(6 call sites total in the file — update them all.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/worktrees/teardown.test.ts`
Expected: FAIL — the old fixed-list behavior kills `git`/`host`/`claude` regardless of the argument.

- [ ] **Step 3: Implement**

In `src/worktrees/teardown.ts`, delete the `WORKTREE_ROLES` constant and change both functions:

```ts
// Pause/teardown kill the worktree's LIVE pane roles (claude + host? + shell-*), passed by the
// caller from the session pane-set. Idempotent — pty_kill is a no-op on missing ids.
export async function killWorktreePtys(worktreeId: string, roles: string[]): Promise<void> {
  for (const role of roles) await invoke("pty_kill", { ptyId: makePtyId(worktreeId, role) });
}
```

`teardownWorktree` gains the trailing parameter and threads it through (only the signature and the first line change):

```ts
export async function teardownWorktree(
  wt: { id: string; repoPath: string; worktreePath: string; branch: string },
  opts: { wipe: boolean; force: boolean },
  removeWorktreeModel: (id: string) => void,
  roles: string[],
): Promise<string | null> {
  await killWorktreePtys(wt.id, roles); // 1. kill first — frees the dir so git worktree remove can't be blocked.
```

- [ ] **Step 4: Update the two call sites**

`src/views/worktree-column/SlotColumn.tsx` — add to the imports:

```ts
import { paneRoles, EMPTY_PANE_SET } from "../../worktrees/paneSet";
```

Replace `pauseActive` with:

```ts
  // Pause: kill the worktree's live processes and unassign the slot; keep model + dir + branch.
  // Also reset the pane set — a paused worktree comes back Claude-only (re-showing it must not
  // silently re-run the dev server).
  const pauseActive = async () => {
    if (entity?.kind !== "worktree") return;
    setMenuOpen(false);
    const id = entity.worktree.id;
    const st = useSettings.getState();
    await killWorktreePtys(id, paneRoles(st.worktreePanes[id] ?? EMPTY_PANE_SET));
    st.resetWorktreePanes(id);
    onSelect(null);
  };
```

`src/views/worktree-column/TeardownConfirm.tsx` — add to the imports:

```ts
import { paneRoles, EMPTY_PANE_SET } from "../../worktrees/paneSet";
```

In `confirm`, pass the live roles (the store's `removeWorktree` already resets the pane entry afterwards — Task 3):

```ts
      const st = useSettings.getState();
      const w = await teardownWorktree(
        worktree,
        { wipe: action === "wipe", force: status?.dirty ?? true },
        removeWorktree,
        paneRoles(st.worktreePanes[worktree.id] ?? EMPTY_PANE_SET),
      );
```

- [ ] **Step 5: Run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (including the two new teardown cases).

- [ ] **Step 6: Commit**

```bash
git add src/worktrees/teardown.ts src/worktrees/teardown.test.ts src/views/worktree-column/SlotColumn.tsx src/views/worktree-column/TeardownConfirm.tsx
git commit -m "feat(panes): teardown and Pause kill the live pane set instead of the fixed 3 roles"
```

---

### Task 8: Delete the persisted `paneOpen` field (TS + Rust)

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src-tauri/src/settings.rs`

**Interfaces:**
- Consumes: nothing (Tasks 5/7 already removed every reader of `paneOpen`).
- Produces: `Worktree` (TS and Rust) without `paneOpen`; legacy JSON containing it still loads.

- [ ] **Step 1: Update the Rust test first (fail-first)**

In `src-tauri/src/settings.rs`, replace the whole `worktree_pane_open_is_optional_and_round_trips` test (around line 355) with:

```rust
    // Pre-lazy-panes files persisted a paneOpen arrangement; the field is gone and must be
    // silently ignored on load (serde default: unknown fields are skipped), never re-written.
    #[test]
    fn worktree_ignores_legacy_pane_open() {
        let legacy = r#"{"id":"w1","name":"n","repoPath":"/r","branch":"b","worktreePath":"/w","host":{"startCmd":"","address":""},"links":[],"status":"ongoing","paneOpen":{"host":false,"git":false,"claude":true}}"#;
        let wt: Worktree = serde_json::from_str(legacy).unwrap();
        assert_eq!(wt.id, "w1");
        assert!(!serde_json::to_string(&wt).unwrap().contains("paneOpen"));
    }
```

Run: `cd src-tauri && cargo test worktree_ignores_legacy_pane_open`
Expected: FAIL to compile OR the serialization assert fails (the struct still has the field; if the old test body was fully replaced, compile fails on nothing — then the deserialize keeps `pane_open: Some(..)` and the `contains("paneOpen")` assert FAILS). Either failure mode is the red step.

- [ ] **Step 2: Delete the field and struct**

In `src-tauri/src/settings.rs`:
- Delete the `PaneOpen` struct (lines ~62–68, including its comment).
- Delete from `Worktree`: the `#[serde(rename = "paneOpen", default, skip_serializing_if = "Option::is_none")]` attribute and the `pub pane_open: Option<PaneOpen>,` field.
- If any other test constructs a `Worktree` literal with `pane_open`, remove that field from the literal (search: `pane_open`).

Run: `cd src-tauri && cargo test`
Expected: ALL PASS, including `worktree_ignores_legacy_pane_open`.

- [ ] **Step 3: Delete the TS side**

In `src/settings/types.ts`:
- Delete the `PaneOpenState` interface and its comment (lines 37–38).
- Delete `paneOpen?: PaneOpenState;` from `Worktree`.

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean — no remaining references (Tasks 5/7 removed them; if tsc flags one, remove that usage too).

- [ ] **Step 4: Commit**

```bash
git add src/settings/types.ts src-tauri/src/settings.rs
git commit -m "feat(panes): drop the persisted paneOpen field (collapse state is session-only now)"
```

---

### Task 9: Docs + full verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: CLAUDE.md as-built updates**

Make these edits (keep each note's style — dense, past-tense, gotcha-oriented):

1. Add a new as-built bullet (place after the "Deduce prompt → Claude pane" note):

```markdown
- **Worktree lazy panes (2026-07-10).** A worktree column starts as ONE full-height Claude pane; the
  **git pane is gone** and the localhost pane is no longer spawned at creation. A bottom action bar
  (`.wt-col__actions`) has **▶ Run** (spawns the `host` pane with `host.startCmd`; disabled while running
  or when startCmd is blank) and **+ Add** (up to 2 plain shells, roles `shell-<n>` with a monotonic
  per-worktree seq so a closed pane's scrollback is never reattached; cwd = the worktree). State is the
  **session-only** `worktreePanes` store slice over pure helpers in `src/worktrees/paneSet.ts`
  (`paneRoles`/`runHost`/`addExtra`/`removePane`/`togglePane`/`expandPane`); the persisted **`paneOpen`
  field was deleted** (TS + Rust `PaneOpen`; legacy cockpit.json still loads — serde ignores unknown
  fields) so collapse/expand is session-only too. **Close on host/extras removes the pane** (pty_kill +
  drop from the set); Close on Claude keeps the respawn-bare behavior. Extra shells arm the attention
  highlight (`isAttentionRole` matches `shell-<n>`). Teardown/Pause kill the LIVE pane set
  (`killWorktreePtys(id, roles)` — `WORKTREE_ROLES` deleted); **Pause also resets the pane set** so a
  paused worktree comes back Claude-only instead of silently re-running the dev server. A **pin button**
  (map-pin, end of the chips row, `pinnable` prop threaded only from WorktreesView) toggles
  `cockpitWorktreeId`. Spec: `docs/superpowers/specs/2026-07-10-worktree-lazy-panes-design.md`.
```

2. In the "Three views" as-built note: change "each a `WorktreeColumn` showing one running worktree" wording if it mentions **3 terminals**, and update the sub-project-2 note "3 xterm.js terminals (host / git / claude)" to "terminals (Claude-first; host/extras on demand — see the lazy-panes note)".
3. In the "Terminal pane expand + close buttons" note: mark the persisted-`paneOpen` part superseded, e.g. append "(**Superseded 2026-07-10:** `paneOpen` deleted — pane existence + collapse state are session-only via `worktreePanes`; Close on host/extras now removes the pane.)"
4. In the "Worktree teardown actions" note: append "(**Since 2026-07-10:** kills the live pane set, not a fixed 3-role list.)" where it says "kill the 3 PTYs".

- [ ] **Step 2: ROADMAP.md updates**

- Under "Smaller iterations → Worktrees & Checkout", delete nothing, but re-word the "'Path not found' banner" item's tail to note only the Claude pane shows `[failed to start]` by default now.
- Add one new deferred item under "Worktrees & Checkout":

```markdown
- **Run button when the dev server exits.** The host pane stays after the process ends (restart re-runs it); consider auto-detecting exit and re-enabling a fresh Run affordance.
```

- [ ] **Step 3: Full verification**

```bash
npx tsc --noEmit && npm run build && npx vitest run
cd src-tauri && cargo test && cargo build
```

Expected: everything green, builds clean (warning-free Rust).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/ROADMAP.md
git commit -m "docs: as-built notes for the worktree lazy panes iteration"
```

- [ ] **Step 5: GUI acceptance checklist (human, pending)**

Record as PENDING in the final report (the agent cannot see the app window):
- New/deduced worktree shows ONE full-height Claude pane; no host/git panes.
- Run spawns localhost with the right command; button disables; Close removes the pane and re-enables Run.
- Run is disabled with a hint on a checkout-created worktree (blank startCmd).
- Add spawns up to 2 shells cd'd into the worktree; Add disables at 2; Close removes and re-enables.
- Expand/collapse works across the dynamic set; arrangement survives a view switch, resets on relaunch.
- Pin appears only in the Worktrees view; toggles the Cockpit right column; active state visible.
- Pause → re-select comes back Claude-only; Delete/Wipe still tear down cleanly with extras open.
