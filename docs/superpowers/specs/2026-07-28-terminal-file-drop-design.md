# Terminal file drop — drag files from Finder into a terminal pane

**Date:** 2026-07-28
**Status:** approved (brainstorm 2026-07-28)
**Inverts:** the "`dragDropEnabled` must be `false`" project gotcha (CLAUDE.md). Any future work
that reaches for HTML5 drag-and-drop in this app must be read against this spec.

## Goal

Dragging one or more files from Finder onto a terminal pane types their **absolute paths** into
that pane's PTY — the behaviour Claude Code prompts for ("drag and drop files"), and what
Finder → Terminal.app / iTerm already do. The driving use case is handing Claude a screenshot.

Today nothing happens: the drop lands on a `div` with no handler and is discarded.

## Why the current setup blocks it

`src-tauri/tauri.conf.json` sets `dragDropEnabled: false` so the Todo tile's HTML5 drag-reorder
works — Tauri's native drag-drop swallows DOM drop events on macOS.

But a webview **cannot see a dropped file's real path**. WebKit hands the DOM `drop` event a
`File` with bytes and a name and deliberately strips the local path. So while
`dragDropEnabled: false` stands, the real path is unobtainable; the best available fallback is
copying the bytes to a temp file and inserting *that* path — a copy, not the user's file, which is
quietly wrong for anything the user wants Claude to edit in place.

Only Tauri's native drag-drop yields real paths. Hence the flag flips, and the one HTML5-DnD
consumer moves to pointer events.

Decisions from the brainstorm:

| Question | Decision |
|---|---|
| Path source | **Tauri native drag-drop** (`dragDropEnabled: true`) — real absolute paths |
| Rejected alternative | DOM drop + copy bytes to a temp file (path is a copy; bytes through IPC) |
| Rejected alternative | Real path with temp fallback (fallback fires ~always on macOS) |
| File types | **Any** — not images-only; no filtering |
| Inserted text | Escaped paths, space-separated, **trailing space, no Enter** |
| Escaping | **Backslash**, like Finder → Terminal.app (not quoting) |
| Todo reorder | **Explicit `⋮⋮` drag handle** on pointer events (not a whole-row drag threshold) |
| Drop-target highlight | **Deferred** — drop lands wherever the cursor is; no store slice for now |
| Rust changes | **None** |

## Architecture — one window-level router, DOM as the lookup table

Native drag-drop is a **window** event, not a per-element one, so there is exactly one listener.

### The router (`App.tsx`)

A `useEffect` next to the existing global `keydown` effects:

```ts
getCurrentWebview().onDragDropEvent(e => …)   // 'enter' | 'over' | 'drop' | 'leave'
```

Only `drop` is acted on (`enter`/`over`/`leave` are ignored while the highlight is deferred).
Each payload carries a **physical** cursor position, which must be divided by
`devicePixelRatio` before hit-testing — getting this wrong on a Retina display routes every drop
to the wrong pane.

Position → pane resolution:

```ts
document.elementFromPoint(x, y)?.closest("[data-pty-id]")
```

`WorktreePane` already computes `ptyId` (`WorktreePane.tsx:51`); it stamps it onto the body div as
`data-pty-id`. The router therefore knows nothing about terminals, worktrees, or roles — the DOM is
the lookup table, and any future pane type gains drop support purely by carrying the attribute.

A drop resolving to no pane (dropped on a tile, the header, empty space) is **silently ignored** —
no error, no toast.

### What gets written (`src/worktrees/drop.ts`, pure)

On a resolved drop: `pty_write` the formatted paths and nothing else. **No Enter** — the paths land
at the cursor so the user can keep typing around them.

- `escapeDroppedPath(path): string` — prefixes each of `space`, `\`, `"`, `'`, `` ` ``, `$`, `&`,
  `|`, `;`, `<`, `>`, `(`, `)`, `*`, `?`, `[`, `]`, `{`, `}`, `~`, `!`, `#`, `tab` with a backslash.
  **Load-bearing for the main use case:** macOS names screenshots
  `Screenshot 2026-07-28 at 14.32.10.png`, so an unescaped path breaks on the very first file a
  user would drop. Backslash form rather than quoting because that is what Claude Code is tested
  against (Finder → iTerm produces it), and it is equally correct when the target pane is a host or
  scratch shell.
- `formatDroppedPaths(paths): string` — escaped paths joined by a single space, plus a trailing
  space. Multi-file drops work for free. An empty array returns `""`, and the router skips the
  `pty_write` on an empty string rather than writing a stray space.
- `dropCommand(payload, dpr, hitTest)` — the whole routing decision, returning
  `{ ptyId, text } | null`. The DOM hit-test is **injected**, which is what keeps this pure: jsdom
  has no layout engine, but `document.elementFromPoint` is the only part that needs one. So the four
  ways routing can be wrong — non-drop event, empty paths, wrong DPR scaling, nothing under the
  cursor — are all unit-tested, and `App.tsx` retains only the one-line DOM lookup.

