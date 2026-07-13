# Terminal UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the rendering and interaction quality of talking to Claude Code inside cockpit's embedded xterm.js terminals — correct glyph widths, smooth rendering, clickable links, Shift+Enter newlines, truecolor, and Claude's fullscreen TUI.

**Architecture:** Two edit sites. (1) `src/worktrees/useTerminal.ts` — the single hook that owns every xterm instance — gains three addons (Unicode 11 width tables, WebGL renderer, web-links), a larger scrollback, and a custom key handler that turns Shift+Enter into Claude Code's backslash-newline escape. (2) `src-tauri/src/pty.rs` — the single PTY spawn point — sets three environment variables on the child shell (`TERM`, `COLORTERM=truecolor`, `CLAUDE_CODE_NO_FLICKER=1`) so Claude Code renders in truecolor and in its fullscreen alternate-screen TUI. Every change is one addon/option/env line, so each is independently revertible; a Revert Map at the end of this doc lists the exact undo for each.

**Tech Stack:** React 19 + TypeScript, xterm.js v6 (`@xterm/xterm` `^6.0.0`, `@xterm/addon-fit` `^0.11.0`), Tauri v2, Rust (`portable-pty`), Vitest + `cargo test`.

## Global Constraints

- **xterm addon versions must match xterm v6** — install exactly: `@xterm/addon-unicode11@^0.9.0`, `@xterm/addon-webgl@^0.19.0`, `@xterm/addon-web-links@^0.12.0`. (Verified compatible with the installed `@xterm/xterm@6.0.0` on 2026-07-13.)
- **Color philosophy = "let Claude look like Claude"** (user decision 2026-07-13): set `COLORTERM=truecolor`, do **not** set Claude Code's `theme` (leave its default). Do not add `theme: "dark-ansi"`.
- **Fullscreen TUI ships ON** (user decision 2026-07-13), via `CLAUDE_CODE_NO_FLICKER=1` on the child env, and must be revertible in one edit (documented in the Revert Map).
- **Follow CLAUDE.md code conventions:** one-line role comment at top of any new file; one-line intent comment above each non-obvious block; smallest change that works; no new abstractions beyond what a task needs.
- **Do not touch terminal role wiring.** As of `main` the worktree panes are Claude-first (git pane removed); these changes are role-agnostic and apply to every pane via the shared hook / shared spawn, which is correct (any pane may run Claude Code).
- **Baseline to preserve:** 144 JS tests + 108 Rust tests (1 ignored) green; `npm run build` and `cargo build` clean.

---

## File Structure

- `src/worktrees/useTerminal.ts` — **modify.** Add addon imports + wiring, scrollback option, Shift+Enter handler. The one place every xterm instance is constructed.
- `src/worktrees/keys.ts` — **create.** Pure, testable helpers for the Shift+Enter → newline translation (`shouldInsertNewline`, `NEWLINE_ESCAPE`). No IO, no xterm import — mirrors the existing `claudeCmd.ts` / `ptyId.ts` pure-helper pattern.
- `src/worktrees/keys.test.ts` — **create.** Unit tests for `keys.ts`.
- `src-tauri/src/pty.rs` — **modify.** Add a pure `terminal_env()` helper, apply it in `spawn_pty`, and add one test in the existing `mod tests` (line 130).
- `package.json` — **modify** (via `npm install`) — three new dependencies.
- `docs/superpowers/plans/2026-07-13-terminal-ux-improvements.md` — this plan (Revert Map lives here).
- `CLAUDE.md` — **modify.** New "As-built notes" bullet in the final documentation task.

---

### Task 1: Unicode 11 width tables + larger scrollback

Fixes the #1 embedded-Claude visual bug: xterm defaults to Unicode 6 width tables, so Claude Code's emoji/symbols (spinner `✻`, bullets `⏺`, status emoji — all width-2 under modern standards) misalign box borders and the input box. Also raises scrollback from xterm's 1000-line default so a long Claude session isn't truncated in the live pane.

