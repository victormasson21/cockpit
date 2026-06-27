# To Do + Timer tiles (+ shared Tile shell) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Cockpit view's center column with two local, no-auth tiles — a To Do list (persisted) and a simple countdown Timer (session-only) — built on a new reusable `<Tile>` chrome shell that `SlackTile` also adopts.

**Architecture:** Pure frontend plus one persisted config field (`todos`). No Rust provider, no IPC commands, no threads — the only Rust change is the serde `CockpitConfig` shape so `todos` round-trips through the existing `load_settings`/`save_settings` path. Pure logic (`formatTime`, `nextState`, `groupByState`) is extracted and unit-tested; components are build-verified + GUI-checked (the Vitest env is `node`, no DOM).

**Tech Stack:** React 19 + TypeScript, Zustand store, Rust serde (Tauri config), Vitest (pure-fn tests), `cargo test`.

## Global Constraints

- **No new dependencies, no Rust provider/commands/threads.** Local widgets only.
- **Shared `<Tile>` shell** is the single source of tile chrome: header = `icon · UPPERCASE title · optional actions slot` over a bordered body. `SlackTile` must be refactored onto it (no duplicate header markup/CSS left behind).
- **Theme tokens only** — use the real tokens from `src/theme/tokens.css`: `--surface`, `--surface-raised`, `--border`, `--border-subtle`, `--text`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-fg`, `--attention`, `--radius`, `--radius-sm`, `--space-1..6`. No invented token names, no stray hardcoded px where a token exists.
- **Back-compat config** — the new `todos` field is `#[serde(default)]` on the Rust side; existing `cockpit.json` files must still load (keep the existing back-compat tests green).
- **To Do persists; Timer does not.** To Do lives in `cockpit.json` (`todos`); the Timer is session-only `useState`.
- **To Do states:** `todo → in_progress → done`, clicking the status glyph cycles and **wraps** (done → todo). **Timer:** single countdown, default **25** minutes, Start/Pause(/Resume)/Reset, clamps at `00:00`.
- **File-top role comment** on every new file; concise block comments on non-obvious wiring (project convention).
- **No `Date.now()`/`Math.random()` restriction here** — this is app runtime code (the restriction only applies to Workflow scripts). To Do ids use `crypto.randomUUID()`.

**Test commands:**
- JS (one file): `npx vitest run <path>` · all: `npm test`
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml <name>`
- Builds: `npm run build` · `cargo build --manifest-path src-tauri/Cargo.toml`

---

## File Structure

**Create (frontend):**
- `src/tiles/Tile.tsx` + `src/tiles/Tile.css` — shared chrome shell.
- `src/tiles/timer/TimerTile.tsx` + `src/tiles/timer/timer.css` + `src/tiles/timer/timer.ts` (+ `timer.test.ts`).
- `src/tiles/todo/TodoTile.tsx` + `src/tiles/todo/todo.css` + `src/tiles/todo/todo.ts` (+ `todo.test.ts`).

**Modify:**
- `src/tiles/slack/SlackTile.tsx` + `src/tiles/slack/slack.css` — adopt `<Tile>`, drop the duplicated chrome.
- `src/settings/types.ts` — add `TodoState`, `TodoItem`, `CockpitConfig.todos`.
- `src-tauri/src/settings.rs` — add `TodoItem` + `CockpitConfig.todos` (+ tests).
- `src/settings/store.ts` — `todos: []` default + `addTodo`/`cycleTodo`/`removeTodo` actions.
- `src/views/CockpitView.tsx` + `src/views/CockpitView.css` — render To Do + Timer in the center.

---

## Task 1: Shared `<Tile>` shell + refactor SlackTile onto it

**Files:**
- Create: `src/tiles/Tile.tsx`, `src/tiles/Tile.css`
- Modify: `src/tiles/slack/SlackTile.tsx`, `src/tiles/slack/slack.css`

**Interfaces:**
- Produces: `function Tile({ title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }): JSX.Element` (default export-free named export). CSS classes `.tile`, `.tile__head`, `.tile__icon`, `.tile__title`, `.tile__actions`, `.tile__body`.

- [ ] **Step 1: Create `Tile.tsx`**

```tsx
// Tile.tsx — shared tile chrome: icon + uppercase title + optional actions slot, over a bordered body.
import type { ReactNode } from "react";
import "./Tile.css";

