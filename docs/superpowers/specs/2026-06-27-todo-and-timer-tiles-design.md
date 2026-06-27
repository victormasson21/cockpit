# To Do + Timer tiles (+ shared Tile shell) — design

> Status: design approved (brainstorming complete). A **smaller iteration**: two
> local, no-auth tiles for the Cockpit view's center column, plus a shared `<Tile>`
> shell that unifies tile chrome across the app. No Rust provider, no background
> work, no network. Stack/conventions: `CLAUDE.md`; backlog: `docs/ROADMAP.md`.

## Goal

Fill the Cockpit view's center placeholder with the two local widgets from the
product mockup: a **To Do** list and a **Timer** (a simple pomodoro-length
countdown). Along the way, extract a reusable **`<Tile>`** shell so every tile —
Slack today, To Do/Timer now, integration tiles later — shares one consistent
chrome (the `icon · TITLE · actions` header + bordered body seen in the mockup).

## Scope

**In scope**
- **`<Tile>` shell** (`src/tiles/Tile.tsx` + `Tile.css`): shared header + body chrome.
- **Refactor `SlackTile`** onto `<Tile>` (it passes its ⚙ into the actions slot).
- **Timer tile** (`src/tiles/timer/`): single configurable countdown, session-only.
- **To Do tile** (`src/tiles/todo/`): 3-state items, persisted to `cockpit.json`.
- **Config**: `todos: TodoItem[]` in Rust `CockpitConfig` + TS mirror (back-compat).
- **Placement**: render To Do + Timer side-by-side in the `CockpitView` center.

**Out of scope (deferred)**
- The **Tickets** panel (a future Linear auth-tile) and the **Home/Diff tab bar**.
- A generic tile **registry / drag / per-user layout config** (deliberately not built
  — the layout is fixed-by-design; see `CLAUDE.md` cross-cutting decision 1).
- To Do **edit-text** and **reorder**; timer **persistence** and **work/break cycles**.
- Notifications/sound when the timer reaches zero (a subtle in-tile cue only).

## Key decisions (from brainstorming)

| Decision | Choice | Why |
|----------|--------|-----|
| Tiling infra | **Shared `<Tile>` shell, hand-placed** | Consistent chrome without a registry; matches the fixed designed layout + "fewer abstractions until needed." |
| Timer | **Simple countdown, 25-min default** | Matches the mockup (time + Start/Pause/Reset); "pomodoro" = the 25-min default, not cycles. |
| Timer state | **Session-only** | A running countdown doesn't meaningfully survive a restart; YAGNI. |
| To Do states | **todo → in_progress → done (click cycles)** | Matches the mockup's three sections. |
| To Do persistence | **Persisted in `cockpit.json`** | A todo list is durable user data. |
| SlackTile | **Refactor onto `<Tile>`** | One chrome definition; removes duplicated header CSS. |

## Architecture

Pure frontend + one persisted config field. No Rust provider, no IPC commands, no
threads. The only Rust change is the serde `CockpitConfig` shape (so the persisted
`todos` round-trips through the existing `load_settings`/`save_settings` path).

### Components (`src/tiles/`)

- **`Tile.tsx`** — `function Tile({ title, icon, actions, children })`. Renders
  `<section class="tile">` → `<header>` (`icon`, uppercase `title`, right-aligned
  `actions` slot) → `<div class="tile__body">{children}</div>`. `icon` and `actions`
  are optional `ReactNode`s. `Tile.css` holds the chrome (border, radius, header
  layout) lifted from the current `slack-tile__*` rules.
- **`timer/TimerTile.tsx`** — countdown widget; all state local (`useState` +
  `setInterval`). Renders inside `<Tile title="TIMER" icon={…}>`.
- **`timer/timer.ts`** — pure `formatTime(seconds: number): string` → `"mm:ss"`.
- **`todo/TodoTile.tsx`** — reads/writes todos via the store; renders inside
  `<Tile title="TO DO" icon={…}>`.
