# Notepad tab — design

**Date:** 2026-09-28
**Status:** approved design, not yet built (branch `feature/text-analysis-space`)

## Problem

Text that needs working on — a Slack thread, an email draft, a log excerpt, a snippet — has no
home in cockpit. It gets pasted into a scratch terminal's `claude` session, where it is
read-only and gone when the session ends, or into an editor outside the app.

## Requirement

A **Notepad** tab in the Cockpit view's centre column, beside Diff: a free-form area where text
is pasted and edited, that survives restarts, and from which a Claude session can be started
with the note as a file Claude can **edit in place, over several passes**. Code pasted into it
should be readable — coloured, not linted.

## Behaviour

### The tab

- The centre tab bar becomes `Notepad | Diff`. Notepad is the default tab (it takes over the
  role the old Home tab had). Tab state stays session-only.
- The Diff worktree picker shows only while the Diff tab is active.

### The note

- One note. It **is** a file: `<settings dir>/notepad/note.md`, next to `cockpit.json`.
  Nothing is stored in `cockpit.json`.
- The tab shows a plain `textarea` filling the column. Typing saves to the file on a 500 ms
  debounce (same figure as the settings save). Blur saves immediately.
- Font is `--mono`. It keeps pasted code aligned, and it is what the colour overlay (below)
  needs to line up with the text.
- Empty file, or no file yet → an empty editor with a placeholder ("Paste or type…").
  The directory and file are created on first save, not on launch.

### Claude session

- A footer button row like a worktree column's, with one button: **`+ Claude`**. Clicking it
  opens a `claude` pane below the editor; the editor and pane share the column height the way
  worktree panes do (collapse chevron, expand, restart, close — all existing pane chrome).
- The pane is a normal `WorktreePane`: entity id `notepad`, role `claude`, so its pty id is
  `notepad:claude` and the existing attention glow, "Check me out" badge and desktop
  notification work unchanged. `attentionLabel` gets a `notepad` case so the banner reads
  "Notepad" rather than the raw pty id.
- **cwd is the notepad directory.** The note is then a bare `note.md` to Claude, edit
  permissions can be scoped to that one file, and no project `CLAUDE.md` loads.
- Autostart (`notepadAutostart()`, pure, tested):

  ```
  claude --append-system-prompt '<NOTEPAD_SYSTEM_PROMPT>' --allowedTools 'Edit(note.md)'
  ```

  `NOTEPAD_SYSTEM_PROMPT`: the user's notepad is `./note.md`; read it before acting; edit it in
  place with the Edit tool; change only what the request covers; reply briefly in the terminal,
  the note itself is the output. The user types the first instruction in the pane.
  The exact `--allowedTools` spelling that scopes Edit to one file is **pinned by the smoke**,
  the same way the Linear/Slack MCP tool names were; if scoping is not expressible, launch
  without it and accept one permission prompt per session.
- **Passes are messages.** The session stays open; "another pass, tighter" is typed into the
  pane. Edits the user made in the editor between passes reach Claude because it re-reads the
  file.
- Close on the pane respawns a bare shell (existing behaviour); a second `+ Claude` while the
  pane exists is a no-op. The pane is **not** restored across restarts in this iteration (see
  Deferred).

### Two-way sync (the one new mechanism)

The editor and Claude both write `note.md`; the editor must show Claude's edits without
clobbering the user's typing.

- **Rust:** `note_read() → { text, mtimeMs }` (missing file → empty text, `mtimeMs: 0`),
  `note_write(text) → mtimeMs` (reuses `atomic_write`, creates the directory), and the
  directory path exposed for the pane's cwd. All `async` like the other commands (main-thread
  hang rule).
- **Poll, not watch.** While the Notepad tab is mounted, `note_read` runs every 1 s. It is one
  small file read; a watcher crate or the fs plugin's `watch` is not worth a dependency.
- **Reload rule** (`shouldReload`, pure, tested): reload the editor from disk when the file's
  mtime is newer than the last mtime the editor wrote or loaded **and** the editor has no
  unsaved edits. With unsaved edits, the editor keeps its text and its next debounced save
  wins; Claude's Edit tool then fails on stale content and re-reads, which it already handles.
- On reload the caret is kept at the same offset, clamped to the new length.

## Code colouring — readability, not linting

Second half of the same feature; built after the note + session land, in the same branch.

**Goal:** pasted code reads like code — comments dim, strings and numbers distinct, keywords
visible — with no dependency and no claim of per-language accuracy.

- **Rendering:** the classic overlay. A `<pre>` mirror sits under the `textarea`; the textarea
  paints transparent text and a visible caret; both share font, size, line height, padding,
  `white-space: pre-wrap` and `overflow-wrap: anywhere`, and the mirror's scroll position is
  synced to the textarea's. Colour lives only in the mirror. `--mono` on both is what makes the
  glyphs coincide.