export function Tile({ title, icon, actions, children }: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="tile">
      <header className="tile__head">
        {icon && <span className="tile__icon">{icon}</span>}
        <span className="tile__title">{title}</span>
        {actions && <span className="tile__actions">{actions}</span>}
      </header>
      <div className="tile__body">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Create `Tile.css`** (chrome lifted from the current slack-tile rules, tokenised)

```css
/* Tile.css — shared chrome for every tile: header (icon · TITLE · actions) over a bordered body. */
.tile { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: var(--radius); overflow: hidden; }
.tile__head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-subtle); }
.tile__icon { display: inline-flex; opacity: 0.7; }
.tile__title { flex: 1; font-size: 11px; letter-spacing: 0.08em; opacity: 0.7; }
.tile__actions { display: inline-flex; align-items: center; gap: var(--space-1); }
.tile__body { display: flex; flex-direction: column; min-height: 0; }
```

- [ ] **Step 3: Refactor `SlackTile.tsx`** to render inside `<Tile>` (replace the `<section>`/`<header>` with `<Tile>`; the gear goes in `actions`)

Replace the `import "./slack.css";` line region and the returned JSX. The new file:
```tsx
// SlackTile.tsx — read-only Slack unread panel: first paint from slack_snapshot, live updates via slack://unread.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Tile } from "../Tile";
import { slackSnapshot, slackRefresh } from "./api";
import type { SlackSnapshot } from "./types";
import { relativeTime } from "./time";
import { sortByRecency } from "./rows";
import "./slack.css";

export function SlackTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [snap, setSnap] = useState<SlackSnapshot>({ connected: false, conversations: [] });

  useEffect(() => {
    let un: (() => void) | undefined;
    slackSnapshot().then(setSnap).catch(() => {});
    listen<SlackSnapshot>("slack://unread", (e) => setSnap(e.payload)).then((u) => (un = u)).catch(() => {});
    const onFocus = () => slackRefresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { un?.(); window.removeEventListener("focus", onFocus); };
  }, []);

  const rows = sortByRecency(snap.conversations);
  const now = Date.now();
  const gear = <button className="slack-tile__gear" aria-label="slack settings" onClick={onOpenSettings}>⚙</button>;

  return (
    <Tile title="SLACK" actions={gear}>
      {!snap.connected ? (
        <button className="slack-tile__cta" onClick={onOpenSettings}>Connect Slack in Settings</button>
      ) : rows.length === 0 ? (
        <div className="slack-tile__empty">{snap.error ? `⚠ ${snap.error}` : "All caught up"}</div>
      ) : (
        <ul className="slack-tile__list">
          {rows.map((c) => (
            <li key={c.id} className="slack-tile__row" onClick={() => openUrl(`slack://channel?id=${c.id}`)}>
              <span className="slack-tile__icon">{c.kind === "channel" ? "#" : "@"}</span>
              <span className="slack-tile__body">
                <span className="slack-tile__name">{c.name}</span>
                <span className="slack-tile__preview">{c.latestText}</span>
              </span>
              <span className="slack-tile__meta">
                <span className="slack-tile__time">{relativeTime(Number(c.latestTs), now)}</span>
                <span className="slack-tile__badge">{c.unreadCount}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}