Both are pure and unit-tested; all the logic that can be tested headlessly lives here.

## Todo reorder — pointer events behind a drag handle

`TodoTile.tsx` loses `draggable`, `onDragStart`, `onDragOver`, `onDragLeave`, `onDrop`, and
`onDragEnd` from the row. In their place:

- A new **`⋮⋮` handle** at the start of the row is the only drag affordance, carrying
  `onPointerDown` / `onPointerMove` / `onPointerUp` (with `setPointerCapture`).
- Rows carry `data-todo-id` so the same `elementFromPoint` trick resolves the row under the cursor
  during a drag.
- The existing `dragOverId` → `.todo__row--drop-target` top-border highlight is retained.

The handle is chosen over making the whole row draggable: a row is simultaneously clickable (the
glyph cycles state, the text opens the inline editor), and a whole-row pointer drag would need a
movement threshold to disambiguate click from drag. The handle removes the ambiguity outright at
the cost of one glyph. Rows being edited are excluded from dragging, as they are today.

**`reorderWithinState` and its five tests do not change.** That is deliberate: they are the proof
the rework preserved semantics, including the cross-section no-op rule and the
insert-after-on-move-down / insert-at-on-move-up idiom.

## Config and docs

- `src-tauri/tauri.conf.json`: `dragDropEnabled: false → true`.
- CLAUDE.md's DnD gotcha note is **corrected, not appended to** — the new rule is: *no HTML5
  drag-and-drop anywhere in this app; use pointer events.* A stale "must be false" note would
  send the next change straight back into this trap.

## Implementation sequencing — two commits, in this order

Pointer events work regardless of `dragDropEnabled`, so the Todo rework does **not** need the flag
flipped and can land first, independently verifiable:

1. **Todo handle on pointer events** — the `⋮⋮` handle, `data-todo-id`, `reorderWithinState` still
   green. `dragDropEnabled` stays `false`, so todo reorder is provably working *before* anything
   else moves. Revertable on its own.
2. **Flip the flag + add the drop router** — `dragDropEnabled: true`, the `App.tsx` listener,
   `drop.ts`, `data-pty-id`, the CLAUDE.md note correction.

Splitting this way matters because there is no state in which HTML5 DnD and native drag-drop both
work: the moment step 2 lands, any leftover HTML5 DnD is dead. Step 1 removes the last consumer
first, so step 2 flips a flag nothing depends on.

## Error handling

| Case | Behaviour |
|---|---|
| Drop outside any pane | Silently ignored |
| Drop on a collapsed pane | Ignored. The body div stays mounted but `.wt-pane--closed .wt-pane__body` is `display: none` (`WorktreePane.css:8`), and `display:none` elements are not hit-testable, so `elementFromPoint` never resolves one — it falls through to "outside any pane" with no special casing |
| `pty_write` fails (dead PTY) | Caught and ignored, consistent with the existing `onData` path |
| Path with spaces / quotes / apostrophes | Handled by `escapeDroppedPath` |
| Folder dropped | Path inserted like any other — no special casing |

## Testing

**Unit (headless):**

- `escapeDroppedPath` — spaces, double quotes, single quotes/apostrophes, `$`, `&`, parentheses,
  a path needing no escaping.
- `formatDroppedPaths` — single file, multiple files, trailing space present, empty array.
- The physical → logical position conversion at `devicePixelRatio` 1 and 2.
- `dropCommand` with a fake `hitTest` — non-drop events ignored, empty paths ignored, no pane
  resolved, hit-testing done in CSS pixels, and the returned `{ ptyId, text }`.
- `reorderWithinState` — unchanged, must stay green.

**Not unit-tested:** the single `document.elementFromPoint(...).closest("[data-pty-id]")` call, and
the Todo handle's pointer wiring. jsdom has no layout or hit-testing engine, so neither can be
exercised meaningfully — and mocking `elementFromPoint` would assert the mock, not the behaviour.
Everything reachable *around* those calls is pure and tested; they themselves move to the GUI
checklist.

**GUI acceptance (human eyeball — a native macOS window cannot be driven headlessly):**

1. Drop a screenshot with spaces in its name onto a Claude pane → escaped path appears at the
   cursor, no Enter, and Claude can read the file.
2. Drop onto a host pane and a scratch shell → path appears; `ls <dropped path>` resolves.
3. Drop two files at once → both paths, space-separated.
4. Drop outside any pane (a tile, the header) → nothing happens, no error.
5. Todo: drag a row by its handle within a section → reorders. Drag across sections → no-op.
   Click the glyph → still cycles. Click the text → still opens the editor.
