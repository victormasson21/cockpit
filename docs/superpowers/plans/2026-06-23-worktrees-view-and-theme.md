# Worktrees View + Reusable Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dockview-based shell with a themed, hand-built UI whose centrepiece is a Worktrees view — three fixed column slots, each displaying one running worktree (deduce-flow output) with terminals, chips, and per-pane collapse.

**Architecture:** Drop dockview entirely. A single CSS design-token theme (`src/theme/tokens.css`) backs plain colocated `.css` files. `App.tsx` becomes a themed shell (brand · segmented `Cockpit/Worktrees/Calm` switcher · `+ New worktree`) rendering one view component. The Worktrees view renders 3 `WorktreeColumn`s bound to slot indices; slot→worktree assignment is **session-only** store state (no Rust change). Worktree terminals reuse the unchanged `useTerminal` hook.

**Tech Stack:** React 19 + TypeScript (Vite), Zustand store, xterm.js via `useTerminal`, Tauri IPC (`invoke`, `openUrl`). Vitest for pure logic.

## Global Constraints

- **Comment the role at the top of every file**; one concise line at the top of each non-obvious block. (CLAUDE.md convention.)
- **Smallest change that works**; fewer files/deps/abstractions. This plan *removes* a dependency (`dockview`) and adds **no** new ones.
- **No Rust/backend changes.** `cargo test` must remain untouched. PTY/git/deduce IPC is reused as-is.
- **3 fixed column slots** (`SLOT_COUNT = 3`), no horizontal scroll.
- **Slot assignments are session-only** — held in the Zustand store, never written to `cockpit.json`/`layout.json`.
- **Stubs, not live data:** the **CI** chip and the **Attention** badge/dot are built (styled) but render in their off/placeholder state. No live PTY/git/CI detection this pass.
- **Dark theme tokens are the single source of styling** — components consume `var(--…)`; no hard-coded colors in component CSS where a token exists.
- Test a single file with `npx vitest run <path>`; whole suite with `npm test`; build with `npm run build`.

---

### Task 1: Slot reducers (pure logic)

**Files:**
- Create: `src/views/slots.ts`
- Test: `src/views/slots.test.ts`

**Interfaces:**
- Produces: `SLOT_COUNT: 3`; `type Slots = (string | null)[]`; `initSlots(worktrees: Worktree[]): Slots`; `setSlotAt(slots: Slots, index: number, id: string | null): Slots`; `assignFirstEmpty(slots: Slots, id: string): Slots`; `clearWorktree(slots: Slots, id: string): Slots`.

- [ ] **Step 1: Write the failing test**

```ts
// slots.test.ts — pure slot-reducer behavior for the 3-column Worktrees view.
import { describe, it, expect } from "vitest";
import { SLOT_COUNT, initSlots, setSlotAt, assignFirstEmpty, clearWorktree } from "./slots";
import type { Worktree } from "../settings/types";

const wt = (id: string, status: Worktree["status"] = "ongoing"): Worktree => ({
  id, name: id, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status,
});

describe("slots", () => {
  it("initSlots takes the first 3 ongoing worktrees, padding with null", () => {
    expect(initSlots([wt("a"), wt("b")])).toEqual(["a", "b", null]);
    expect(initSlots([wt("a"), wt("b"), wt("c"), wt("d")])).toEqual(["a", "b", "c"]);
  });
  it("initSlots skips completed worktrees", () => {
    expect(initSlots([wt("done", "completed"), wt("a")])).toEqual(["a", null, null]);
  });
  it("setSlotAt assigns and clears one slot", () => {
    expect(setSlotAt([null, null, null], 1, "x")).toEqual([null, "x", null]);
    expect(setSlotAt(["x", null, null], 0, null)).toEqual([null, null, null]);
  });
  it("assignFirstEmpty fills the first null, else returns unchanged", () => {
    expect(assignFirstEmpty(["a", null, null], "b")).toEqual(["a", "b", null]);
    expect(assignFirstEmpty(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
  });
  it("clearWorktree removes a deleted id from every slot", () => {
    expect(clearWorktree(["a", "b", "a"], "a")).toEqual([null, "b", null]);
  });
  it("SLOT_COUNT is 3", () => expect(SLOT_COUNT).toBe(3));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/slots.test.ts`
Expected: FAIL — cannot find module `./slots`.

- [ ] **Step 3: Write minimal implementation**

```ts
// slots.ts — pure helpers for the Worktrees view's 3 column slots (session-only; not persisted to disk).
import type { Worktree } from "../settings/types";

export const SLOT_COUNT = 3;
export type Slots = (string | null)[];

// initSlots: on load, auto-fill the slots with the first SLOT_COUNT ongoing worktrees.
export function initSlots(worktrees: Worktree[]): Slots {
  const ongoing = worktrees.filter((w) => w.status === "ongoing").map((w) => w.id);
  return Array.from({ length: SLOT_COUNT }, (_, i) => ongoing[i] ?? null);
}

// setSlotAt: choose (or clear with null) the worktree shown in one slot — the dropdown picker + Hide.
export function setSlotAt(slots: Slots, index: number, id: string | null): Slots {
  return slots.map((s, i) => (i === index ? id : s));
}

// assignFirstEmpty: place a newly-created worktree in the first empty slot; unchanged when all are full.
export function assignFirstEmpty(slots: Slots, id: string): Slots {
  const i = slots.indexOf(null);
  return i === -1 ? slots : setSlotAt(slots, i, id);
}

// clearWorktree: drop a deleted worktree from every slot referencing it.
export function clearWorktree(slots: Slots, id: string): Slots {
  return slots.map((s) => (s === id ? null : s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/slots.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/slots.ts src/views/slots.test.ts
git commit -m "feat(worktrees): pure slot reducers for the 3-column view"
```

