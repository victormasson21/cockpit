# Notepad tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Notepad tab in the Cockpit view's centre column: a free-form editor backed by one
`note.md` file, a `+ Claude` button that opens a Claude session able to edit that file in place
over several passes, and colour-only code highlighting for pasted code.

**Architecture:** The note is a file under the settings directory; three small Rust commands
read it (with its mtime), write it atomically, and hand back its directory. The React view owns
a textarea, a 500 ms save debounce and a 1 s mtime poll whose reload decision is a pure
function. The Claude pane is the existing `WorktreePane` with entity id `notepad`, cwd = the
note's directory, launched with an appended system prompt. Highlighting is a pure,
language-agnostic tokenizer rendered into a `<pre>` mirror under the transparent-text textarea.

**Tech Stack:** Tauri v2 (Rust commands, `tempfile` in tests), React 19 + TypeScript, Vitest
(`environment: "node"` — pure tests only, no DOM), CSS with the Deep Slate tokens. No new
dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-notepad-tab-design.md`

## Global Constraints

- **No new dependencies**, Rust or JS (spec: "no dependency" for highlighting; poll, not watcher).
- **Note path:** `<settings dir>/notepad/note.md`, where the settings dir is what `commands::config_dir` returns. Nothing about the note goes into `cockpit.json`.
- **Every Rust command is `#[tauri::command(async)]`** — sync commands run on the macOS main thread and hang the spinner (CLAUDE.md as-built note).
- **Save debounce 500 ms; poll 1000 ms;** highlighting skipped above **200 000** characters. Each is a named constant.
- **Colours are theme tokens** (`--tx-3`, `--ok`, `--warn`, `--accent`, `--tx-2`), never literals (theme spec §3 allowed-literal list does not include this feature).
- **Comments:** this project asks for a one-line role comment at the top of every file and a one-line comment on non-obvious blocks (project `CLAUDE.md` → Code conventions). Keep them to that.
- **No compound shell commands in Bash calls** — one command per call (global CLAUDE.md → Tool Usage).
- **Commit on the current branch `feature/text-analysis-space`** through the `/commit` skill (build check + secrets scan). Commit subjects: `type(scope): subject`, imperative.
- **`--allowedTools` spelling is pinned by the packaged-app smoke**, not assumed; the constant lives in one place so the pin is a one-line change.

## Review Focus

1. **Typing while Claude writes the file** — the editor must keep the user's text and its next save must win; no clobber, no caret jump. Pinned in Task 2 (`shouldReload` with `dirty: true`).
2. **The file vanishes while the tab is open** (user deletes it, or a failed atomic rename) — the editor must keep its text, not blank itself. Pinned in Task 1 (missing → empty + `mtime 0`) and Task 2 (`diskMtime` older than known → no reload).
3. **Two writes in the same millisecond** — an equal mtime must not trigger a reload loop. Pinned in Task 2 (`diskMtime === knownMtime` → false).
4. **Prose with apostrophes inside a note that scores as code** (`don't` in a comment or a sentence) — must stay plain, never colour the rest of the line as a string. Pinned in Task 5 (unterminated `'` → `text`).
5. **A pasted URL in code** (`https://…`) — the `//` must not become a comment. Pinned in Task 5.

Not unit-testable (no DOM in Vitest), so on the smoke list in Task 7: flush on tab switch, `+ Claude` on an empty note creating the file first, overlay wrap alignment.

---

### Task 1: Rust note commands

**Files:**
- Create: `src-tauri/src/notepad.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod notepad;` and three handler entries)

**Interfaces:**
- Consumes: `crate::commands::config_dir(&AppHandle) -> PathBuf`, `crate::settings::atomic_write(&Path, &str) -> io::Result<()>`.
- Produces: IPC commands `note_read() -> { text: string, mtimeMs: number }`, `note_write(text) -> number` (the new mtime in ms), `note_dir() -> string` (absolute path, directory created).

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/notepad.rs` with only the test module and the imports it needs:

```rust
//! notepad.rs — the Notepad tab's file: one note.md under <config dir>/notepad, read with its mtime so the
//! frontend can tell an external edit (Claude's) from its own last write.
use crate::commands::config_dir;
use crate::settings::atomic_write;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_note_reads_as_empty_with_mtime_zero() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_note(dir.path()).unwrap(), Note { text: String::new(), mtime_ms: 0 });
    }

    #[test]
    fn write_then_read_round_trips_with_a_real_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let notes = note_dir_path(dir.path());
        let written = write_note(&notes, "hello\n").unwrap();
        let note = read_note(&notes).unwrap();
        assert_eq!(note.text, "hello\n");
        assert_eq!(note.mtime_ms, written);
        assert!(written > 0);
    }

    #[test]
    fn write_creates_the_notepad_directory() {
        let dir = tempfile::tempdir().unwrap();
        let notes = note_dir_path(dir.path());
        assert!(!notes.exists());
        write_note(&notes, "").unwrap();
        assert!(notes.join(NOTE_FILE).is_file());
    }

    #[test]
    fn note_dir_is_the_notepad_folder_under_the_config_dir() {
        assert_eq!(note_dir_path(Path::new("/cfg")), PathBuf::from("/cfg/notepad"));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml notepad`
Expected: compile error — `read_note`, `write_note`, `note_dir_path`, `Note`, `NOTE_FILE` not found.

- [ ] **Step 3: Write the implementation**

Insert between the imports and the test module:

```rust
pub const NOTE_FILE: &str = "note.md";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub text: String,
    pub mtime_ms: u64,
}

pub fn note_dir_path(config_dir: &Path) -> PathBuf {
    config_dir.join("notepad")
}