```

- [ ] **Step 4: Trim `slack.css`** — remove the chrome rules now owned by `Tile.css` (`.slack-tile`, `.slack-tile__head`, `.slack-tile__title`). Keep everything else. The new file:

```css
/* slack.css — Slack-tile body styling (chrome lives in Tile.css). */
.slack-tile__gear { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.6; }
.slack-tile__list { list-style: none; margin: 0; padding: 0; }
.slack-tile__row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border-subtle); }
.slack-tile__row:hover { background: var(--surface-raised); }
.slack-tile__icon { width: 16px; text-align: center; opacity: 0.6; }
.slack-tile__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.slack-tile__name { font-size: 12px; font-weight: 600; }
.slack-tile__preview { font-size: 11px; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slack-tile__meta { display: flex; align-items: center; gap: 6px; }
.slack-tile__time { font-size: 10px; opacity: 0.5; }
.slack-tile__badge { font-size: 10px; background: var(--accent); color: var(--accent-fg); border-radius: 8px; padding: 0 6px; min-width: 16px; text-align: center; }
.slack-tile__cta, .slack-tile__empty { padding: 14px 10px; font-size: 12px; opacity: 0.7; text-align: center; background: none; border: none; cursor: pointer; color: inherit; }
```

- [ ] **Step 5: Build + tests**

Run: `npm run build`
Expected: type-checks + bundles clean.
Run: `npm test`
Expected: all JS tests pass (Slack pure-fn tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/tiles/Tile.tsx src/tiles/Tile.css src/tiles/slack/SlackTile.tsx src/tiles/slack/slack.css
git commit -m "refactor(tiles): shared <Tile> chrome shell; SlackTile adopts it"
```

---

## Task 2: Config — `todos` field (Rust + TS types)

**Files:**
- Modify: `src-tauri/src/settings.rs`, `src/settings/types.ts`, `src/settings/store.ts` (default literal only)
- Test: inline `#[cfg(test)]` in `settings.rs`

**Interfaces:**
- Produces (TS): `type TodoState = "todo" | "in_progress" | "done"`; `interface TodoItem { id: string; text: string; state: TodoState }`; `CockpitConfig.todos: TodoItem[]`.
- Produces (Rust): `struct TodoItem { id: String, text: String, state: String }`; `CockpitConfig.todos: Vec<TodoItem>` (`#[serde(default)]`).

- [ ] **Step 1: Write the failing Rust tests**

In `src-tauri/src/settings.rs` `#[cfg(test)] mod tests`, add:
```rust
#[test]
fn cockpit_without_todos_field_still_loads() {
    let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert!(cfg.todos.is_empty());
}

#[test]
fn todos_round_trip() {
    let json = r#"{"version":1,"tiles":[],"worktrees":[],"todos":[{"id":"t1","text":"ship it","state":"in_progress"}],"preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.todos.len(), 1);
    assert_eq!(cfg.todos[0].id, "t1");
    assert_eq!(cfg.todos[0].text, "ship it");
    assert_eq!(cfg.todos[0].state, "in_progress");
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: FAIL — `CockpitConfig` has no field `todos`.

- [ ] **Step 3: Add the Rust struct + field**

In `src-tauri/src/settings.rs`, before `CockpitConfig`:
```rust
// One to-do item: stable id + text + lifecycle state ("todo" | "in_progress" | "done"; TS narrows the domain).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub state: String,
}
```
Add to `CockpitConfig` (after `integrations`):
```rust
    #[serde(default)]
    pub todos: Vec<TodoItem>,
```
In `impl Default for CockpitConfig`, add `todos: vec![],`.

- [ ] **Step 4: Mirror in TypeScript**

In `src/settings/types.ts`, add before `CockpitConfig`:
```ts
export type TodoState = "todo" | "in_progress" | "done";
export interface TodoItem { id: string; text: string; state: TodoState }
```
Add to `CockpitConfig`: `todos: TodoItem[];`
In `src/settings/store.ts`, add `todos: []` to the `cockpit:` default literal (alongside `integrations: {}`).

- [ ] **Step 5: Run — expect PASS + TS build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::`
Expected: all settings tests pass (incl. existing back-compat tests).
Run: `npm run build`
Expected: type-checks clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/settings.rs src/settings/types.ts src/settings/store.ts
git commit -m "feat(todo): persist todos in cockpit.json (Rust + TS config)"
```

---

## Task 3: Timer pure helper (`timer.ts`)

**Files:**
- Create: `src/tiles/timer/timer.ts`, `src/tiles/timer/timer.test.ts`

**Interfaces:**
- Produces: `formatTime(seconds: number): string` → `"mm:ss"`, clamps `< 0` to `"00:00"`.

- [ ] **Step 1: Write the failing test**

Create `src/tiles/timer/timer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatTime } from "./timer";