---

### Task 2: Chip derivation (pure logic)

**Files:**
- Create: `src/views/worktree-column/chips.ts`
- Test: `src/views/worktree-column/chips.test.ts`

**Interfaces:**
- Produces: `type ChipKind = "linear" | "pr" | "issue" | "preview" | "ci"`; `interface Chip { kind: ChipKind; label: string; url?: string }`; `worktreeChips(w: Worktree): Chip[]`.
- Linear id is read from `w.name` only (canonical uppercase `ENG-1234`, as pinned by the Linear/GitHub deduce iterations); `pr-<N>`/`issue-<N>` are read from name+branch (lowercase). CI is always a static stub chip.

- [ ] **Step 1: Write the failing test**

```ts
// chips.test.ts — deriving display chips from existing worktree data (no live providers).
import { describe, it, expect } from "vitest";
import { worktreeChips } from "./chips";
import type { Worktree } from "../../settings/types";

const base: Worktree = {
  id: "wt", name: "", repoPath: "/r", branch: "", worktreePath: "/wt",
  host: { startCmd: "pnpm dev", address: "http://localhost:5173" }, links: [], status: "ongoing",
};
const kinds = (w: Worktree) => worktreeChips(w).map((c) => c.kind);
const chip = (w: Worktree, k: string) => worktreeChips(w).find((c) => c.kind === k);

describe("worktreeChips", () => {
  it("extracts a Linear id from the name (uppercase)", () => {
    expect(chip({ ...base, name: "ENG-2841 fix checkout" }, "linear")?.label).toBe("ENG-2841");
  });
  it("links the Linear chip to a linear.app link when present", () => {
    const w = { ...base, name: "ENG-1 x", links: [{ label: "t", url: "https://linear.app/acme/issue/ENG-1" }] };
    expect(chip(w, "linear")?.url).toContain("linear.app");
  });
  it("does not treat 'React 19' or 'pr-4790' as a Linear id", () => {
    expect(kinds({ ...base, name: "Upgrade to React 19" })).not.toContain("linear");
    expect(kinds({ ...base, name: "saved cards", branch: "pr-4790" })).not.toContain("linear");
  });
  it("derives a PR chip from pr-<N> in the branch", () => {
    expect(chip({ ...base, branch: "pr-4790" }, "pr")?.label).toBe("PR #4790");
  });
  it("derives an Issue chip from issue-<N>", () => {
    expect(chip({ ...base, name: "issue-12 thing" }, "issue")?.label).toBe("Issue #12");
  });
  it("derives a preview chip with the port from host.address", () => {
    const c = chip(base, "preview");
    expect(c?.label).toBe("Preview :5173");
    expect(c?.url).toBe("http://localhost:5173");
  });
  it("omits the preview chip when host.address is empty", () => {
    expect(kinds({ ...base, host: { startCmd: "x", address: "" } })).not.toContain("preview");
  });
  it("always includes a static CI stub chip", () => {
    expect(kinds(base)).toContain("ci");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/worktree-column/chips.test.ts`
Expected: FAIL — cannot find module `./chips`.

- [ ] **Step 3: Write minimal implementation**

```ts
// chips.ts — derive display chips for a worktree column from existing model data only (no live providers).
import type { Worktree, WorktreeLink } from "../../settings/types";

export type ChipKind = "linear" | "pr" | "issue" | "preview" | "ci";
export interface Chip { kind: ChipKind; label: string; url?: string }

// findLink: first link whose URL contains the needle (case-insensitive), for chip click-through.
function findLink(links: WorktreeLink[], needle: string): string | undefined {
  return links.find((l) => l.url.toLowerCase().includes(needle))?.url;
}

// worktreeChips: linear (from name) / pr / issue (from name+branch) / preview (from host) + a static CI stub.
export function worktreeChips(w: Worktree): Chip[] {
  const chips: Chip[] = [];

  // Canonical Linear ids are uppercase in the name (ENG-1234); searching the name avoids lowercase branch noise.
  const linear = w.name.match(/\b[A-Z]{2,}-\d+\b/);
  if (linear) chips.push({ kind: "linear", label: linear[0], url: findLink(w.links, "linear.app") });

  const hay = `${w.name} ${w.branch}`;
  const pr = hay.match(/\bpr-(\d+)\b/i);
  const issue = hay.match(/\bissue-(\d+)\b/i);
  if (pr) chips.push({ kind: "pr", label: `PR #${pr[1]}`, url: findLink(w.links, "/pull/") });
  else if (issue) chips.push({ kind: "issue", label: `Issue #${issue[1]}`, url: findLink(w.links, "/issues/") });

  if (w.host.address) {
    const port = w.host.address.match(/:(\d+)/);
    chips.push({ kind: "preview", label: port ? `Preview :${port[1]}` : "Preview", url: w.host.address });
  }

  chips.push({ kind: "ci", label: "CI" }); // stub: real CI integration deferred to a provider sub-project.
  return chips;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/worktree-column/chips.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/worktree-column/chips.ts src/views/worktree-column/chips.test.ts
