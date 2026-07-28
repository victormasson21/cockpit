# Terminal File Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging files from Finder onto a terminal pane types their absolute paths into that pane's PTY, matching Claude Code's documented drag-and-drop behaviour.

**Architecture:** Tauri's native drag-drop (`dragDropEnabled: true`) is the only source of real filesystem paths — a webview strips them from DOM drop events. Native drag-drop is a *window* event, so one listener in `App.tsx` hit-tests the cursor position against panes carrying `data-pty-id` and writes the escaped paths via the existing `pty_write` command. Flipping that flag kills HTML5 drag-and-drop app-wide, so the Todo tile's drag-reorder moves to pointer events **first**, in its own commit.

**Tech Stack:** React 19 + TypeScript, Tauri v2 (`@tauri-apps/api/webview`), Vitest. **No Rust changes.**

**Spec:** `docs/superpowers/specs/2026-07-28-terminal-file-drop-design.md`

## Global Constraints

- **No Rust changes in either task.** `pty_write` already exists and is used unchanged.
- **Two commits, in order.** Task 1 must land and be verified before Task 2 flips the flag. There is no state in which HTML5 DnD and native drag-drop both work.
- **No HTML5 drag-and-drop anywhere after Task 2.** Use pointer events. This inverts the previous project rule.
- **Escaping is backslash, not quoting** — matches Finder → Terminal.app, which is what Claude Code is tested against.
- **`reorderWithinState` in `src/tiles/todo/todo.ts` must not change.** Its five existing tests are the proof that Task 1 preserved reorder semantics.
- **Inserted text ends with a trailing space and no Enter.**
- Comment style per CLAUDE.md: one-line role comment at the top of every new file, one-line intent comment above each non-obvious block.

---

### Task 1: Todo drag handle on pointer events

Removes the app's last HTML5 drag-and-drop consumer. `dragDropEnabled` stays `false` for this whole task, so the tile is verifiable in isolation before anything global moves.

**Files:**
- Modify: `src/tiles/todo/TodoTile.tsx:23-24, 42-52` (drag state, row props, new handle button)
- Modify: `src/tiles/todo/todo.css:6` (row no longer `cursor: grab`) + new `.todo__handle` rule
- Unchanged: `src/tiles/todo/todo.ts`, `src/tiles/todo/todo.test.ts`

**Interfaces:**
- Consumes: `reorderTodo(draggedId, targetId)` from the store (already exists, unchanged); `reorderWithinState` via that action.
- Produces: the `data-todo-id` row attribute convention. Task 2 uses the *same* `elementFromPoint(...).closest("[data-x]")` hit-test shape for panes, but shares no code with it.

**Note on TDD for this task:** there is no new pure logic here — the reorder rule already lives in the tested `reorderWithinState`, and this task only rewires which DOM events drive it. jsdom has no layout or hit-testing engine, so `elementFromPoint` cannot be exercised meaningfully in a unit test. The test gate is therefore **the existing suite staying green** (proving semantics are unchanged) plus the GUI check in Step 6. Do not invent a mock-heavy component test for this; it would assert the mock, not the behaviour.

- [ ] **Step 1: Confirm the existing reorder tests pass before touching anything**

Run: `npx vitest run src/tiles/todo`
Expected: PASS — includes the five `reorderWithinState` cases. This is the baseline Step 5 must match exactly.

- [ ] **Step 2: Replace the row's HTML5 drag props with pointer handlers on a new handle**

In `src/tiles/todo/TodoTile.tsx`, add these three handlers inside the component, after `commitEdit` (line 31):

```tsx
  // Pointer-event drag, started only from the ⋮⋮ handle. HTML5 DnD is unavailable app-wide once
  // Tauri's native drag-drop owns file drops, so we capture the pointer and hit-test rows manually.
  // A dedicated handle (rather than a whole-row drag) keeps the glyph-click and text-click unambiguous.
  const onHandleDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault(); // suppress text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(id);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    // Pointer capture routes moves to the handle, so hit-test the real cursor position for the row.
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-todo-id]");
    const id = row?.getAttribute("data-todo-id") ?? null;
    setDragOverId(id === draggingId ? null : id);
  };
  const onHandleUp = () => {
    if (draggingId && dragOverId) reorderTodo(draggingId, dragOverId);
    setDraggingId(null);
    setDragOverId(null);
  };
```