describe("formatTime", () => {
  it("formats whole minutes", () => { expect(formatTime(25 * 60)).toBe("25:00"); });
  it("formats minutes and seconds with zero-pad", () => { expect(formatTime(65)).toBe("01:05"); });
  it("formats sub-minute", () => { expect(formatTime(5)).toBe("00:05"); });
  it("floors at zero", () => { expect(formatTime(0)).toBe("00:00"); });
  it("clamps negatives to zero", () => { expect(formatTime(-5)).toBe("00:00"); });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/tiles/timer/timer.test.ts`
Expected: FAIL — cannot find `./timer`.

- [ ] **Step 3: Implement `timer.ts`**

```ts
// timer.ts — format a countdown's remaining seconds as mm:ss (negatives clamp to 00:00).
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/tiles/timer/timer.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/timer/timer.ts src/tiles/timer/timer.test.ts
git commit -m "feat(timer): formatTime helper (tested)"
```

---

## Task 4: To Do pure helpers (`todo.ts`)

**Files:**
- Create: `src/tiles/todo/todo.ts`, `src/tiles/todo/todo.test.ts`

**Interfaces:**
- Consumes: `TodoItem`, `TodoState` from `src/settings/types.ts` (Task 2).
- Produces: `nextState(s: TodoState): TodoState` (cycles todo→in_progress→done→todo); `groupByState(items: TodoItem[]): Record<TodoState, TodoItem[]>` (buckets, preserving order).

- [ ] **Step 1: Write the failing test**

Create `src/tiles/todo/todo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextState, groupByState } from "./todo";
import type { TodoItem } from "../../settings/types";

const item = (id: string, state: TodoItem["state"]): TodoItem => ({ id, text: id, state });

describe("nextState", () => {
  it("cycles todo → in_progress → done → todo", () => {
    expect(nextState("todo")).toBe("in_progress");
    expect(nextState("in_progress")).toBe("done");
    expect(nextState("done")).toBe("todo");
  });
});

describe("groupByState", () => {
  it("buckets by state preserving order", () => {
    const items = [item("a", "todo"), item("b", "done"), item("c", "todo"), item("d", "in_progress")];
    const g = groupByState(items);
    expect(g.todo.map((i) => i.id)).toEqual(["a", "c"]);
    expect(g.in_progress.map((i) => i.id)).toEqual(["d"]);
    expect(g.done.map((i) => i.id)).toEqual(["b"]);
  });
  it("returns empty buckets for an empty list", () => {
    expect(groupByState([])).toEqual({ todo: [], in_progress: [], done: [] });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/tiles/todo/todo.test.ts`
Expected: FAIL — cannot find `./todo`.

- [ ] **Step 3: Implement `todo.ts`**

```ts
// todo.ts — pure helpers for the To Do tile: state cycling + grouping by state.
import type { TodoItem, TodoState } from "../../settings/types";

const ORDER: TodoState[] = ["todo", "in_progress", "done"];

// Click cycles todo → in_progress → done → todo (wraps, so a done item can be reopened).
export function nextState(s: TodoState): TodoState {
  return ORDER[(ORDER.indexOf(s) + 1) % ORDER.length];
}

// Bucket items by state, preserving input order within each bucket.
export function groupByState(items: TodoItem[]): Record<TodoState, TodoItem[]> {
  const groups: Record<TodoState, TodoItem[]> = { todo: [], in_progress: [], done: [] };
  for (const it of items) groups[it.state].push(it);
  return groups;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/tiles/todo/todo.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/todo/todo.ts src/tiles/todo/todo.test.ts
git commit -m "feat(todo): nextState + groupByState helpers (tested)"
```

---

## Task 5: Timer tile component (`TimerTile.tsx`)

**Files:**
- Create: `src/tiles/timer/TimerTile.tsx`, `src/tiles/timer/timer.css`

**Interfaces:**
- Consumes: `Tile` (Task 1), `formatTime` (Task 3).
- Produces: `<TimerTile />` (no props).

- [ ] **Step 1: Create `TimerTile.tsx`**

```tsx
// TimerTile.tsx — a simple configurable countdown (default 25 min); session-only state.
import { useEffect, useRef, useState } from "react";
import { Tile } from "../Tile";
import { formatTime } from "./timer";
import "./timer.css";

export function TimerTile() {
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60); // seconds
  const [running, setRunning] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Drive the countdown while running; stop at zero. Cleared on pause/reset/unmount.
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(tick.current); setRunning(false); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running]);

  const start = () => { if (remaining > 0) setRunning(true); };
  const pause = () => setRunning(false);
  const reset = () => { setRunning(false); setRemaining(minutes * 60); };
  // Edit minutes only while truly idle (at a full, un-started duration); keep the display in sync.
  const editMinutes = (m: number) => { const v = Math.max(1, Math.min(180, Math.floor(m) || 0)); setMinutes(v); setRemaining(v * 60); };

  const done = remaining === 0;
  const idleFull = !running && remaining === minutes * 60;

  return (
    <Tile title="TIMER" icon={<span>⏱</span>}>
      <div className="timer">
        <div className={`timer__time ${done ? "timer__time--done" : ""}`}>{formatTime(remaining)}</div>
        <div className="timer__controls">
          {!running
            ? <button className="timer__btn timer__btn--primary" onClick={start} disabled={done}>Start</button>
            : <button className="timer__btn timer__btn--primary" onClick={pause}>Pause</button>}
          <button className="timer__btn" onClick={reset}>Reset</button>
          {idleFull && (
            <label className="timer__min">
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => editMinutes(Number(e.target.value))} /> min
            </label>
          )}
        </div>
      </div>
    </Tile>
  );
}
```

- [ ] **Step 2: Create `timer.css`**

```css
/* timer.css — Timer tile body: big countdown + controls. */
.timer { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-4); }
.timer__time { font-size: 48px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
.timer__time--done { color: var(--attention); }
.timer__controls { display: flex; align-items: center; gap: var(--space-2); }
.timer__btn { background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 14px; font-size: 13px; cursor: pointer; }
.timer__btn:hover:not(:disabled) { border-color: var(--accent); }
.timer__btn:disabled { opacity: 0.5; cursor: default; }
.timer__btn--primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; font-weight: 600; }
.timer__min { font-size: 12px; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px; }
.timer__min input { width: 56px; }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: type-checks + bundles clean.

- [ ] **Step 4: Commit**

```bash
git add src/tiles/timer/TimerTile.tsx src/tiles/timer/timer.css
git commit -m "feat(timer): countdown Timer tile"
```

---

## Task 6: Store actions + To Do tile component (`TodoTile.tsx`)

**Files:**
- Modify: `src/settings/store.ts` (add 3 actions)
- Create: `src/tiles/todo/TodoTile.tsx`, `src/tiles/todo/todo.css`

**Interfaces:**
- Consumes: `Tile` (Task 1), `groupByState` (Task 4), `nextState` (Task 4), store config `todos` (Task 2).
- Produces (store): `addTodo(text: string): void`, `cycleTodo(id: string): void`, `removeTodo(id: string): void`. Produces: `<TodoTile />` (no props).

- [ ] **Step 1: Add store actions**

In `src/settings/store.ts`, import `nextState`:
```ts
import { nextState } from "../tiles/todo/todo";
```
Add to the `SettingsState` interface (near the worktree actions):
```ts
  addTodo: (text: string) => void;
  cycleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
```
Add to the store implementation (functional updaters, mirroring `addWorktree`/`updateWorktree`/`removeWorktree`):
```ts
  // To-do items persist in cockpit.json; ids are random so they survive restarts without a counter.
  addTodo: (text) =>
    get().setCockpit((c) => ({ ...c, todos: [...c.todos, { id: crypto.randomUUID(), text, state: "todo" }] })),
  cycleTodo: (id) =>
    get().setCockpit((c) => ({ ...c, todos: c.todos.map((t) => (t.id === id ? { ...t, state: nextState(t.state) } : t)) })),
  removeTodo: (id) =>
    get().setCockpit((c) => ({ ...c, todos: c.todos.filter((t) => t.id !== id) })),
```

- [ ] **Step 2: Create `TodoTile.tsx`**

```tsx
// TodoTile.tsx — local 3-state to-do list (todo/in_progress/done), persisted via the store.
import { useState } from "react";
import { Tile } from "../Tile";
import { useSettings } from "../../settings/store";
import { groupByState } from "./todo";
import type { TodoState } from "../../settings/types";
import "./todo.css";

const SECTIONS: { state: TodoState; label: string }[] = [
  { state: "todo", label: "TODO" },
  { state: "in_progress", label: "IN PROGRESS" },
  { state: "done", label: "DONE" },
];
// Status glyph per state; clicking it cycles to the next state.
const GLYPH: Record<TodoState, string> = { todo: "○", in_progress: "◐", done: "✅" };

export function TodoTile() {
  const { cockpit, addTodo, cycleTodo, removeTodo } = useSettings();
  const [draft, setDraft] = useState("");
  const groups = groupByState(cockpit.todos);

  const add = () => { const t = draft.trim(); if (!t) return; addTodo(t); setDraft(""); };

  return (
    <Tile title="TO DO" icon={<span>☑</span>}>
      <div className="todo">
        {cockpit.todos.length === 0 && <div className="todo__empty">No todos yet</div>}
        {SECTIONS.map(({ state, label }) =>
          groups[state].length === 0 ? null : (
            <div key={state} className="todo__section">
              <div className="todo__section-label">{label}</div>
              {groups[state].map((t) => (
                <div key={t.id} className={`todo__row todo__row--${t.state}`}>
                  <button className="todo__glyph" aria-label="cycle state" onClick={() => cycleTodo(t.id)}>{GLYPH[t.state]}</button>
                  <span className="todo__text">{t.text}</span>
                  <button className="todo__del" aria-label="delete" onClick={() => removeTodo(t.id)}>✕</button>
                </div>
              ))}
            </div>
          )
        )}
        <input className="todo__add" placeholder="Add a to-do…" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      </div>
    </Tile>
  );
}
```

- [ ] **Step 3: Create `todo.css`**

```css
/* todo.css — To Do tile body: sections + rows + add input. */
.todo { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
.todo__empty { color: var(--text-muted); font-size: 12px; }
.todo__section { display: flex; flex-direction: column; gap: var(--space-1); }
.todo__section-label { font-size: 10px; letter-spacing: 0.08em; color: var(--text-muted); }
.todo__row { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; }
.todo__glyph { background: none; border: none; cursor: pointer; color: var(--text-secondary); padding: 0; font-size: 14px; line-height: 1; }
.todo__text { flex: 1; min-width: 0; color: var(--text); }
.todo__row--done .todo__text { text-decoration: line-through; color: var(--text-muted); }
.todo__del { background: none; border: none; cursor: pointer; color: var(--text-muted); opacity: 0; }
.todo__row:hover .todo__del { opacity: 0.7; }
```

- [ ] **Step 4: Build + tests**

Run: `npm run build`
Expected: type-checks + bundles clean.
Run: `npm test`
Expected: all JS tests pass (the todo/timer pure-fn tests + existing).

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts src/tiles/todo/TodoTile.tsx src/tiles/todo/todo.css
git commit -m "feat(todo): store actions + To Do tile"
```

---

## Task 7: Place tiles in the Cockpit center + whole-feature gate

**Files:**
- Modify: `src/views/CockpitView.tsx`, `src/views/CockpitView.css`

**Interfaces:**
- Consumes: `TodoTile` (Task 6), `TimerTile` (Task 5).

- [ ] **Step 1: Render the tiles in `CockpitView.tsx`**

Replace the center placeholder. New file:
```tsx
// CockpitView.tsx — dashboard view: left TILES column (Slack) + center local widgets (To Do, Timer). Worktree column lands later.
import "./CockpitView.css";
import { SlackTile } from "../tiles/slack/SlackTile";
import { TodoTile } from "../tiles/todo/TodoTile";
import { TimerTile } from "../tiles/timer/TimerTile";

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
      </aside>
      <div className="cockpit-view__center">
        <TodoTile />
        <TimerTile />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `CockpitView.css`** — make the center a row (To Do ~2 : Timer ~1), drop the now-unused `.cockpit-view__card`

Replace the `.cockpit-view__center` rule and remove `.cockpit-view__card` styles. The center block becomes:
```css
.cockpit-view__center { flex: 1; display: flex; gap: var(--space-3); align-items: flex-start; }
.cockpit-view__center > :first-child { flex: 2; }
.cockpit-view__center > :last-child { flex: 1; }
```
(Leave `.cockpit-view`, `.cockpit-view__tiles`, `.cockpit-view__tiles-label` unchanged.)

- [ ] **Step 3: Whole-feature gate — build + both suites**

Run: `npm run build`
Expected: clean.
Run: `npm test`
Expected: all JS tests pass.
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/views/CockpitView.tsx src/views/CockpitView.css
git commit -m "feat(cockpit): place To Do + Timer tiles in the center column"
```

---

## Self-Review

**1. Spec coverage:**
- `<Tile>` shell + SlackTile refactor → Task 1. ✅
- Timer tile (countdown, 25 default, Start/Pause/Reset, session-only) → Tasks 3 (formatTime) + 5 (component). ✅
- To Do tile (3-state cycle+wrap, sections, add/delete, persisted) → Tasks 2 (config) + 4 (helpers) + 6 (store actions + component). ✅
- Config `todos` Rust+TS + back-compat → Task 2. ✅
- Placement in center → Task 7. ✅
- Testing (formatTime, nextState, groupByState, Rust round-trip + back-compat) → Tasks 2,3,4. ✅

**2. Placeholder scan:** No TBD/abstract steps — every code step has complete code; error handling is concrete (trimmed-empty add ignored; `formatTime` clamps; timer clears interval on pause/reset/unmount). ✅

**3. Type consistency:** `TodoState`/`TodoItem` defined in Task 2 and consumed identically in Tasks 4 (`todo.ts`), 6 (store + `TodoTile`). `nextState`/`groupByState` signatures match between Task 4 definition and Task 6 use. `formatTime` matches between Task 3 and Task 5. `Tile` prop shape (`title`/`icon`/`actions`/`children`) matches between Task 1 and its consumers (Tasks 1 SlackTile, 5, 6). Store actions `addTodo`/`cycleTodo`/`removeTodo` match between interface and impl and `TodoTile` use. Rust `TodoItem` (`id`/`text`/`state`) ↔ TS `TodoItem` field parity. ✅

> Note: `<Tile>`, `TimerTile`, `TodoTile`, and the SlackTile refactor have no unit tests (the Vitest env is `node`, no DOM — matching the codebase). They are build-verified; behavior is GUI-checked. The logic that *can* be unit-tested (`formatTime`, `nextState`, `groupByState`, Rust serde) is, and that's where the bug risk lives.