git commit -m "feat(worktrees): derive column chips from worktree model"
```

---

### Task 3: Theme tokens

**Files:**
- Create: `src/theme/tokens.css`
- Modify: `src/main.tsx` (add one import line)

**Interfaces:**
- Produces: CSS custom properties on `:root` (consumed by every later `.css` file) + a dark `body` baseline.

- [ ] **Step 1: Create the token stylesheet**

```css
/* tokens.css — single source of theme design tokens (dark) + app baseline; imported once in main.tsx. */
:root {
  /* backgrounds */
  --bg: #0d1117;
  --surface: #11161d;
  --surface-raised: #161c24;
  --overlay: rgba(0, 0, 0, 0.6);
  /* borders */
  --border: #232c38;
  --border-subtle: #1a212b;
  /* text */
  --text: #e6edf3;
  --text-secondary: #9aa7b4;
  --text-muted: #6b7785;
  /* accent + semantic */
  --accent: #2dd4bf;
  --accent-fg: #04221d;
  --attention: #f5a623;
  --danger: #f0556d;
  /* spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  /* radii */
  --radius: 8px;
  --radius-sm: 5px;
  /* fonts */
  --font-ui: system-ui, -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
  --font-mono: "SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Code", monospace;
}

* { box-sizing: border-box; }

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

button { font-family: inherit; }
```

- [ ] **Step 2: Import the tokens in `main.tsx`**

Add as the first import in `src/main.tsx`:

```tsx
import "./theme/tokens.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: PASS (tsc + vite build succeed; the CSS import resolves).

- [ ] **Step 4: Commit**

```bash
git add src/theme/tokens.css src/main.tsx
git commit -m "feat(theme): dark design-token stylesheet + baseline"
```

---

### Task 4: Session slot state in the store

**Files:**
- Modify: `src/settings/store.ts`
- Test: `src/settings/store.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `initSlots`, `setSlotAt`, `assignFirstEmpty`, `clearWorktree`, `Slots`, `SLOT_COUNT` from Task 1.
- Produces (on `useSettings`): `slots: Slots`; `setSlot(index: number, id: string | null): void`; `assignNewWorktreeSlot(id: string): void`. `init` now seeds `slots`; `removeWorktree` now also clears the deleted id from `slots`.

- [ ] **Step 1: Write the failing test (append to `store.test.ts`)**

```ts
describe("worktree slots (session state)", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true, slots: [null, null, null] });
  });

  it("init seeds slots from the first 3 ongoing worktrees", () => {
    const w = (id: string, status: "ongoing" | "completed" = "ongoing"): Worktree => ({ ...sampleWt, id, status });
    useSettings.getState().init({
      cockpit: { ...baseCockpit, worktrees: [w("done", "completed"), w("a"), w("b"), w("c"), w("d")] },
      layout: { version: 1, views: {} },
    });
    expect(useSettings.getState().slots).toEqual(["a", "b", "c"]);
  });

  it("setSlot assigns one slot", () => {
    useSettings.getState().setSlot(1, "wt-1");
    expect(useSettings.getState().slots).toEqual([null, "wt-1", null]);
  });

  it("assignNewWorktreeSlot fills the first empty slot", () => {
    useSettings.setState({ slots: ["wt-1", null, null] });
    useSettings.getState().assignNewWorktreeSlot("wt-2");
    expect(useSettings.getState().slots).toEqual(["wt-1", "wt-2", null]);
  });

  it("removeWorktree clears it from its slot", () => {
    useSettings.setState({ cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt] }, slots: ["wt-1", null, null] });
    useSettings.getState().removeWorktree("wt-1");
    expect(useSettings.getState().slots).toEqual([null, null, null]);
    expect(useSettings.getState().cockpit.worktrees).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/settings/store.test.ts`
Expected: FAIL — `slots` / `setSlot` / `assignNewWorktreeSlot` undefined.

- [ ] **Step 3: Implement in `store.ts`**

Add the import near the top:

```ts
import { initSlots, setSlotAt, assignFirstEmpty, clearWorktree, type Slots } from "../views/slots";
```

Add to the `SettingsState` interface (after `removeWorktree`):

```ts
  slots: Slots;
  setSlot: (index: number, id: string | null) => void;
  assignNewWorktreeSlot: (id: string) => void;
```

Add `slots` to the initial state object (after `loaded: false,`):

```ts
  slots: [null, null, null],
```

Replace `init` so it seeds the slots:

```ts
  init: (s) => set({ cockpit: s.cockpit, layout: s.layout, loaded: true, slots: initSlots(s.cockpit.worktrees) }),
```

Replace `removeWorktree` so it also clears the slot (worktree model write + session slot write):

```ts
  removeWorktree: (id) => {
    get().setCockpit((c) => ({ ...c, worktrees: c.worktrees.filter((w) => w.id !== id) }));
    set((st) => ({ slots: clearWorktree(st.slots, id) }));
  },