**Files:**
- Modify: `src/worktrees/useTerminal.ts` (Terminal construction ~lines 67-78)
- Modify: `package.json` (add `@xterm/addon-unicode11`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: no new exports; establishes the addon-wiring position inside the mount `useEffect` that Tasks 2–4 also edit.

- [ ] **Step 1: Install the Unicode 11 addon**

Run (from the worktree root):
```bash
npm install @xterm/addon-unicode11@^0.9.0
```
Expected: `package.json` gains the dependency; `npm ls @xterm/addon-unicode11` shows `0.9.0`.

- [ ] **Step 2: Import the addon**

In `src/worktrees/useTerminal.ts`, add after the `FitAddon` import (line 4):
```typescript
import { Unicode11Addon } from "@xterm/addon-unicode11";
```

- [ ] **Step 3: Add scrollback to the Terminal options**

Change the `new Terminal({ ... })` block (currently lines 67-72) to add one line:
```typescript
    const term = new Terminal({
      convertEol: false,
      scrollback: 10000, // Claude sessions blow past xterm's 1000-line default
      fontSize: termFontSize(useSettings.getState().fontScale),
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      theme: TERM_THEME,
    });
```

- [ ] **Step 4: Load the addon and activate version 11**

Immediately after `term.loadAddon(fit);` (currently line 76), add:
```typescript
    // Unicode 11 width tables: match Claude Code's assumption that emoji/wide glyphs are width-2,
    // so its box-drawing UI and input box stay aligned. Must be set before term.open().
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
```

- [ ] **Step 5: Verify the build compiles**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no type errors; Vite build succeeds.

- [ ] **Step 6: Verify existing tests still pass**

Run:
```bash
npx vitest run
```
Expected: 144 passed (no new tests this task — addon wiring is verified by build + GUI eyeball, recorded in the final task).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/worktrees/useTerminal.ts
git commit -m "feat(term): Unicode 11 width tables + larger scrollback"
```

---

### Task 2: WebGL renderer (best-effort, DOM fallback)

Switches xterm from the DOM renderer to GPU-accelerated WebGL. Cockpit mounts several live terminals that redraw constantly while Claude streams/spins; WebGL makes that smooth. Best-effort: if the webview can't provide a WebGL context (or loses it), xterm silently keeps its DOM renderer.

**Files:**
- Modify: `src/worktrees/useTerminal.ts` (after `term.open(...)`, ~line 77)
- Modify: `package.json` (add `@xterm/addon-webgl`)

**Interfaces:**
- Consumes: the mount `useEffect` and `term` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Install the WebGL addon**

Run:
```bash
npm install @xterm/addon-webgl@^0.19.0
```
Expected: `npm ls @xterm/addon-webgl` shows `0.19.0`.

- [ ] **Step 2: Import the addon**

In `src/worktrees/useTerminal.ts`, add after the Unicode11 import:
```typescript
import { WebglAddon } from "@xterm/addon-webgl";
```

- [ ] **Step 3: Load WebGL after open(), with a context-loss fallback**

The WebGL addon must be loaded **after** `term.open(...)` (it needs the rendered canvas). Change the `term.open(containerRef.current!);` / `fit.fit();` block (currently lines 77-78) to:
```typescript
    term.open(containerRef.current!);
    // GPU renderer for smooth streaming/spinner redraws across many live panes. Best-effort:
    // on context loss (or if WebGL is unavailable) dispose so xterm falls back to the DOM renderer.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* WebGL unavailable in this webview — xterm keeps its DOM renderer */
    }
    fit.fit();
```

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no type errors; Vite build succeeds.

- [ ] **Step 5: Verify existing tests still pass**

Run:
```bash
npx vitest run
```
Expected: 144 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/worktrees/useTerminal.ts
git commit -m "feat(term): GPU WebGL renderer with DOM fallback"
```

---

### Task 3: Clickable links via openUrl

Claude Code prints PR URLs, docs links, and localhost preview URLs. In the webview terminal they're dead text. The web-links addon makes them Cmd+clickable; the click handler routes through the app's existing `openUrl` (from `@tauri-apps/plugin-opener`, already a dependency and used elsewhere) so links open in the real browser rather than trying to navigate the webview.

**Files:**
- Modify: `src/worktrees/useTerminal.ts` (imports + after `term.open(...)`)
- Modify: `package.json` (add `@xterm/addon-web-links`)

**Interfaces:**
- Consumes: the mount `useEffect` and `term` from Task 1/2.
- Produces: no new exports.

- [ ] **Step 1: Install the web-links addon**