Then replace the row `<div>` opening tag (lines 42-51) — deleting `draggable`, `onDragStart`, `onDragOver`, `onDragLeave`, `onDrop`, `onDragEnd` and adding `data-todo-id`:

```tsx
                <div
                  key={t.id}
                  data-todo-id={t.id}
                  className={`todo__row todo__row--${t.state}${dragOverId === t.id ? " todo__row--drop-target" : ""}`}
                >
```

And insert the handle as the row's first child, immediately before the `todo__glyph` button (line 52):

```tsx
                  <button
                    className="todo__handle"
                    aria-label="drag to reorder"
                    onPointerDown={editingId === t.id ? undefined : onHandleDown(t.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                  >⋮⋮</button>
```

`editingId === t.id ? undefined : …` preserves today's rule that a row being edited is not draggable.

- [ ] **Step 3: Style the handle and stop the row claiming to be draggable**

In `src/tiles/todo/todo.css`, change line 6 — drop `cursor: grab` from the row, since the row itself is no longer the drag affordance:

```css
.todo__row { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-md); }
```

Then add after the `.todo__row--drop-target` rule (line 7):

```css
/* Drag affordance: hover-revealed like .todo__del. touch-action: none is load-bearing — without it
   the browser claims the gesture for scrolling and pointermove stops firing mid-drag. */
.todo__handle {
  background: none; border: none; padding: 0; cursor: grab; touch-action: none;
  color: var(--tx-3); opacity: 0; letter-spacing: -3px;
  font-size: calc(13px * var(--font-scale)); line-height: 1;
}
.todo__row:hover .todo__handle { opacity: 0.7; }
.todo__handle:active { cursor: grabbing; }
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean. `React.PointerEvent` in a type position needs no namespace import — `src/views/Dropdown.tsx:32` already uses bare `React.KeyboardEvent` alongside named-only imports, so this compiles as written. Do not "fix" it by adding `import type { PointerEvent } from "react"`; that shadows the DOM's global `PointerEvent` and confuses later readers.

- [ ] **Step 5: Re-run the full suite**

Run: `npx vitest run`
Expected: PASS with the **same** test count as Step 1's baseline (166 at time of writing). `reorderWithinState`'s five cases must still pass untouched — if you changed `todo.ts` to make something work, stop and reconsider: the pure rule is correct and only the event wiring should have moved.

- [ ] **Step 6: GUI check (human eyeball — cannot be driven headlessly)**

Run the app (`npm run tauri dev`), go to the Cockpit view's To Do tile with at least three todos in one section:

1. Hover a row → `⋮⋮` fades in at the left.
2. Drag a row by the handle within its section → the drop-target top-border tracks, and it reorders on release.
3. Drag a row onto a *different* section → no change (cross-section is a deliberate no-op).
4. Click the glyph → still cycles state. Click the text → still opens the inline editor. Neither should start a drag.
5. Start editing a row, then try dragging its handle → nothing happens.

- [ ] **Step 7: Commit**

```bash
git add src/tiles/todo/TodoTile.tsx src/tiles/todo/todo.css
git commit -m "refactor: drag todo rows by a handle on pointer events

HTML5 drag-and-drop only works while Tauri's dragDropEnabled is false, which
blocks native file drops into terminal panes. This removes the app's last
HTML5 DnD consumer so that flag can flip.