```

Add the two slot actions (anywhere in the action block, e.g. after `removeWorktree`):

```ts
  // Slots are session-only display state (not persisted): which worktree shows in each of the 3 columns.
  setSlot: (index, id) => set((st) => ({ slots: setSlotAt(st.slots, index, id) })),
  assignNewWorktreeSlot: (id) => set((st) => ({ slots: assignFirstEmpty(st.slots, id) })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/settings/store.test.ts`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat(worktrees): session slot state in the settings store"
```

---

### Task 5: `WorktreePane` (themed terminal pane + chevron collapse)

**Files:**
- Create: `src/views/worktree-column/WorktreePane.tsx`
- Create: `src/views/worktree-column/WorktreePane.css`

**Interfaces:**
- Consumes: `useTerminal`, `UseTerminalArgs` from `src/worktrees/useTerminal.ts` (unchanged).
- Produces: `WorktreePane(props: UseTerminalArgs & { title: string; badge?: ReactNode })`. Open panes `flex: 1`; collapsed panes show header only with the xterm kept mounted (hidden).

- [ ] **Step 1: Create the component**

```tsx
// WorktreePane.tsx — one themed terminal pane: header (chevron collapse + title + badge slot + restart) over a PTY-bound xterm.
import { useState, type ReactNode } from "react";
import { useTerminal, type UseTerminalArgs } from "../../worktrees/useTerminal";
import "./WorktreePane.css";

export function WorktreePane({ title, badge, ...args }: UseTerminalArgs & { title: string; badge?: ReactNode }) {
  const { containerRef, restart } = useTerminal(args);
  const [open, setOpen] = useState(true); // default: all panes open
  return (
    <div className={`wt-pane ${open ? "wt-pane--open" : "wt-pane--closed"}`}>
      <div className="wt-pane__header">
        <button className="wt-pane__chevron" aria-label={open ? "collapse" : "expand"} onClick={() => setOpen((o) => !o)}>
          {open ? "⌄" : "›"}
        </button>
        <span className="wt-pane__title">{title}</span>
        {badge}
        <button className="wt-pane__restart" title="restart" onClick={restart}>↻</button>
      </div>
      {/* Kept mounted when collapsed (CSS hides it) so useTerminal's ResizeObserver re-fits + pty_resizes on expand. */}
      <div ref={containerRef} className="wt-pane__body" />
    </div>
  );
}
```

- [ ] **Step 2: Create the stylesheet**

```css
/* WorktreePane.css — terminal pane chrome; open panes flex-fill the column's vertical space. */
.wt-pane { display: flex; flex-direction: column; border-top: 1px solid var(--border-subtle); min-height: 0; }
.wt-pane--open { flex: 1; }
.wt-pane--closed { flex: 0 0 auto; }
.wt-pane--closed .wt-pane__body { display: none; }

.wt-pane__header {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: var(--surface-raised); color: var(--text-secondary);
  font-size: 11px; user-select: none;
}
.wt-pane__title { font-weight: 600; }
.wt-pane__chevron, .wt-pane__restart {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 12px; line-height: 1; padding: 2px 4px; border-radius: var(--radius-sm);
}
.wt-pane__chevron:hover, .wt-pane__restart:hover { color: var(--text); background: var(--border-subtle); }
.wt-pane__restart { margin-left: auto; }
.wt-pane__body { flex: 1; min-height: 0; padding: var(--space-1); background: var(--bg); }
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: PASS (component is type-checked even though not yet imported).

- [ ] **Step 4: Commit**

```bash
git add src/views/worktree-column/WorktreePane.tsx src/views/worktree-column/WorktreePane.css
git commit -m "feat(worktrees): themed terminal pane with chevron collapse"
```

---

### Task 6: `WorktreeColumn`

**Files:**
- Create: `src/views/worktree-column/WorktreeColumn.tsx`
- Create: `src/views/worktree-column/WorktreeColumn.css`

**Interfaces:**
- Consumes: `useSettings` (`cockpit`, `slots`, `setSlot`, `removeWorktree`), `makePtyId`, `worktreeChips` (Task 2), `WorktreePane` (Task 5), `LinksList` (`src/tiles/worktree/LinksList.tsx`, unchanged), `invoke`, `openUrl`.
- Produces: `WorktreeColumn(props: { slotIndex: number; variant?: "full" | "calm" })`.

- [ ] **Step 1: Create the component**

```tsx
// WorktreeColumn.tsx — one Worktrees-view column: a slot showing a chosen worktree (picker + gear menu + chips + panes + links).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettings } from "../../settings/store";
import { makePtyId } from "../../worktrees/ptyId";
import { worktreeChips } from "./chips";
import { WorktreePane } from "./WorktreePane";
import { LinksList } from "../../tiles/worktree/LinksList";
import "./WorktreeColumn.css";

const ROLES = ["git", "host", "claude"] as const;

export function WorktreeColumn({ slotIndex, variant = "full" }: { slotIndex: number; variant?: "full" | "calm" }) {
  const { cockpit, slots, setSlot, removeWorktree } = useSettings();
  const ongoing = cockpit.worktrees.filter((w) => w.status === "ongoing");
  const active = cockpit.worktrees.find((w) => w.id === slots[slotIndex]);
  const [menuOpen, setMenuOpen] = useState(false);

  // delete: stop the worktree's 3 PTYs, then drop the model (the store also clears it from this slot).
  const deleteActive = async () => {
    if (!active) return;
    setMenuOpen(false);
    for (const role of ROLES) await invoke("pty_kill", { ptyId: makePtyId(active.id, role) });
    removeWorktree(active.id);
  };

  const attention = false; // stub: live "Claude is calling" detection deferred to a provider sub-project.

  return (
    <div className="wt-col">
      <div className="wt-col__header">
        <span className={`wt-col__dot ${attention ? "wt-col__dot--attention" : ""}`} />
        {/* The dropdown title IS the per-slot worktree picker. */}
        <select className="wt-col__picker" value={active?.id ?? ""} onChange={(e) => setSlot(slotIndex, e.target.value || null)}>
          <option value="">Select worktree</option>
          {ongoing.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
        </select>
        {active && (
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

      {!active ? (
        <div className="wt-col__empty">No worktree in this slot.</div>
      ) : (
        // Re-keyed by active.id: switching the picker remounts panes (detach old, attach new) without killing PTYs.
        <div className="wt-col__body" key={active.id}>
          {variant === "full" && (
            <>
              <div className="wt-col__chips">
                {worktreeChips(active).map((c, i) => (
                  <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="wt-col__path">
                {active.repoPath.split("/").pop()} · {active.branch} · {active.worktreePath}
              </div>
            </>
          )}
          <div className="wt-col__panes">
            {variant === "full" && (
              <>
                <WorktreePane title="localhost" worktreeId={active.id} role="host" cwd={active.worktreePath} autostartCmd={active.host.startCmd} />
                <WorktreePane title="git" worktreeId={active.id} role="git" cwd={active.worktreePath} />
              </>
            )}
            <WorktreePane
              title="Claude Code" worktreeId={active.id} role="claude" cwd={active.worktreePath} autostartCmd="claude"
              badge={attention ? <span className="wt-attention">Attention</span> : null}
            />
          </div>
          {variant === "full" && <LinksList worktreeId={active.id} links={active.links} />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the stylesheet**

```css
/* WorktreeColumn.css — one column: header (dot + picker + gear), chips, path, flex-fill panes, links. */
.wt-col {
  flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  overflow: hidden;
}
.wt-col__header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border-bottom: 1px solid var(--border-subtle); }
.wt-col__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); flex: 0 0 auto; }
.wt-col__dot--attention { background: var(--attention); }
.wt-col__picker {
  flex: 1; min-width: 0; background: var(--surface-raised); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 6px; font-size: 13px; font-weight: 600;
}
.wt-col__menu { position: relative; }
.wt-col__gear { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: var(--radius-sm); }
.wt-col__gear:hover { color: var(--text); background: var(--border-subtle); }
.wt-col__menu-pop {
  position: absolute; right: 0; top: 100%; z-index: 10; margin-top: 4px;
  background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius-sm);
  display: flex; flex-direction: column; min-width: 100px; overflow: hidden;
}
.wt-col__menu-pop button { background: none; border: none; color: var(--text); text-align: left; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.wt-col__menu-pop button:hover { background: var(--border-subtle); }
.wt-col__danger { color: var(--danger); }

.wt-col__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.wt-col__chips { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-2); }
.wt-chip {
  background: var(--surface-raised); color: var(--text-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 2px 8px; font-size: 11px; cursor: pointer;
}
.wt-chip:disabled { cursor: default; opacity: 0.8; }
.wt-chip:not(:disabled):hover { color: var(--text); border-color: var(--accent); }
.wt-col__path { padding: 0 var(--space-2) var(--space-2); color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
.wt-col__panes { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.wt-col__empty { padding: var(--space-4); color: var(--text-muted); }
.wt-attention { color: var(--accent-fg); background: var(--attention); border-radius: var(--radius-sm); padding: 1px 6px; font-size: 10px; font-weight: 700; }
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/views/worktree-column/WorktreeColumn.tsx src/views/worktree-column/WorktreeColumn.css
git commit -m "feat(worktrees): worktree column (picker, gear menu, chips, panes)"
```

---

### Task 7: `WorktreesView`

**Files:**
- Create: `src/views/WorktreesView.tsx`
- Create: `src/views/WorktreesView.css`

**Interfaces:**
- Consumes: `WorktreeColumn` (Task 6), `SLOT_COUNT` (Task 1).
- Produces: `WorktreesView()` — 3 equal columns, no horizontal scroll. (The `.wt-view` class is reused by `CalmView` in Task 9.)

- [ ] **Step 1: Create the component**

```tsx
// WorktreesView.tsx — the Worktrees view: three fixed column slots side by side.
import { WorktreeColumn } from "./worktree-column/WorktreeColumn";
import { SLOT_COUNT } from "./slots";
import "./WorktreesView.css";

export function WorktreesView() {
  return (
    <div className="wt-view">
      {Array.from({ length: SLOT_COUNT }, (_, i) => (
        <WorktreeColumn key={i} slotIndex={i} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the stylesheet**

```css
/* WorktreesView.css — three equal columns filling the body; shared by the Calm view. */
.wt-view { display: flex; gap: var(--space-3); height: 100%; padding: var(--space-3); }
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/views/WorktreesView.tsx src/views/WorktreesView.css
git commit -m "feat(worktrees): three-column Worktrees view"
```

---

### Task 8: New-worktree modal

**Files:**
- Create: `src/views/Modal.tsx`
- Create: `src/views/Modal.css`
- Create: `src/views/NewWorktreeModal.tsx`

**Interfaces:**
- Consumes: `NewWorktreeForm` (`src/tiles/worktree/NewWorktreeForm.tsx`, unchanged — prop `onCreated: (id: string) => void`), `useSettings().assignNewWorktreeSlot` (Task 4).
- Produces: `Modal(props: { title: string; onClose: () => void; children: ReactNode })`; `NewWorktreeModal(props: { onClose: () => void })`.

- [ ] **Step 1: Create the generic modal**

```tsx
// Modal.tsx — generic themed overlay: scrim + centered panel; click scrim or ✕ to close.
import type { ReactNode } from "react";
import "./Modal.css";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal__scrim" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">{title}</span>
          <button className="modal__close" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__content">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the modal stylesheet**

```css
/* Modal.css — scrim + centered panel. */
.modal__scrim { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal__panel {
  width: min(560px, 92vw); max-height: 88vh; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
}
.modal__header { display: flex; align-items: center; padding: var(--space-3); border-bottom: 1px solid var(--border-subtle); }
.modal__title { font-weight: 700; }
.modal__close { margin-left: auto; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; }
.modal__close:hover { color: var(--text); }
.modal__content { padding: var(--space-3); overflow: auto; }
```

- [ ] **Step 3: Create the new-worktree modal**

```tsx
// NewWorktreeModal.tsx — hosts the deduce/create form; on create, assigns the worktree to a slot and closes.
import { Modal } from "./Modal";
import { NewWorktreeForm } from "../tiles/worktree/NewWorktreeForm";
import { useSettings } from "../settings/store";

export function NewWorktreeModal({ onClose }: { onClose: () => void }) {
  const { assignNewWorktreeSlot } = useSettings();
  return (
    <Modal title="New worktree" onClose={onClose}>
      <NewWorktreeForm onCreated={(id) => { assignNewWorktreeSlot(id); onClose(); }} />
    </Modal>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/Modal.tsx src/views/Modal.css src/views/NewWorktreeModal.tsx
git commit -m "feat(worktrees): new-worktree modal hosting the deduce form"
```

---

### Task 9: Cockpit + Calm views

**Files:**
- Create: `src/views/CockpitView.tsx`
- Create: `src/views/CockpitView.css`
- Create: `src/views/CalmView.tsx`

**Interfaces:**
- Consumes: `WorktreeColumn` (Task 6), `SLOT_COUNT` (Task 1), `WorktreesView.css` (Task 7, reused).
- Produces: `CockpitView()`; `CalmView()`.

- [ ] **Step 1: Create the Cockpit placeholder**

```tsx
// CockpitView.tsx — themed placeholder for the future dashboard view (no tiles yet; Worktrees replaced Main).
import "./CockpitView.css";

export function CockpitView() {
  return (
    <div className="cockpit-view">
      <div className="cockpit-view__card">
        <h2>Cockpit</h2>
        <p>Dashboard tiles (Slack, PR reviews, CI) land here in a later sub-project.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create its stylesheet**

```css
/* CockpitView.css — centered placeholder card. */
.cockpit-view { height: 100%; display: flex; align-items: center; justify-content: center; padding: var(--space-4); }
.cockpit-view__card { max-width: 420px; text-align: center; color: var(--text-secondary); border: 1px dashed var(--border); border-radius: var(--radius); padding: var(--space-6); }
.cockpit-view__card h2 { margin: 0 0 var(--space-2); color: var(--text); }
.cockpit-view__card p { margin: 0; }
```

- [ ] **Step 3: Create the Calm view (Claude pane per slot)**

```tsx
// CalmView.tsx — decluttered view: each slot shows only its worktree's Claude Code pane (variant="calm").
import { WorktreeColumn } from "./worktree-column/WorktreeColumn";
import { SLOT_COUNT } from "./slots";
import "./WorktreesView.css";

export function CalmView() {
  return (
    <div className="wt-view">
      {Array.from({ length: SLOT_COUNT }, (_, i) => (
        <WorktreeColumn key={i} slotIndex={i} variant="calm" />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/CockpitView.tsx src/views/CockpitView.css src/views/CalmView.tsx
git commit -m "feat(views): Cockpit placeholder + Calm (Claude-only) views"
```

---

### Task 10: App shell swap + remove dockview + cleanup

This task replaces the shell, deletes the dockview machinery, and widens the view-name type. It is the first point the new views render in the app.

**Files:**
- Modify: `src/App.tsx` (full rewrite)
- Create: `src/App.css`
- Modify: `src/settings/types.ts` (widen `defaultView`)
- Modify: `src/settings/store.ts` (default view; remove `setView`)
- Modify: `src/settings/store.test.ts` (update `defaultView` literal)
- Modify: `package.json` (remove `dockview`)
- Delete: `src/layout/Layout.tsx`, `src/layout/UnknownTile.tsx`
- Delete: `src/settings/reconcile.ts`, `src/settings/reconcile.test.ts`
- Delete: `src/tiles/registry.ts`, `src/tiles/registry.test.ts`, `src/tiles/index.ts`
- Delete: `src/tiles/clock/ClockTile.tsx`, `src/tiles/notes/NotesTile.tsx`
- Delete: `src/tiles/worktree/WorktreeTile.tsx`
- Delete: `src/worktrees/TerminalPane.tsx`

**Interfaces:**
- Consumes: `WorktreesView`, `CockpitView`, `CalmView`, `NewWorktreeModal`, `loadSettings`, `useSettings`.

- [ ] **Step 1: Widen the view type in `types.ts`**

Replace the `defaultView` line in `Preferences`:

```ts
export interface Preferences {
  theme: "system" | "light" | "dark";
  defaultView: "cockpit" | "worktrees" | "calm";
}
```

- [ ] **Step 2: Update `store.ts` default + remove `setView`**

In the initial state object, change the preferences default:

```ts
  cockpit: { version: 1, tiles: [], worktrees: [], knownRepos: [], preferences: { theme: "system", defaultView: "worktrees" } },
```

Remove the `setView` line from the `SettingsState` interface and remove the whole `setView` implementation block (the `setView: (view, serialized) => { … }` action). `layout` state, `init`, and `scheduleSave` stay (the layout file still round-trips to Rust untouched; nothing writes geometry now).

- [ ] **Step 3: Update the `defaultView` literal in `store.test.ts`**

Change `baseCockpit`'s preferences:

```ts
  preferences: { theme: "system", defaultView: "worktrees" },
```

- [ ] **Step 4: Rewrite `App.tsx`**

```tsx
// App.tsx — app shell: loads settings, renders the themed header (view switcher + new-worktree) and the active view.
import { useEffect, useState } from "react";
import { loadSettings } from "./settings/api";
import { useSettings } from "./settings/store";
import { WorktreesView } from "./views/WorktreesView";
import { CockpitView } from "./views/CockpitView";
import { CalmView } from "./views/CalmView";
import { NewWorktreeModal } from "./views/NewWorktreeModal";
import "./App.css";

type View = "cockpit" | "worktrees" | "calm";
const VIEWS: { id: View; label: string }[] = [
  { id: "cockpit", label: "Cockpit" },
  { id: "worktrees", label: "Worktrees" },
  { id: "calm", label: "Calm" },
];

// normalizeView: map the persisted defaultView (incl. legacy "main") onto a current view id.
function normalizeView(v: string): View {
  return v === "cockpit" || v === "calm" ? v : "worktrees";
}

function App() {
  const { loaded, init } = useSettings();
  const [view, setView] = useState<View>("worktrees");
  const [creating, setCreating] = useState(false);

  // On startup: pull persisted settings from the Rust core, seed the store, pick the saved default view.
  useEffect(() => {
    loadSettings()
      .then((s) => { init(s); setView(normalizeView(s.cockpit.preferences.defaultView)); })
      .catch((e) => console.error("load failed", e));
  }, [init]);

  if (!loaded) return <div className="app__loading">Loading…</div>;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">cockpit <span className="app__version">v0.4</span></div>
        <nav className="app__segmented">
          {VIEWS.map((v) => (
            <button key={v.id} className={`app__seg ${view === v.id ? "app__seg--active" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <button className="app__new" onClick={() => setCreating(true)}>+ New worktree</button>
      </header>
      <main className="app__body">
        {view === "cockpit" && <CockpitView />}
        {view === "worktrees" && <WorktreesView />}
        {view === "calm" && <CalmView />}
      </main>
      {creating && <NewWorktreeModal onClose={() => setCreating(false)} />}
    </div>
  );
}

export default App;
```

- [ ] **Step 5: Create `App.css`**

```css
/* App.css — shell: header (brand · segmented switcher · new-worktree) + view body. */
.app { display: flex; flex-direction: column; height: 100vh; }
.app__loading { padding: var(--space-5); color: var(--text-secondary); }

.app__header {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); background: var(--surface);
}
.app__brand { font-weight: 700; }
.app__version { color: var(--text-muted); font-weight: 400; font-size: 11px; }

.app__segmented { display: flex; gap: 2px; margin: 0 auto; background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius); padding: 2px; }
.app__seg { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px 14px; border-radius: var(--radius-sm); font-size: 13px; }
.app__seg:hover { color: var(--text); }
.app__seg--active { background: var(--accent); color: var(--accent-fg); font-weight: 600; }

.app__new { background: var(--accent); color: var(--accent-fg); border: none; border-radius: var(--radius-sm); padding: 6px 12px; font-weight: 600; cursor: pointer; }
.app__new:hover { filter: brightness(1.08); }

.app__body { flex: 1; min-height: 0; }
```

- [ ] **Step 6: Delete the dockview machinery**

```bash
git rm src/layout/Layout.tsx src/layout/UnknownTile.tsx \
       src/settings/reconcile.ts src/settings/reconcile.test.ts \
       src/tiles/registry.ts src/tiles/registry.test.ts src/tiles/index.ts \
       src/tiles/clock/ClockTile.tsx src/tiles/notes/NotesTile.tsx \
       src/tiles/worktree/WorktreeTile.tsx \
       src/worktrees/TerminalPane.tsx
```

- [ ] **Step 7: Remove the `dockview` dependency**

Run: `npm uninstall dockview`
Expected: `dockview` removed from `package.json` dependencies and `package-lock.json`.

- [ ] **Step 8: Verify the whole suite + build are green**

Run: `npm test`
Expected: PASS — slots, chips, store, model tests; no references to deleted `reconcile`/`registry` tests.

Run: `npm run build`
Expected: PASS — no lingering imports of `dockview`, `Layout`, `TerminalPane`, `registry`, or `reconcile`.

(If the build reports an unresolved import, grep for it: `grep -rn "dockview\|/Layout\|TerminalPane\|tiles/registry\|tiles/index\|reconcile" src` and remove the stragglers.)

- [ ] **Step 9: Verify the app runs (manual)**

Run: `npm run tauri dev`
Expected: app opens dark-themed; header shows `cockpit v0.4`, the `Cockpit · Worktrees · Calm` switcher, and `+ New worktree`. Worktrees view shows 3 columns; existing worktrees auto-fill slots. `+ New worktree` opens the modal; the deduce/create flow still works; on Create a column fills. Per-pane chevrons collapse/expand and the open panes fill the height. The gear menu offers Hide/Delete. Switch to Calm → Claude-only panes; Cockpit → placeholder.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(shell): themed view switcher; remove dockview + tile registry"
```

---

### Task 11: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `CLAUDE.md`**

In the **As-built notes**, replace the dockview line ("dockview is **6.6.1**…") within the "Stack confirmed in code" bullet so it reads:

```
- **Stack confirmed in code:** Tauri v2 + React **19** + TS (Vite), Rust core.
  The UI is **hand-built views over a CSS design-token theme** (`src/theme/tokens.css`) —
  **dockview was removed** (it fought the fixed, designed layouts; see
  `docs/superpowers/specs/2026-06-23-worktrees-view-and-theme-design.md`). Zustand for the
  live store. Vitest (frontend) + `cargo test` (Rust).
```

Add a new As-built bullet:

```
- **Three views (`src/views/`):** `Cockpit` (themed placeholder — Worktrees replaced the old
  Main view), `Worktrees` (the MVP: 3 fixed column slots, each a `WorktreeColumn` showing one
  running worktree), and `Calm` (same columns, Claude pane only). The active view + the
  per-column **slot→worktree assignment** are **session-only** store state (not persisted; on
  load the first 3 ongoing worktrees auto-fill the slots). Each `WorktreePane` reuses the
  unchanged `useTerminal` hook and adds a chevron collapse (open panes flex-fill). `+ New
  worktree` opens `NewWorktreeModal`, which hosts the unchanged `NewWorktreeForm`. Chips
  (Linear/PR/issue/preview) derive from the worktree model; **CI chip and Claude "Attention"
  badge are styled stubs** (live detection deferred).
```

- [ ] **Step 2: Update the product spec**

In `2026-06-16-cockpit-product-spec.md`, under "Cross-cutting decisions", change decision 1:

```
1. ⛔️ **Layout engine — reversed.** Originally dockview; **removed 2026-06-23** in favour of
   hand-built views over a CSS design-token theme. Free-form tiling was never validated and
   dockview's chrome fought the fixed, designed layouts. See
   `2026-06-23-worktrees-view-and-theme-design.md`. Targeted resize/reorder can return later as
   a deliberate feature.
```

Under "## Main view — three columns", add a note at the top:

```
> Updated 2026-06-23: the app now has three named views — **Cockpit · Worktrees · Calm**.
> The worktree, formerly the right column of "Main", is now the dedicated **Worktrees** view
> (3 fixed slots). "Cockpit" is the future home for the dashboard tiles below.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "docs: record dockview removal + three-view architecture"
```

---

## Self-Review

**Spec coverage:**
- Theme tokens → Task 3. App shell / segmented switcher / `+ New worktree` → Task 10. dockview removal + deletions → Task 10. Slot model + session state → Tasks 1, 4. Worktrees view (3 slots) → Task 7. WorktreeColumn (dot, picker `⌄`, gear Hide/Delete, chips, path, panes, links, calm variant, empty state) → Task 6. WorktreePane + chevron collapse + flex-fill + mounted-when-hidden → Task 5. Chip derivation (Linear/PR/issue/preview + CI stub) → Task 2. Attention stub → Task 6. New-worktree modal → Task 8. Cockpit + Calm → Task 9. Docs → Task 11. **All spec sections covered.**
- Out-of-scope items (slot disk persistence, live Claude/git/CI, DONE/PAUSED, mark-completed, resize/reorder) are intentionally absent — matches the spec's "Out of scope".

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to" — every code step is complete. The only intentional stubs (CI chip, Attention badge) are explicit, styled, and constant-driven (`attention = false`).

**Type consistency:** `Slots = (string | null)[]` used identically in Tasks 1/4/6. Store actions `setSlot(index, id)`, `assignNewWorktreeSlot(id)`, `removeWorktree(id)` match between Task 4 (definition) and Tasks 6/8 (use). `worktreeChips(w): Chip[]` matches between Tasks 2 and 6. `WorktreePane` prop shape (`UseTerminalArgs & { title; badge? }`) matches between Tasks 5 and 6. `NewWorktreeForm`'s real `onCreated` signature is honoured in Task 8. `normalizeView` handles the legacy `"main"` value the widened `defaultView` type no longer allows.