- **One generic tokenizer** (`tokenize`, pure, tested), no per-language grammars. Token classes:
  `comment` (`//`, `#`, `/* */`, `--`, `<!-- -->`), `string` (`'`, `"`, `` ` ``, with escapes),
  `number`, `keyword` (one shared list: the control-flow and declaration words common to
  TypeScript, Rust, Python, Bash, Kotlin, Go — `if else for while return fn function def let
  const var class import from export use pub struct impl match async await try catch …`),
  `punct`, `text`. Anything the tokenizer is unsure of is `text`, in the normal colour — the
  failure mode is "uncoloured", never "wrongly coloured in a distracting way".
- **Colours** are theme tokens, not literals: comment `--tx-3`, string `--ok`, number
  `--warn`, keyword `--accent`, punct `--tx-2`. Adding a token class is one CSS rule.
- **Where it applies** (`codeRegions`, pure, tested): inside ``` fences always, which keeps prose
  prose; across the whole note when no fences exist and `looksLikeCode` scores it as code
  (share of lines ending in `;`, `{`, `}`, `:` or starting with indentation and a keyword,
  shebang, a fence-less `import`/`fn`/`def` at column 0). The score threshold is a named
  constant.
- **Cost guard:** tokenising runs on the debounced text (not per keystroke) and is skipped above
  200 KB — the overlay then renders plain text.

**What this deliberately does not do:** nested template literals, regex literals, JSX,
heredocs, language detection beyond "code or not". If that bar ever matters, Prism (MIT, ~2 KB
core, one small file per language, no runtime deps) replaces `tokenize` behind the same
`Token[]` interface; the overlay does not change.

## Architecture

| Piece | Where | Notes |
|-------|-------|-------|
| `note_read`, `note_write`, `note_dir` | `src-tauri/src/notepad.rs` | pure path helpers tested; reuses `settings::atomic_write` |
| `NotepadView` | `src/views/notepad/NotepadView.tsx` | editor + optional pane + footer; owns the poll and the debounce |
| `noteSync.ts` | `src/views/notepad/` | `shouldReload`, caret clamp — pure |
| `notepadAutostart` | `src/worktrees/claudeCmd.ts` | beside `claudeAutostart`; same `shellQuote` |
| `tokenize`, `codeRegions`, `looksLikeCode` | `src/views/notepad/highlight.ts` | pure; no React |
| `CodeOverlay` | `src/views/notepad/CodeOverlay.tsx` | the mirror `<pre>` |
| tab wiring | `src/views/CockpitView.tsx` | `tab: "notepad" \| "diff"`, default `notepad` |

Store: **no new slice.** The note is on disk; the pane's existence is component state in
`NotepadView` (session-only, like a scratch pane's chrome). The attention slice needs nothing —
it is keyed by pty id.

## Scope of effect

| Surface | Effect |
|---------|--------|
| Cockpit view centre | the feature: new default tab; Diff unchanged behind its tab |
| Worktrees view | none |
| `cockpit.json` | untouched — the note is its own file |
| Attention / notifications | one new label case |

## Testing

- Rust: `note_read` on a missing file → empty + 0; write then read round-trips; the path is
  under the settings dir.
- `noteSync.test.ts`: reload only when newer **and** clean; caret clamp.
- `claudeCmd.test.ts`: `notepadAutostart` quoting.
- `highlight.test.ts`: each token class; fenced-only vs whole-note; `looksLikeCode` on prose,
  on TypeScript, on a shell snippet, on a mixed note.
- Headless WebKit check of the overlay alignment (the render harness).
- Smoke in the packaged app: `+ Claude`, ask for an edit, watch the editor update; type during
  a pass and confirm the editor's text wins; pin the `--allowedTools` spelling.

## Deferred

- Restoring the Claude pane across restarts (`claude --continue` in the notepad dir — the
  `restoredWorktrees` idiom applies, but the pane is session-only for now).
- Several notes with a picker; note history via git in the notepad directory.
- "Send selection to Claude" (write into the pane's PTY) as a shortcut to typing a request.
- Language-specific grammars, or Prism, if colour-only proves insufficient.

## Rejected alternatives

- **`--append-system-prompt` with the note inline.** Cheapest, but Claude cannot write back;
  multi-pass editing was the point.
- **A file watcher** (`notify` crate or `tauri-plugin-fs` watch). A dependency to save a 1 s
  poll of one small file.
- **`contenteditable`.** Selection, undo and paste handling are all worse than a `textarea` +
  overlay for no visual gain.
- **Storing the note in `cockpit.json`.** Claude would then be editing the settings file, and
  the settings save debounce would race the poll.