Run:
```bash
npm install @xterm/addon-web-links@^0.12.0
```
Expected: `npm ls @xterm/addon-web-links` shows `0.12.0`.

- [ ] **Step 2: Import the addon and openUrl**

In `src/worktrees/useTerminal.ts`, add after the WebGL import:
```typescript
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
```

- [ ] **Step 3: Load the addon with an openUrl handler**

Immediately after the WebGL `try/catch` block from Task 2 (before `fit.fit();`), add:
```typescript
    // Cmd+click URLs Claude prints (PRs, docs, localhost previews) → open in the real browser.
    term.loadAddon(new WebLinksAddon((_event, uri) => { void openUrl(uri); }));
```

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: no type errors; Vite build succeeds.

- [ ] **Step 5: Verify existing tests still pass**

Run:
```bash
npx vitest run
```
Expected: 144 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/worktrees/useTerminal.ts
git commit -m "feat(term): Cmd+click links open via openUrl"
```

---

### Task 4: Shift+Enter inserts a newline (multiline prompts)

The most common muscle-memory failure when talking to Claude Code in a bare terminal: Shift+Enter currently sends a plain `\r`, which **submits** the prompt. Claude Code's `/terminal-setup` can't help an embedded terminal (it writes iTerm2/VS Code configs). As the embedder we translate directly: intercept Shift+Enter and write Claude Code's universal backslash-newline escape (`\` then `\r`, bytes `[92, 13]`) to the PTY instead of submitting. The decision logic is a pure, tested helper; the hook just wires it.

**Files:**
- Create: `src/worktrees/keys.ts`
- Create: `src/worktrees/keys.test.ts`
- Modify: `src/worktrees/useTerminal.ts` (custom key handler in the mount effect)

**Interfaces:**
- Consumes: nothing from prior tasks (pure module) + `invoke("pty_write", ...)` already used in the hook.
- Produces:
  - `shouldInsertNewline(e: { type: string; key: string; shiftKey: boolean }): boolean`
  - `NEWLINE_ESCAPE: number[]` — the bytes to write (`[92, 13]`, i.e. `\` + `CR`).

- [ ] **Step 1: Write the failing test**

Create `src/worktrees/keys.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { shouldInsertNewline, NEWLINE_ESCAPE } from "./keys";

describe("shouldInsertNewline", () => {
  it("is true for Shift+Enter keydown", () => {
    expect(shouldInsertNewline({ type: "keydown", key: "Enter", shiftKey: true })).toBe(true);
  });
  it("is false for plain Enter (that should submit)", () => {
    expect(shouldInsertNewline({ type: "keydown", key: "Enter", shiftKey: false })).toBe(false);
  });
  it("is false on keyup (fires once, on keydown)", () => {
    expect(shouldInsertNewline({ type: "keyup", key: "Enter", shiftKey: true })).toBe(false);
  });
  it("is false for other keys with Shift held", () => {
    expect(shouldInsertNewline({ type: "keydown", key: "a", shiftKey: true })).toBe(false);
  });
});