fn mtime_ms(path: &Path) -> std::io::Result<u64> {
    let modified = std::fs::metadata(path)?.modified()?;
    Ok(modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

// Missing file = empty note, mtime 0: the editor starts blank and nothing is created until the first save.
pub fn read_note(dir: &Path) -> Result<Note, String> {
    let path = dir.join(NOTE_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Note { text, mtime_ms: mtime_ms(&path).map_err(|e| e.to_string())? }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Note { text: String::new(), mtime_ms: 0 }),
        Err(e) => Err(e.to_string()),
    }
}

// Returns the mtime the write produced, so the frontend can treat that exact stamp as "mine".
pub fn write_note(dir: &Path, text: &str) -> Result<u64, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(NOTE_FILE);
    atomic_write(&path, text).map_err(|e| e.to_string())?;
    mtime_ms(&path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn note_read(app: tauri::AppHandle) -> Result<Note, String> {
    read_note(&note_dir_path(&config_dir(&app)))
}

#[tauri::command(async)]
pub fn note_write(app: tauri::AppHandle, text: String) -> Result<u64, String> {
    write_note(&note_dir_path(&config_dir(&app)), &text)
}

// The claude pane's cwd; created here because a PTY cannot start in a directory that does not exist.
#[tauri::command(async)]
pub fn note_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = note_dir_path(&config_dir(&app));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}
```

In `src-tauri/src/lib.rs`: add `mod notepad;` after `mod keychain;` (alphabetical), and add to
`generate_handler![` after `commands::save_settings,`:

```rust
            notepad::note_read,
            notepad::note_write,
            notepad::note_dir,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green, 4 new tests, no warnings from `notepad.rs`.

- [ ] **Step 5: Commit**

`/commit` — message: `feat(notepad): add note read/write/dir commands`

---

### Task 2: Frontend note API and the sync decision

**Files:**
- Create: `src/views/notepad/api.ts`
- Create: `src/views/notepad/noteSync.ts`
- Test: `src/views/notepad/noteSync.test.ts`

**Interfaces:**
- Consumes: the three IPC commands from Task 1.
- Produces: `readNote(): Promise<Note>`, `writeNote(text: string): Promise<number>`, `noteDir(): Promise<string>`, `interface Note { text: string; mtimeMs: number }`; `shouldReload({ diskMtime, knownMtime, dirty }): boolean`; `clampCaret(pos: number, length: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// noteSync.test.ts — the reload rule between the editor and note.md, and caret clamping after a reload.
import { describe, expect, it } from "vitest";
import { clampCaret, shouldReload } from "./noteSync";

describe("shouldReload", () => {
  it("reloads when the file is newer and the editor is clean", () => {
    expect(shouldReload({ diskMtime: 200, knownMtime: 100, dirty: false })).toBe(true);
  });
  it("never reloads over unsaved typing — the editor's next save wins", () => {
    expect(shouldReload({ diskMtime: 200, knownMtime: 100, dirty: true })).toBe(false);
  });
  it("ignores an equal mtime, so the editor's own write never bounces back", () => {
    expect(shouldReload({ diskMtime: 100, knownMtime: 100, dirty: false })).toBe(false);
  });
  it("ignores an older mtime — a vanished file reads as 0 and must not blank the editor", () => {
    expect(shouldReload({ diskMtime: 0, knownMtime: 100, dirty: false })).toBe(false);
  });
  it("loads a fresh file on first poll (nothing known yet)", () => {
    expect(shouldReload({ diskMtime: 1, knownMtime: 0, dirty: false })).toBe(true);
  });
});

describe("clampCaret", () => {
  it("keeps a caret that still fits", () => expect(clampCaret(5, 10)).toBe(5));
  it("pulls a caret past the end back to the end", () => expect(clampCaret(50, 10)).toBe(10));
  it("never goes negative", () => expect(clampCaret(-3, 10)).toBe(0));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/notepad/noteSync.test.ts`
Expected: FAIL — cannot resolve `./noteSync`.

- [ ] **Step 3: Write the implementation**

`src/views/notepad/noteSync.ts`:

```ts
// noteSync.ts — pure decisions for keeping the Notepad editor and note.md in step. No IO, no React.

// Reload from disk only when the file is newer than what the editor last wrote or loaded AND the editor
// holds nothing unsaved — unsaved typing always wins, and its next save overwrites the file.
export function shouldReload({ diskMtime, knownMtime, dirty }: { diskMtime: number; knownMtime: number; dirty: boolean }): boolean {
  return !dirty && diskMtime > knownMtime;
}

// After a reload the caret stays where it was, clamped to the new text.
export const clampCaret = (pos: number, length: number): number => Math.max(0, Math.min(pos, length));
```

`src/views/notepad/api.ts`:

```ts
// api.ts — typed wrappers over the notepad IPC commands (one note.md under the settings dir).
import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust Note: the text plus the file's mtime, the frontend's "is this newer than mine" stamp.
export interface Note {
  text: string;
  mtimeMs: number;
}

export const readNote = () => invoke<Note>("note_read");
// Resolves to the mtime the write produced.
export const writeNote = (text: string) => invoke<number>("note_write", { text });
// The note's directory (created if missing) — the claude pane's cwd.
export const noteDir = () => invoke<string>("note_dir");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/views/notepad`
Expected: 8 passed.

- [ ] **Step 5: Commit**

`/commit` — message: `feat(notepad): add the note IPC wrapper and reload rule`

---

### Task 3: Claude launch command, notepad pty id, attention label

**Files:**
- Modify: `src/worktrees/claudeCmd.ts` (append after `claudePaneAutostart`)
- Modify: `src/worktrees/ptyId.ts` (one exported constant)
- Modify: `src/worktrees/attentionNotifier.ts:17-30` (`attentionLabel`)
- Test: `src/worktrees/claudeCmd.test.ts`, `src/worktrees/attentionNotifier.test.ts`

**Interfaces:**
- Consumes: the private `shellQuote` already in `claudeCmd.ts`.
- Produces: `NOTEPAD_ID = "notepad"` (ptyId.ts); `NOTE_FILE`, `NOTEPAD_SYSTEM_PROMPT`, `NOTEPAD_ALLOWED_TOOLS`, `notepadAutostart(): string` (claudeCmd.ts); `attentionLabel("notepad:claude", …) === "Notepad"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/worktrees/claudeCmd.test.ts` (extend the import line to include `notepadAutostart, NOTEPAD_SYSTEM_PROMPT, NOTEPAD_ALLOWED_TOOLS`):

```ts
describe("notepadAutostart", () => {
  it("launches claude with the notepad system prompt and Edit scoped to the note", () => {
    expect(notepadAutostart()).toBe(
      `claude --append-system-prompt '${NOTEPAD_SYSTEM_PROMPT}' --allowedTools '${NOTEPAD_ALLOWED_TOOLS}'`,
    );
  });
  it("keeps the system prompt free of single quotes, so the quoting above is exact", () => {
    expect(NOTEPAD_SYSTEM_PROMPT).not.toContain("'");
  });
  it("names the note file in both the prompt and the tool scope", () => {
    expect(NOTEPAD_SYSTEM_PROMPT).toContain("note.md");
    expect(NOTEPAD_ALLOWED_TOOLS).toBe("Edit(note.md)");
  });
});
```

Add to the `attentionLabel` describe in `src/worktrees/attentionNotifier.test.ts`:

```ts
  it("names the notepad's claude pane Notepad — it is not a worktree or a scratch", () => {
    expect(attentionLabel("notepad:claude", worktrees, scratch)).toBe("Notepad");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/worktrees/claudeCmd.test.ts src/worktrees/attentionNotifier.test.ts`
Expected: FAIL — `notepadAutostart` is not exported; the Notepad label comes back as `notepad:claude`.

- [ ] **Step 3: Write the implementation**

`src/worktrees/ptyId.ts` — add after the existing exports:

```ts
// The Notepad tab's claude pane entity id: not a worktree, not a scratch, one fixed pane.
export const NOTEPAD_ID = "notepad";
```

`src/worktrees/claudeCmd.ts` — append:

```ts
export const NOTE_FILE = "note.md";

// What the notepad's claude session is told about its job. The note is the deliverable; the terminal is
// for instructions. No single quotes in here: the launch wraps it in them verbatim.
export const NOTEPAD_SYSTEM_PROMPT =
  `The user is editing a notepad: the file ./${NOTE_FILE} in the current directory. ` +
  `Read it before acting. When asked to change it, edit it in place with the Edit tool and change only ` +
  `what the request covers. Reply briefly in the terminal; the note itself is the output.`;

// Edit scoped to the note. The spelling is pinned by the packaged-app smoke (spec → Claude session).
export const NOTEPAD_ALLOWED_TOOLS = `Edit(${NOTE_FILE})`;

export function notepadAutostart(): string {
  return `claude --append-system-prompt ${shellQuote(NOTEPAD_SYSTEM_PROMPT)} --allowedTools ${shellQuote(NOTEPAD_ALLOWED_TOOLS)}`;
}
```

`src/worktrees/attentionNotifier.ts` — import `NOTEPAD_ID` from `./ptyId` and, inside
`attentionLabel`, right after `const role = …`:

```ts
  if (entityId === NOTEPAD_ID) return "Notepad";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/worktrees`
Expected: all green, 4 new tests.

- [ ] **Step 5: Commit**

`/commit` — message: `feat(notepad): add the claude launch command and attention label`

---

### Task 4: NotepadView and the Cockpit tab

**Files:**
- Create: `src/views/notepad/NotepadView.tsx`
- Create: `src/views/notepad/notepad.css`
- Modify: `src/views/CockpitView.tsx` (tabs)
- Modify: `src/views/CockpitView.css` (one selector: the picker only shows on Diff, so no CSS change is needed for it; add nothing unless the headless check says so)

**Interfaces:**
- Consumes: Task 2 (`readNote`, `writeNote`, `noteDir`, `shouldReload`, `clampCaret`), Task 3 (`notepadAutostart`, `NOTEPAD_ID`), existing `WorktreePane`, `killPanes`, `PlusIcon`, `.wt-col__actions`/`.wt-col__action` from `WorktreeColumn.css`.
- Produces: `NotepadView({ claudeDir, onOpenClaude, onCloseClaude })` — the pane-open state is lifted to `CockpitView` so a tab switch (which unmounts the view) does not forget the running pane; `pty_ensure` reattaches and `pty_attach` replays scrollback on remount, the same path a view switch takes in Worktrees.

No unit test: the view is DOM + IPC, and Vitest runs in `node`. The check is the headless harness (Step 4).

- [ ] **Step 1: Write `notepad.css`**

```css
/* notepad.css — the Notepad tab: the editor over an optional claude pane, then the action bar. */
.notepad { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--space-2); }
/* Mono so pasted code aligns, and so the colour overlay (CodeOverlay) shares its metrics exactly. Two
   classes deep on purpose: the tokens.css textarea baseline is (0,1,1) and would otherwise win the font. */
.notepad > .notepad__editor {
  flex: 1; min-height: 0; resize: none;
  font-family: var(--mono); font-size: var(--fs-md); line-height: 1.5; tab-size: 4;
  padding: var(--space-3); white-space: pre-wrap; overflow-wrap: anywhere;
}
.notepad__pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.notepad__actions { padding: 0; }
```

- [ ] **Step 2: Write `NotepadView.tsx`**

```tsx
// NotepadView.tsx — the Cockpit Notepad tab: a textarea over note.md, kept in step with the file by a
// poll, plus an optional claude pane that edits the same file.
import { useCallback, useEffect, useRef, useState } from "react";
import { readNote, writeNote, noteDir } from "./api";
import { clampCaret, shouldReload } from "./noteSync";
import { notepadAutostart } from "../../worktrees/claudeCmd";
import { NOTEPAD_ID } from "../../worktrees/ptyId";
import { killPanes } from "../../worktrees/paneLifecycle";
import { WorktreePane } from "../worktree-column/WorktreePane";
import { PlusIcon } from "../icons";
import "../worktree-column/WorktreeColumn.css";
import "./notepad.css";

const SAVE_DEBOUNCE_MS = 500; // same figure as the settings save: absorb typing, not thrash the disk
const POLL_MS = 1000;

export function NotepadView({ claudeDir, onOpenClaude, onCloseClaude }: {
  claudeDir: string | null; // set = the claude pane is open, and this is its cwd
  onOpenClaude: (dir: string) => void;
  onCloseClaude: () => void;
}) {
  const [text, setText] = useState("");
  // Refs, not state, for what the poll and the debounced save read: they must see the latest values
  // without re-arming the interval or the timer on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;
  const dirtyRef = useRef(false);
  const knownMtimeRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Write what the editor holds now. Dirty clears only if nothing was typed during the write.
  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const snapshot = textRef.current;
    try {
      knownMtimeRef.current = await writeNote(snapshot);
      if (textRef.current === snapshot) dirtyRef.current = false;
    } catch (e) {
      console.error("note save failed", e);
    }
  }, []);

  const onChange = (next: string) => {
    setText(next);
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };

  // Poll the file: an external edit (Claude's) lands in the editor only when nothing here is unsaved.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const note = await readNote();
        if (cancelled) return;
        if (!shouldReload({ diskMtime: note.mtimeMs, knownMtime: knownMtimeRef.current, dirty: dirtyRef.current })) return;
        knownMtimeRef.current = note.mtimeMs;
        const el = editorRef.current;
        setText(note.text);
        // Restore the caret after React has applied the new value; only when the editor has focus,
        // since setSelectionRange scrolls the textarea.
        if (el && document.activeElement === el) {
          const caret = clampCaret(el.selectionStart, note.text.length);
          requestAnimationFrame(() => el.setSelectionRange(caret, caret));
        }
      } catch (e) {
        console.error("note read failed", e);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // A tab switch unmounts the view; unsaved typing must not die with it.
  useEffect(() => () => { if (dirtyRef.current) void save(); }, [save]);

  // The file must exist before Claude reads it, so the (possibly empty) editor is flushed first.
  const openClaude = async () => {
    await save();
    onOpenClaude(await noteDir());
  };
  const closeClaude = async () => {
    await killPanes(NOTEPAD_ID, ["claude"]);
    onCloseClaude();
  };

  return (
    <div className="notepad">
      <textarea
        ref={editorRef} className="notepad__editor" value={text} placeholder="Paste or type…" spellCheck={false}
        onChange={(e) => onChange(e.target.value)} onBlur={() => { if (dirtyRef.current) void save(); }}
      />
      {claudeDir && (
        <div className="notepad__pane">
          <WorktreePane
            title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
            worktreeId={NOTEPAD_ID} role="claude" cwd={claudeDir} autostartCmd={notepadAutostart()}
            onClose={() => void closeClaude()}
          />
        </div>
      )}
      <div className="wt-col__actions notepad__actions">
        <button
          className="wt-col__action" disabled={claudeDir !== null}
          title={claudeDir ? "already running" : "start a claude session on this note"}
          onClick={() => void openClaude()}
        ><PlusIcon /> Claude</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab in `CockpitView.tsx`**

Replace the component body's state and the centre column with:

```tsx
import { NotepadView } from "./notepad/NotepadView";
// (keep the other imports)

export function CockpitView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const worktrees = useSettings((s) => s.cockpit.worktrees);
  const [tab, setTab] = useState<"notepad" | "diff">("notepad"); // session-only; Notepad is the home tab
  // The Diff tab's worktree is picked here and lives only for the session.
  const [diffWorktreeId, setDiffWorktreeId] = useState<string | null>(null);
  const worktree = worktrees.find((w) => w.id === diffWorktreeId) ?? null;
  const pickerGroups = [{ options: worktrees.filter((w) => w.status === "ongoing").map(worktreeOption) }];
  // Lifted out of NotepadView so switching tabs (which unmounts it) does not forget a running pane.
  const [notepadClaudeDir, setNotepadClaudeDir] = useState<string | null>(null);

  const tabButton = (id: "notepad" | "diff", label: string) => (
    <button className={`cockpit-view__tab ${tab === id ? "cockpit-view__tab--active" : ""}`} onClick={() => setTab(id)}>{label}</button>
  );

  return (
    <div className="cockpit-view">
      <aside className="cockpit-view__tiles">
        <div className="cockpit-view__tiles-label">TILES</div>
        <SlackTile onOpenSettings={onOpenSettings} />
        <PrReviewsTile onOpenSettings={onOpenSettings} />
        <TimerTile />
      </aside>
      <div className="cockpit-view__main">
        <nav className="cockpit-view__tabs">
          {tabButton("notepad", "Notepad")}
          {tabButton("diff", "Diff")}
          {tab === "diff" && (
            <Dropdown value={diffWorktreeId} onChange={setDiffWorktreeId} groups={pickerGroups} placeholder="Select a worktree…" variant="form" />
          )}
        </nav>
        {tab === "notepad" ? (
          <NotepadView claudeDir={notepadClaudeDir} onOpenClaude={setNotepadClaudeDir} onCloseClaude={() => setNotepadClaudeDir(null)} />
        ) : worktree ? (
          // Re-keyed by id so switching worktree refetches from scratch.
          <DiffView key={worktree.id} worktree={worktree} />
        ) : (
          <div className="cockpit-view__diff-empty">Select a worktree to see its diff.</div>
        )}
      </div>
      <aside className="cockpit-view__todo">
        <TodoTile />
      </aside>
    </div>
  );
}
```

Update the file's top comment to `… + centre (Notepad | Diff tabs) + right To Do column.` and the
`CockpitView.css` top comment to `flex centre (Notepad | Diff tabs)`.

- [ ] **Step 4: Build, then check headlessly**

Run: `npm run build` — expected clean (tsc + Vite).
Run: `npm test` — expected all green (no new tests in this task).

Headless: with `npx vite --port 1420 --strictPort` running (or the user's own dev server on 1420 —
never kill a server you did not start), run the render harness from the session scratchpad
(`shot.mjs`, see the memory `cockpit-headless-render-harness`) with the `invoke` mock extended:
`note_read` → `{ text: "hello\nworld", mtimeMs: 1 }`, `note_write` → `2`, `note_dir` → `"/tmp/notepad"`.
Screenshot the Cockpit view and check: Notepad tab active by default, editor filled, mono font,
`+ Claude` button full-width under it; click Diff and check the picker appears and the editor is gone;
click Notepad again, click `+ Claude`, check a "Claude Code" pane appears below the editor sharing the
height and the button reads disabled.

- [ ] **Step 5: Commit**

`/commit` — message: `feat(notepad): add the Notepad tab with a claude pane`

---

### Task 5: Highlight tokenizer and code regions

**Files:**
- Create: `src/views/notepad/highlight.ts`
- Test: `src/views/notepad/highlight.test.ts`

**Interfaces:**
- Produces: `type TokenKind = "comment" | "string" | "number" | "keyword" | "punct" | "text"`; `interface Token { kind: TokenKind; text: string }`; `tokenize(code: string): Token[]`; `interface Region { start: number; end: number }`; `codeRegions(text: string): Region[]`; `looksLikeCode(text: string): boolean`; `overlaySegments(text: string): (string | Token[])[]`; `MAX_HIGHLIGHT_CHARS = 200_000`; `CODE_SCORE_THRESHOLD = 0.4`.

- [ ] **Step 1: Write the failing tests**

```ts
// highlight.test.ts — colour-only tokenizing, fence/heuristic region detection, overlay segmenting.
import { describe, expect, it } from "vitest";
import { codeRegions, looksLikeCode, overlaySegments, tokenize, MAX_HIGHLIGHT_CHARS, type Token } from "./highlight";

const kinds = (code: string) => tokenize(code).filter((t) => t.kind !== "text").map((t) => `${t.kind}:${t.text}`);
const joined = (tokens: Token[]) => tokens.map((t) => t.text).join("");

describe("tokenize", () => {
  it("reassembles to the exact input, whatever it was given", () => {
    const sample = "const x = 'a'; // hi\n/* multi\nline */ fn main() { 0xff + 3.14 }\n#!/bin/sh\ndon't";
    expect(joined(tokenize(sample))).toBe(sample);
  });
  it("colours line and block comments", () => {
    expect(kinds("// hi")).toEqual(["comment:// hi"]);
    expect(kinds("a /* b\nc */ d")).toEqual(["comment:/* b\nc */"]);
    expect(kinds("# a note")).toEqual(["comment:# a note"]);
  });
  it("does not treat a URL's // as a comment", () => {
    expect(tokenize("https://linear.app/x").some((t) => t.kind === "comment")).toBe(false);
  });
  it("leaves rust attributes, css hex colours and #include alone", () => {
    expect(kinds("#[derive(Debug)]")).toEqual(["punct:[", "punct:(", "punct:)", "punct:]"]);
    expect(kinds("color: #fff")).toEqual(["punct::"]);
    expect(kinds("#include <x>")).toEqual(["punct:<", "punct:>"]);
  });
  it("colours terminated strings of all three quote kinds, honouring escapes", () => {
    expect(kinds(`"a\\"b" 'c' \`d\``)).toEqual(['string:"a\\"b"', "string:'c'", "string:`d`"]);
  });
  it("leaves an unterminated quote as text — an apostrophe in prose never eats the line", () => {
    expect(kinds("don't panic")).toEqual([]);
    expect(kinds('say "hi')).toEqual([]);
  });
  it("colours numbers but not digits inside identifiers", () => {
    expect(kinds("42 3.14 0xff 1e9 v2 ENG-1234")).toEqual(["number:42", "number:3.14", "number:0xff", "number:1e9", "punct:-", "number:1234"]);
  });
  it("colours shared keywords and leaves other identifiers plain", () => {
    expect(kinds("const fn def return foo")).toEqual(["keyword:const", "keyword:fn", "keyword:def", "keyword:return"]);
  });
  it("merges adjacent plain runs into one token", () => {
    expect(tokenize("foo bar baz")).toEqual([{ kind: "text", text: "foo bar baz" }]);
  });
  it("gives the whole input back as text when it is empty", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("looksLikeCode", () => {
  it("rejects prose", () => {
    expect(looksLikeCode("Hi team, quick update on the release.\nWe shipped the fix for the login bug.\nThanks!")).toBe(false);
  });
  it("accepts typescript", () => {
    expect(looksLikeCode("import { x } from './x';\nexport function f() {\n  return x;\n}")).toBe(true);
  });
  it("accepts a shell snippet", () => {
    expect(looksLikeCode("$ git status\n$ git log --oneline\n")).toBe(true);
  });
  it("accepts anything with a shebang", () => {
    expect(looksLikeCode("#!/bin/bash\necho hi")).toBe(true);
  });
  it("rejects a mixed note that is mostly prose", () => {
    expect(looksLikeCode("Here is what I ran:\nand it printed this line\nthen another line\nfoo();")).toBe(false);
  });
  it("rejects an empty note", () => {
    expect(looksLikeCode("")).toBe(false);
  });
});

describe("codeRegions", () => {
  it("returns the inside of a fenced block, excluding the fence lines", () => {
    const text = "intro\n```ts\nconst a = 1;\n```\noutro";
    expect(codeRegions(text)).toEqual([{ start: 12, end: 25 }]);
    expect(text.slice(12, 25)).toBe("const a = 1;\n");
  });
  it("runs an unterminated fence to the end", () => {
    const text = "intro\n```\nx";
    expect(codeRegions(text)).toEqual([{ start: 10, end: 11 }]);
  });
  it("returns nothing for fence-less prose", () => {
    expect(codeRegions("Hi team, quick update.\nThanks!")).toEqual([]);
  });
  it("returns the whole note when fence-less and it scores as code", () => {
    const text = "const a = 1;\nconst b = 2;";
    expect(codeRegions(text)).toEqual([{ start: 0, end: text.length }]);
  });
  it("prefers fences over the heuristic: prose around a fence stays plain even if code-heavy", () => {
    const text = "const a = 1;\n```\nx = 2;\n```\n";
    expect(codeRegions(text)).toEqual([{ start: 17, end: 24 }]);
  });
});

describe("overlaySegments", () => {
  it("interleaves plain stretches and tokenized code stretches in order", () => {
    const segs = overlaySegments("intro\n```\nx = 1;\n```\n");
    expect(segs[0]).toBe("intro\n```\n");
    expect(Array.isArray(segs[1])).toBe(true);
    expect(segs[2]).toBe("```\n");
  });
  it("returns the whole text plain above the size cap", () => {
    const big = "x = 1;\n".repeat(MAX_HIGHLIGHT_CHARS / 7 + 1);
    expect(overlaySegments(big)).toEqual([big]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/notepad/highlight.test.ts`
Expected: FAIL — cannot resolve `./highlight`.

- [ ] **Step 3: Write the implementation**

```ts
// highlight.ts — colour-only tokenizer for the notepad's code overlay: comments, strings, numbers, one shared
// keyword list, punctuation. Language-agnostic on purpose; anything uncertain stays plain `text`, so the
// failure mode is "uncoloured", never "wrongly coloured".
export type TokenKind = "comment" | "string" | "number" | "keyword" | "punct" | "text";
export interface Token { kind: TokenKind; text: string }
export interface Region { start: number; end: number }

export const MAX_HIGHLIGHT_CHARS = 200_000; // above this the overlay renders plain text
export const CODE_SCORE_THRESHOLD = 0.4;    // share of non-blank lines that must look like code

// Control-flow and declaration words shared across TypeScript, Rust, Python, Bash, Kotlin and Go.
const KEYWORDS = new Set([
  "if", "else", "elif", "for", "while", "do", "return", "break", "continue", "switch", "case", "default", "match",
  "fn", "function", "def", "let", "const", "var", "val", "class", "struct", "enum", "impl", "trait", "interface", "type",
  "import", "from", "export", "use", "pub", "mod", "package", "as", "in", "of", "new", "this", "self", "super",
  "async", "await", "try", "catch", "finally", "throw", "raise", "except", "with", "yield",
  "true", "false", "null", "nil", "None", "undefined", "and", "or", "not", "is", "then", "fi", "done", "esac", "local",
]);

// One pass, first alternative wins. `//` not after `:` or a word char (URLs); `#` not before a word char or
// `[` (#fff, #include, #[derive]); strings must close on their line (backticks may span lines).
const TOKEN_RE =
  /(?<comment>(?<![:\w])\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<!\w)#(?![\w[])[^\n]*)|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<number>\b(?:0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b)|(?<word>[A-Za-z_$][\w$]*)|(?<punct>[{}()[\];,.:=<>+\-*/%!&|^~?@])|(?<text>\s+|.)/gs;

function kindOf(groups: Record<string, string | undefined>): TokenKind {
  if (groups.comment !== undefined) return "comment";
  if (groups.string !== undefined) return "string";
  if (groups.number !== undefined) return "number";
  if (groups.word !== undefined) return KEYWORDS.has(groups.word) ? "keyword" : "text";
  if (groups.punct !== undefined) return "punct";
  return "text";
}

// Adjacent plain runs merge into one token so the overlay stays a short list of spans.
export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  for (const m of code.matchAll(TOKEN_RE)) {
    const kind = kindOf(m.groups ?? {});
    const last = out[out.length - 1];
    if (kind === "text" && last?.kind === "text") last.text += m[0];
    else out.push({ kind, text: m[0] });
  }
  return out;
}

// A line "looks like code" when it ends in a statement/block char, starts with a declaration keyword or a
// shell prompt, or carries a typical operator. Markdown headings deliberately do not count.
const CODE_LINE_RE = /(?:[;{}]\s*$|^\s*(?:import|export|from|use|fn|def|class|const|let|var|pub|struct|impl|if|for|while|return)\b|^\s*\$ |^\s*\/\/|=>|::|\)\s*$)/;

export function looksLikeCode(text: string): boolean {
  if (text.startsWith("#!")) return true;
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return false;
  const hits = lines.filter((l) => CODE_LINE_RE.test(l)).length;
  return hits / lines.length >= CODE_SCORE_THRESHOLD;
}

// Where colour applies: inside ``` fences always (the fence lines themselves stay plain); with no fences at
// all, the whole note when it scores as code, otherwise nowhere.
export function codeRegions(text: string): Region[] {
  const regions: Region[] = [];
  let open: number | null = null; // offset just after the opening fence line
  let pos = 0;
  for (const line of text.split("\n")) {
    const next = pos + line.length + 1;
    if (/^\s*```/.test(line)) {
      if (open === null) open = next;
      else { regions.push({ start: open, end: pos }); open = null; }
    }
    pos = next;
  }
  if (open !== null) regions.push({ start: open, end: text.length });
  if (regions.length > 0 || !looksLikeCode(text)) return regions;
  return [{ start: 0, end: text.length }];
}

// The note as the overlay renders it: plain stretches and tokenized code stretches, in document order.
export function overlaySegments(text: string): (string | Token[])[] {
  if (text.length > MAX_HIGHLIGHT_CHARS) return [text];
  const out: (string | Token[])[] = [];
  let pos = 0;
  for (const r of codeRegions(text)) {
    if (r.start > pos) out.push(text.slice(pos, r.start));
    out.push(tokenize(text.slice(r.start, r.end)));
    pos = r.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/views/notepad/highlight.test.ts`
Expected: all green. If a regex case fails, fix the regex, not the test — each test encodes a spec
behaviour (URLs, attributes, apostrophes). Check the fence offsets by hand: in
`"intro\n```ts\nconst a = 1;\n```\noutro"`, `intro\n` is 6 chars and ```` ```ts\n ```` is 6, so the
region starts at 12; `const a = 1;\n` is 13 chars, so it ends at 25.

- [ ] **Step 5: Commit**

`/commit` — message: `feat(notepad): add the colour-only code tokenizer`

---

### Task 6: CodeOverlay under the editor

**Files:**
- Create: `src/views/notepad/CodeOverlay.tsx`
- Modify: `src/views/notepad/notepad.css`
- Modify: `src/views/notepad/NotepadView.tsx` (wrap the textarea)

**Interfaces:**
- Consumes: `overlaySegments` from Task 5.
- Produces: `CodeOverlay({ text, scrollTop, scrollLeft })`.

- [ ] **Step 1: Write `CodeOverlay.tsx`**

```tsx
// CodeOverlay.tsx — the coloured mirror under the notepad's transparent-text textarea: same text, same
// metrics (shared .notepad__text class), spans only inside the code regions, scrolled with the editor.
import { Fragment, useDeferredValue, useMemo } from "react";
import { overlaySegments } from "./highlight";

export function CodeOverlay({ text, scrollTop, scrollLeft }: { text: string; scrollTop: number; scrollLeft: number }) {
  // Deferred so a keystroke never waits for tokenizing; the overlay catches up a frame later.
  const deferred = useDeferredValue(text);
  const segments = useMemo(() => overlaySegments(deferred), [deferred]);
  return (
    <pre className="notepad__text notepad__overlay" aria-hidden style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {typeof seg === "string"
            ? seg
            : seg.map((t, j) => (t.kind === "text" ? t.text : <span key={j} className={`hl-${t.kind}`}>{t.text}</span>))}
        </Fragment>
      ))}
      {/* A trailing newline in a <pre> collapses; the textarea shows it as an empty line. Keep heights equal. */}
      {"\n"}
    </pre>
  );
}
```

- [ ] **Step 2: Update `notepad.css`**

Replace the `.notepad__editor` rule with:

```css
/* Editor and overlay share every metric that affects wrapping, so glyphs coincide; the overlay is the
   only one that paints text, the textarea paints its caret and selection over it. */
.notepad__editor-wrap { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--bg-3); border-radius: var(--r-sm); }
/* Two classes deep on purpose: the tokens.css textarea baseline is (0,1,1) and would otherwise win. */
.notepad__editor-wrap > .notepad__text {
  box-sizing: border-box; width: 100%; height: 100%; margin: 0;
  font-family: var(--mono); font-size: var(--fs-md); line-height: 1.5; tab-size: 4;
  padding: var(--space-3); border: 1px solid transparent;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.notepad__editor-wrap > .notepad__editor { position: relative; resize: none; background: transparent; color: transparent; caret-color: var(--tx); border-color: var(--bdr); }
.notepad__editor-wrap > .notepad__editor::selection { background: rgba(143, 182, 224, 0.25); }
.notepad__editor-wrap > .notepad__overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; color: var(--tx); }
.hl-comment { color: var(--tx-3); }
.hl-string { color: var(--ok); }
.hl-number { color: var(--warn); }
.hl-keyword { color: var(--accent); }
.hl-punct { color: var(--tx-2); }
```

The selection colour reuses the terminal's `selectionBackground` literal because the textarea's own
text is transparent and the baseline selection colour would hide the overlay glyphs; if a
`--selection` token exists in `deepSlate.css` at implementation time, use it instead.

- [ ] **Step 3: Wire it into `NotepadView.tsx`**

Add `const [scroll, setScroll] = useState({ top: 0, left: 0 });` beside the other state, import
`CodeOverlay`, and replace the bare `<textarea …/>` with:

```tsx
      <div className="notepad__editor-wrap">
        <CodeOverlay text={text} scrollTop={scroll.top} scrollLeft={scroll.left} />
        <textarea
          ref={editorRef} className="notepad__text notepad__editor" value={text} placeholder="Paste or type…" spellCheck={false}
          onChange={(e) => onChange(e.target.value)} onBlur={() => { if (dirtyRef.current) void save(); }}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
        />
      </div>
```

The overlay comes first in the DOM and the textarea (positioned, later) paints above it — caret
and selection over coloured glyphs.

- [ ] **Step 4: Build, test, check alignment headlessly**

Run: `npm run build` — clean. Run: `npm test` — green.

Headless (same harness as Task 4, `note_read` returning a mixed note: two prose lines, a ```ts fence
with a comment, a string, a number and `const`, then a long unbroken URL line). Screenshot at
1600×900 and check: the fence body is coloured, the prose is not, the URL wraps identically in
both layers (no doubled or offset glyphs), the caret is visible, and a drag-selection is visible.
Then probe with `getComputedStyle` that `.notepad__editor` and `.notepad__overlay` report the same
`font-size`, `line-height`, `padding` and `width`. If the textarea shows a classic (non-overlay)
scrollbar, add `scrollbar-gutter: stable` to `.notepad__text` and re-check.

- [ ] **Step 5: Commit**

`/commit` — message: `feat(notepad): colour code in the editor with a mirror overlay`

---

### Task 7: Docs and the smoke list

**Files:**
- Modify: `CLAUDE.md` (as-built notes: one bullet)
- Modify: `docs/STATUS.md` (append one entry)
- Modify: `docs/ROADMAP.md` (add the deferred items under "Smaller iterations")
- Modify: `docs/superpowers/specs/2026-09-28-notepad-tab-design.md` (Status line → implemented)

- [ ] **Step 1: CLAUDE.md as-built bullet**

Add after the "Desktop notifications" bullet:

```markdown
- **Notepad tab (2026-09-28):** the Cockpit centre's default tab. The note **is** a file,
  `<settings dir>/notepad/note.md` (`src-tauri/src/notepad.rs`: `note_read` with mtime, atomic `note_write`,
  `note_dir`); nothing in `cockpit.json`. `NotepadView` saves on a 500 ms debounce and polls the mtime every
  1 s; `shouldReload` (pure) reloads only when the file is newer AND the editor has no unsaved typing — the
  user's text always wins. `+ Claude` flushes the note, then opens a `WorktreePane` (`notepad:claude`, cwd = the
  note dir) via `notepadAutostart()`: `claude --append-system-prompt … --allowedTools 'Edit(note.md)'`; the
  pane-open flag lives in `CockpitView` so a tab switch does not forget it. Code colouring is a `<pre>` mirror
  (`CodeOverlay`) under the transparent-text textarea, fed by the language-agnostic `tokenize` in
  `highlight.ts`; colour applies inside ``` fences, or to the whole note when `looksLikeCode` scores it.
  Spec: `docs/superpowers/specs/2026-09-28-notepad-tab-design.md`.
```

- [ ] **Step 2: STATUS.md entry**

Append:

```markdown
✅ **Notepad tab (2026-09-28).** New default Cockpit centre tab: a mono editor over `notepad/note.md` in the
settings dir, a `+ Claude` pane that edits that file in place over several passes (system prompt via
`notepadAutostart`, cwd = the note dir), a 1 s mtime poll with a reload-only-when-clean rule, and colour-only code
highlighting through a mirror overlay (`highlight.ts` tokenizer: comments/strings/numbers/shared keywords/punct;
fences first, whole-note when it scores as code; plain above 200 KB). Spec + plan under `docs/superpowers/`.
Checked headlessly in WebKit. <N> JS tests + <M> Rust tests green; tsc + Vite clean. Packaged-app smoke pending:
pin the `--allowedTools` spelling.
```

Fill `<N>`/`<M>` from the real test runs.

- [ ] **Step 3: ROADMAP.md deferred items**

Under "Smaller iterations", add a `### Notepad` section:

```markdown
### Notepad
- **Restore the claude pane across restarts** (`claude --continue` in the notepad dir; the `restoredWorktrees` idiom applies).
- **Several notes with a picker**; note history via git in the notepad directory.
- **"Send selection to Claude"** — write the selection into the pane's PTY instead of typing a request.
- **Language-specific grammars or Prism** if colour-only proves insufficient (same `Token[]` interface).
```

- [ ] **Step 4: Spec status line**

Change `**Status:** approved design, not yet built …` to `**Status:** implemented on `feature/text-analysis-space` (2026-09-28)`.

- [ ] **Step 5: Commit**

`/commit` — message: `docs: record the Notepad tab`

- [ ] **Step 6: Hand the smoke list to the user** (packaged app, not `tauri dev`)

1. Open Cockpit view → Notepad is active, editor empty with placeholder.
2. Paste text, wait 1 s, check `~/Library/Application Support/com.cockpit.app/notepad/note.md` holds it.
3. Edit `note.md` in another editor → the app reflects it within ~1 s.
4. Type in the app while an external edit lands → the app's text stays and overwrites the file.
5. `+ Claude` → pane opens; ask "tighten the second paragraph" → the editor updates without a caret jump.
   Note whether Claude asked for Edit permission: if it did, try `Edit(./note.md)` and `Edit(**/note.md)` for
   `NOTEPAD_ALLOWED_TOOLS` and pin the one that silences it.
6. Second pass in the same session ("shorter") → updates again.
7. Switch to Diff and back → pane still there, scrollback intact; unsaved typing before the switch survived.
8. Paste a TypeScript file → coloured; paste a Slack thread → not coloured; a note with a ```bash fence →
   only the fence coloured.
9. Bell from the notepad pane while cockpit is unfocused → notification body reads "Notepad".