- **`todo/todo.ts`** — pure helpers: `nextState(s: TodoState): TodoState` and
  `groupByState(items: TodoItem[]): { todo: TodoItem[]; in_progress: TodoItem[]; done: TodoItem[] }`.

### Types

```ts
// src/settings/types.ts
export type TodoState = "todo" | "in_progress" | "done";
export interface TodoItem { id: string; text: string; state: TodoState }
// CockpitConfig gains: todos: TodoItem[]
```
```rust
// src-tauri/src/settings.rs — mirror with serde; state is a plain String (TS narrows the domain)
pub struct TodoItem { pub id: String, pub text: String, pub state: String }
// CockpitConfig gains: #[serde(default)] pub todos: Vec<TodoItem>
```

### Store (`src/settings/store.ts`)

Three actions, all via the existing `setCockpit` functional updater (composes with
concurrent writes; debounced disk save already handled):
- `addTodo(text: string)` — append `{ id, text, state: "todo" }`; id is a monotonic
  session counter (`todo-<n>`) mirroring the `scratchSeq` pattern, so ids stay unique
  without `Date.now()`/`Math.random()`.
- `cycleTodo(id: string)` — set that item's `state = nextState(state)`.
- `removeTodo(id: string)` — drop the item.

## Timer behaviour

- **Idle:** show an editable minutes value (default **25**) + **Start**. Editing sets
  the base duration.
- **Running:** show `mm:ss` (via `formatTime`) counting down once per second + **Pause**
  + **Reset**. Pause → **Resume**.
- **Zero:** stop at `00:00` and show a subtle done cue (e.g. the time styled in the
  accent/attention colour). No sound/notification (deferred).
- **Reset:** stop and return to the configured minutes.
- Implementation: a `setInterval` started on Start, cleared on Pause/Reset/unmount.
  `remainingSeconds` in `useState`. No persistence — remounting resets to idle@default.

## To Do behaviour

- **Sections TODO / IN PROGRESS / DONE** via `groupByState`; a section with no items
  is hidden. Items render in array order within each section.
- **Add:** an input at the bottom; Enter (non-empty, trimmed) calls `addTodo` and clears.
- **Cycle:** clicking an item's status glyph calls `cycleTodo` →
  `todo → in_progress → done → todo` (wraps, so a done item can be reopened).
- **Done styling:** strikethrough + muted text.
- **Delete:** a ✕ button revealed on row hover → `removeTodo`.
- **Empty:** with zero todos, show a muted "No todos yet" line above the add input.

## Placement (`CockpitView`)

The center column (today a placeholder card) becomes a row holding **To Do** then
**Timer**, ~2:1 width (To Do wider), matching the mockup's top row. The left TILES
column (Slack) and the deferred Tickets/tabs are unchanged/untouched.

## Error handling

Minimal by nature (local, no I/O): trimmed-empty todo adds are ignored; the timer
clamps at `00:00` and never goes negative (`formatTime` guards `< 0` → `"00:00"`).
Persistence errors are already handled by the existing debounced-save path.

## Testing

Pure-function unit tests only (node Vitest env — no DOM; matches the codebase):
- `timer.ts`: `formatTime` — sub-minute, minutes, the `00:00` floor, negative clamp.
- `todo.ts`: `nextState` full cycle incl. the done→todo wrap; `groupByState` buckets
  correctly and preserves order.
- Rust `settings.rs`: a `TodoItem` round-trip test + a back-compat test (a
  `cockpit.json` without `todos` still loads), mirroring the SP4 `integrations` tests.

Components (`Tile`, `TimerTile`, `TodoTile`) and the SlackTile refactor are verified by
`npm run build` + `cargo build` + a GUI eyeball.

## Reuse / forward seam

`<Tile>` becomes the chrome every tile uses; the Tickets panel and future integration
tiles drop into it. To Do/Timer prove the center column hosts local widgets the same
way the left column hosts integrations — both just place `<Tile>`s into a fixed region.