describe("NEWLINE_ESCAPE", () => {
  it("is backslash followed by carriage return", () => {
    expect(NEWLINE_ESCAPE).toEqual([92, 13]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/worktrees/keys.test.ts
```
Expected: FAIL — cannot resolve `./keys`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/worktrees/keys.ts`:
```typescript
// keys.ts — pure helpers for translating Shift+Enter into Claude Code's multiline newline escape.

// Claude Code (and POSIX shells) treat a backslash immediately before a newline as a line continuation
// instead of a submit. Sending these two bytes on Shift+Enter inserts a newline without submitting.
export const NEWLINE_ESCAPE: number[] = [0x5c, 0x0d]; // '\' then CR

// True only on the Shift+Enter keydown — the moment we want to insert a newline rather than submit.
export function shouldInsertNewline(e: { type: string; key: string; shiftKey: boolean }): boolean {
  return e.type === "keydown" && e.key === "Enter" && e.shiftKey;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/worktrees/keys.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the handler into useTerminal**

In `src/worktrees/useTerminal.ts`, add the import after the other `./` imports (near line 8):
```typescript
import { shouldInsertNewline, NEWLINE_ESCAPE } from "./keys";
```
Then, inside the mount `useEffect`, **after** the `armed` constant is defined (currently line 85, right after the `onBell` wiring) add:
```typescript
    // Shift+Enter → insert a newline (Claude Code's backslash-escape) instead of submitting the prompt.
    // Returning false tells xterm we handled the key, so it does not also emit a submitting CR.
    term.attachCustomKeyEventHandler((e) => {
      if (shouldInsertNewline(e)) {
        if (armed) useSettings.getState().clearAttention(ptyId);
        invoke("pty_write", { ptyId, bytes: NEWLINE_ESCAPE });
        return false;
      }
      return true;
    });
```

- [ ] **Step 6: Verify the full frontend build + tests**

Run:
```bash
npx tsc --noEmit && npm run build && npx vitest run
```
Expected: no type errors; Vite build succeeds; 149 passed (144 + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/worktrees/keys.ts src/worktrees/keys.test.ts src/worktrees/useTerminal.ts
git commit -m "feat(term): Shift+Enter inserts newline instead of submitting"
```

---

### Task 5: Truecolor + TERM + fullscreen TUI (child env)

Claude Code detects color capability from `COLORTERM`/`TERM` and renders in its fullscreen alternate-screen TUI (pinned bottom input bar, no scrollback flicker) when `CLAUDE_CODE_NO_FLICKER=1`. All three are set on the child shell's environment at the single PTY spawn point, so every pane that runs Claude Code benefits. The env pairs are produced by a pure, tested helper.

**Files:**
- Modify: `src-tauri/src/pty.rs` (add `terminal_env()`; apply in `spawn_pty` after `cmd.cwd(&cwd);` ~line 63; add a test in `mod tests` ~line 130)

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `fn terminal_env() -> [(&'static str, &'static str); 3]` (module-private) — the env pairs applied to the spawned shell.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/pty.rs`, inside `mod tests` (after the `scrollback_is_bounded_keeping_newest` test, before the closing brace at line 148), add:
```rust
    #[test]
    fn terminal_env_advertises_truecolor_term_and_fullscreen() {
        let env = terminal_env();
        assert!(env.contains(&("TERM", "xterm-256color")));
        assert!(env.contains(&("COLORTERM", "truecolor")));
        assert!(env.contains(&("CLAUDE_CODE_NO_FLICKER", "1")));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd src-tauri && cargo test terminal_env
```
Expected: FAIL — `cannot find function terminal_env in this scope`.

- [ ] **Step 3: Add the pure helper**

In `src-tauri/src/pty.rs`, add above `spawn_pty` (or near the other free functions, e.g. just before the `spawn`/`ensure` function that contains line 60):
```rust
// The environment Claude Code reads for display: advertise truecolor + a known TERM for capability
// detection, and CLAUDE_CODE_NO_FLICKER so it renders in its fullscreen alternate-screen TUI.
fn terminal_env() -> [(&'static str, &'static str); 3] {
    [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("CLAUDE_CODE_NO_FLICKER", "1"),
    ]
}
```

- [ ] **Step 4: Apply the env when spawning**

Immediately after `cmd.cwd(&cwd);` (line 63), add:
```rust
    for (k, v) in terminal_env() {
        cmd.env(k, v);
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd src-tauri && cargo test terminal_env
```
Expected: PASS.

- [ ] **Step 6: Verify the full Rust build + test suite**

Run:
```bash
cd src-tauri && cargo build && cargo test 2>&1 | grep "test result"
```
Expected: build clean; 109 passed (108 + 1 new), 1 ignored.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "feat(pty): advertise truecolor + enable Claude fullscreen TUI"
```

---

### Task 6: Documentation, Revert Map, and full verification

Records the batch in the repo's as-built notes and confirms both suites/builds are green together. The Revert Map (below) is the deliverable that satisfies "document so they can easily be reverted."

**Files:**
- Modify: `CLAUDE.md` (new "As-built notes" bullet)
- Modify: this plan (confirm the Revert Map is accurate)

- [ ] **Step 1: Add the as-built note to CLAUDE.md**

Add a bullet to the "As-built notes" list in `CLAUDE.md`:
```markdown
- **Terminal UX batch (2026-07-13, branch `worktree-terminal-ux`).** `useTerminal.ts` now loads three
  xterm v6 addons — **Unicode 11** width tables (`term.unicode.activeVersion="11"`, fixes emoji/box-drawing
  misalignment in Claude's UI), **WebGL** renderer (best-effort; `onContextLoss` → dispose falls back to the
  DOM renderer), and **web-links** (Cmd+click → `openUrl`) — plus `scrollback: 10000` and a
  `attachCustomKeyEventHandler` that turns **Shift+Enter** into Claude's backslash-newline escape
  (`[0x5c,0x0d]`) instead of submitting (pure `shouldInsertNewline`/`NEWLINE_ESCAPE` in `keys.ts`, tested).
  `pty.rs` sets `TERM=xterm-256color`, `COLORTERM=truecolor`, and `CLAUDE_CODE_NO_FLICKER=1` on the child
  shell (pure `terminal_env()`, tested) — truecolor + Claude's **fullscreen alternate-screen TUI**; Claude
  keeps its own default theme ("look like Claude", not `dark-ansi`). Each change is one line and
  independently revertible — see the Revert Map in
  `docs/superpowers/plans/2026-07-13-terminal-ux-improvements.md`. **GUI acceptance PENDING human eyeball**
  (see verification checklist in that plan).
```

- [ ] **Step 2: Run both full suites and both builds**

Run:
```bash
npx tsc --noEmit && npm run build && npx vitest run
cd src-tauri && cargo build && cargo test 2>&1 | grep "test result"
```
Expected: frontend 149 passed; Rust 109 passed, 1 ignored; both builds clean.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-07-13-terminal-ux-improvements.md
git commit -m "docs: record terminal UX batch + revert map"
```

---

## Revert Map

Each change is isolated; revert individually by reversing the listed edit (or `git revert` the listed commit).

| Change | Where | Revert |
|--------|-------|--------|
| Unicode 11 width tables | `useTerminal.ts` import + `loadAddon(unicode11)` + `activeVersion="11"` | Remove the import and the 3 lines; `npm uninstall @xterm/addon-unicode11` |
| Scrollback 10000 | `useTerminal.ts` Terminal options | Delete the `scrollback: 10000,` line (reverts to xterm default 1000) |
| WebGL renderer | `useTerminal.ts` import + try/catch after `open()` | Remove the import + try/catch block; `npm uninstall @xterm/addon-webgl` (xterm reverts to DOM renderer) |
| Clickable links | `useTerminal.ts` imports + `loadAddon(WebLinksAddon)` | Remove the two imports + the one `loadAddon` line; `npm uninstall @xterm/addon-web-links` |
| Shift+Enter newline | `useTerminal.ts` `attachCustomKeyEventHandler` + `keys.ts`/`keys.test.ts` | Remove the handler + import; delete `keys.ts`/`keys.test.ts` (Shift+Enter reverts to submitting) |
| Truecolor / TERM | `pty.rs` `terminal_env()` entries | Remove the `("COLORTERM","truecolor")` / `("TERM",...)` pairs (Claude falls back to 256-color) |
| Fullscreen TUI | `pty.rs` `("CLAUDE_CODE_NO_FLICKER","1")` | **One-line revert:** delete that pair. (If it must stay in env but be disabled, add `("CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN","1")`, which takes precedence.) |

## GUI acceptance checklist (human eyeball — native window can't be driven headlessly)

Rebuild the app (`npm run tauri dev`) and, in a claude pane:
1. **Unicode/alignment:** Claude's spinner + box-drawing UI have straight right edges (no ragged/offset borders); emoji don't overlap following text.
2. **Fullscreen TUI:** Claude renders with a pinned bottom input bar and no scrollback flicker while it works; the pane doesn't scroll the conversation on every redraw.
3. **Truecolor:** Claude's UI + a `git diff`/test run show full color (not a flattened 16-color look).
4. **Shift+Enter:** in Claude's prompt, Shift+Enter drops to a new line **without** submitting; plain Enter still submits.
5. **Links:** Cmd+click a URL Claude prints (or a `localhost:` preview) → opens in the default browser.
6. **WebGL:** streaming output is smooth with several panes open; no blank/garbled panes (which would indicate a context-limit issue — note it if seen, and the DOM fallback still renders).
7. **Regression:** attention highlight (bell), restart/close buttons, zoom, re-attach on view switch all still work.