reorderWithinState and its tests are untouched — only the events driving it
moved, and a dedicated handle keeps the row's glyph/text clicks unambiguous."
```

---

### Task 2: Flip the flag and route native file drops into panes

**Files:**
- Create: `src/worktrees/drop.ts` (pure helpers)
- Create: `src/worktrees/drop.test.ts`
- Modify: `src-tauri/tauri.conf.json:18` (`dragDropEnabled` → `true`)
- Modify: `src/App.tsx` (imports + one new `useEffect`)
- Modify: `src/views/worktree-column/WorktreePane.tsx:72` (add `data-pty-id`)
- Modify: `CLAUDE.md:398` (correct the Todo DnD note; document the flag)

**Interfaces:**
- Consumes: `pty_write` Rust command, signature `{ ptyId: string, bytes: number[] }` — exactly as called in `useTerminal.ts:147`. `makePtyId(worktreeId, role)` is already computed in `WorktreePane.tsx:51` as `ptyId`.
- Produces:
  - `escapeDroppedPath(path: string): string`
  - `formatDroppedPaths(paths: string[]): string`
  - `logicalPoint(p: { x: number; y: number }, dpr: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/worktrees/drop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { escapeDroppedPath, formatDroppedPaths, logicalPoint } from "./drop";

describe("escapeDroppedPath", () => {
  it("leaves a plain path untouched", () => {
    expect(escapeDroppedPath("/Users/me/img.png")).toBe("/Users/me/img.png");
  });

  it("escapes spaces — the macOS screenshot case", () => {
    expect(escapeDroppedPath("/Users/me/Screenshot 2026-07-28 at 14.32.10.png"))
      .toBe("/Users/me/Screenshot\\ 2026-07-28\\ at\\ 14.32.10.png");
  });

  it("escapes an apostrophe", () => {
    expect(escapeDroppedPath("/tmp/it's.png")).toBe("/tmp/it\\'s.png");
  });

  it("escapes shell metacharacters", () => {
    expect(escapeDroppedPath("/tmp/$v&(1).png")).toBe("/tmp/\\$v\\&\\(1\\).png");
  });

  it("escapes a literal backslash", () => {
    expect(escapeDroppedPath("/tmp/a\\b.png")).toBe("/tmp/a\\\\b.png");
  });

  it("leaves non-ASCII filename characters alone", () => {
    expect(escapeDroppedPath("/tmp/café.png")).toBe("/tmp/café.png");
  });
});

describe("formatDroppedPaths", () => {
  it("returns empty string for no paths, so the caller can skip the write", () => {
    expect(formatDroppedPaths([])).toBe("");
  });

  it("appends a trailing space after a single path", () => {
    expect(formatDroppedPaths(["/a.png"])).toBe("/a.png ");
  });

  it("space-separates multiple escaped paths", () => {
    expect(formatDroppedPaths(["/a b.png", "/c.png"])).toBe("/a\\ b.png /c.png ");
  });
});

describe("logicalPoint", () => {
  it("is identity at dpr 1", () => {
    expect(logicalPoint({ x: 400, y: 300 }, 1)).toEqual({ x: 400, y: 300 });
  });

  it("halves physical pixels on a retina display", () => {
    expect(logicalPoint({ x: 400, y: 300 }, 2)).toEqual({ x: 200, y: 150 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/worktrees/drop.test.ts`
Expected: FAIL — `Failed to resolve import "./drop"`.

- [ ] **Step 3: Write the pure helpers**

Create `src/worktrees/drop.ts`:

```ts
// drop.ts — pure helpers turning a native file-drop payload into text for a PTY.

// Characters backslash-escaped so a dropped path survives both a shell and Claude Code's input box.
// Escaping (not quoting) mirrors what Finder → Terminal.app produces, which is the form Claude Code
// is tested against. Load-bearing: macOS screenshot filenames always contain spaces.
const SHELL_SPECIAL = new Set([
  " ", "\t", "\\", '"', "'", "`", "$", "&", "|", ";", "<", ">",
  "(", ")", "*", "?", "[", "]", "{", "}", "~", "!", "#",
]);

export function escapeDroppedPath(path: string): string {
  // Iterating the string yields code points, so multi-byte filename characters pass through intact.
  let out = "";
  for (const ch of path) out += SHELL_SPECIAL.has(ch) ? `\\${ch}` : ch;
  return out;
}

// Escaped paths, space-separated, with a trailing space so the user can keep typing after them.
// No newline: the paths land at the cursor and are never submitted for them.
export function formatDroppedPaths(paths: string[]): string {
  if (paths.length === 0) return "";
  return paths.map(escapeDroppedPath).join(" ") + " ";
}

// Drag-drop payload positions are PHYSICAL pixels; elementFromPoint needs CSS pixels. Note the
// payload arrives as JSON over IPC, so it is a bare {x,y} — PhysicalPosition.toLogical() does NOT
// exist at runtime despite what the TS type claims.
export function logicalPoint(p: { x: number; y: number }, dpr: number): { x: number; y: number } {
  return { x: p.x / dpr, y: p.y / dpr };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/worktrees/drop.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mark panes as drop targets**

In `src/views/worktree-column/WorktreePane.tsx`, line 72 — `ptyId` is already in scope from line 51:

```tsx
      <div ref={containerRef} className="wt-pane__body" data-pty-id={ptyId} />
```

This attribute is the router's entire knowledge of panes. A collapsed pane needs no special casing: `.wt-pane--closed .wt-pane__body` is `display: none` (`WorktreePane.css:8`), and `display:none` elements are not hit-testable.

- [ ] **Step 6: Add the window-level drop router**

In `src/App.tsx`, add to the imports at the top:

```tsx
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { formatDroppedPaths, logicalPoint } from "./worktrees/drop";
```

Then add this effect after the Cmd/Ctrl+N effect (which ends at line 90):

```tsx
  // Native file drop → type the dropped paths into the terminal pane under the cursor (Claude Code's
  // documented drag-and-drop). Window-level because Tauri's drag-drop is a window event, not a DOM
  // one; the DOM is used only as a lookup table, so any future pane carrying data-pty-id gets this free.
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        const text = formatDroppedPaths(e.payload.paths);
        if (!text) return;
        const { x, y } = logicalPoint(e.payload.position, window.devicePixelRatio);
        const ptyId = document.elementFromPoint(x, y)?.closest("[data-pty-id]")?.getAttribute("data-pty-id");
        if (!ptyId) return; // dropped on a tile, the header, or empty space — ignore silently
        invoke("pty_write", { ptyId, bytes: Array.from(new TextEncoder().encode(text)) }).catch(() => {});
      })
      // The listener resolves async: if the effect tore down first, unlisten immediately.
      .then((u) => { if (disposed) u(); else unlisten = u; })
      .catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);
```

- [ ] **Step 7: Flip the flag**

In `src-tauri/tauri.conf.json`, line 18:

```json
        "dragDropEnabled": true,
```

- [ ] **Step 8: Typecheck, build, full suite**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: all clean; suite count = Task 1's baseline + 11.

- [ ] **Step 9: Correct the docs**

In `CLAUDE.md`, the To Do inline-edit/reorder note at line 398 currently says rows reorder "via **native HTML5 DnD**". Replace that mechanism description with the pointer-event handle, and add the global rule — the stale version would send the next change straight back into this trap:

> Rows are **reorderable within their section** by a `⋮⋮` **drag handle** using **pointer events**
> (`onPointerDown` + `setPointerCapture`, then `document.elementFromPoint(...).closest("[data-todo-id]")`
> to hit-test the row under the cursor; `touch-action: none` on the handle is required or the browser
> claims the gesture and pointermove stops firing). **HTML5 DnD is unavailable app-wide** — Tauri's
> `dragDropEnabled: true` (needed for real filesystem paths on file drop) swallows DOM drop events on
> macOS, so never reach for `draggable`/`onDrop` in this app.

Then add a new as-built note documenting the drop feature itself (file drop → `data-pty-id` hit-test → `pty_write`, `src/worktrees/drop.ts`, no Rust changes, spec path).

- [ ] **Step 10: GUI acceptance (human eyeball — a native macOS window cannot be driven headlessly)**

Rebuild and run (`npm run tauri dev`), then:

1. Drop a screenshot whose filename contains spaces onto a **Claude** pane → the backslash-escaped path appears at the cursor, nothing is submitted, and asking Claude about it works.
2. Drop onto a **host** pane and a **scratch shell** → `ls <paste>` resolves the file, proving the escaping.
3. Drop **two files at once** → both paths, space-separated, trailing space.
4. Drop on a **tile, the header, or empty space** → nothing happens, no error, no console noise.
5. **Regression:** reorder a To Do row by its handle → still works with the flag now `true` (this is the check that Task 1 actually decoupled them).

- [ ] **Step 11: Commit**

```bash
git add src/worktrees/drop.ts src/worktrees/drop.test.ts src/App.tsx \
        src/views/worktree-column/WorktreePane.tsx src-tauri/tauri.conf.json CLAUDE.md
git commit -m "feat: drop files from Finder into a terminal pane

Tauri's native drag-drop is the only source of real filesystem paths — a
webview strips them from DOM drop events — so dragDropEnabled flips to true
now that the Todo tile no longer needs HTML5 DnD.

One window-level listener hit-tests the cursor against panes carrying
data-pty-id and pty_writes the backslash-escaped paths with a trailing space
and no newline, matching Finder -> Terminal.app. No Rust changes."
```

---

## Deferred (explicitly out of scope)

- **Drop-target highlight.** Dropping lands wherever the cursor is, with no visual confirmation of which pane will catch it. Deliberately deferred; adding it later means a session-only `dropTarget: string | null` store slice (the event source is window-level, so unlike the focus border there is no local-state option) plus `enter`/`over`/`leave` handling in the router.
- **Dropping onto non-terminal targets** (e.g. a file onto the To Do tile or the deduce prompt).
- **Image paste from the clipboard** — a separate mechanism from drag-drop.
