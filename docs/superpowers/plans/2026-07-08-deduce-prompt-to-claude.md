# Deduce Prompt → Claude Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deduce-created worktree's Claude pane auto-sends the original user prompt as its first message (once), and the prompt stays copyable from the pane header afterwards.

**Architecture:** Persist `prompt?` on the `Worktree` model (TS + Rust serde mirror). A session-only store flag `initialPromptPending[worktreeId]` — set when `startDeduceWorktree` creates the worktree — makes the claude pane's autostart `claude '<escaped prompt>'` instead of plain `claude`; the flag is cleared after the first `pty_ensure` resolves via a new `onEnsured` hook in `useTerminal` (which now holds `autostartCmd` in a ref so the change doesn't recreate the xterm). A copy button in the claude pane header covers restarts/relaunches.

**Tech Stack:** React 19 + TS (Vite, Vitest), Zustand, Rust/Tauri v2 (serde), no new dependencies, **no new Rust commands**.

**Spec:** `docs/superpowers/specs/2026-07-08-deduce-prompt-to-claude-design.md`

## Global Constraints

- Project convention: one-line role comment at the top of every file; concise intent comments on non-obvious blocks.
- Smallest change that works; no new dependencies; no Rust PTY changes.
- `prompt` is optional everywhere: old `cockpit.json` files must load unchanged (`#[serde(default)]`), and `None` must be omitted on serialize (`skip_serializing_if = "Option::is_none"`).
- Checkout / manual / scratch entities never get a prompt; their flows are untouched.
- All commits on branch `feat/prompt-passing-deduce`; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run JS tests with `npx vitest run`, Rust tests with `cargo test` (in `src-tauri/`).

---

### Task 1: Rust — optional `prompt` on the `Worktree` serde struct

**Files:**
- Modify: `src-tauri/src/settings.rs` (struct `Worktree`, ~line 64; tests in `mod tests`, ~line 254)

**Interfaces:**
- Produces: `Worktree.prompt: Option<String>`, JSON field `prompt`, absent when `None`. No other task consumes this from Rust — it exists so `save_settings`/`load_settings` round-trip the field the frontend writes.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `src-tauri/src/settings.rs`:

```rust
    // Back-compat: pre-prompt cockpit.json worktrees load; None is omitted; Some round-trips.
    #[test]
    fn worktree_prompt_optional_and_omitted_when_none() {
        let json = r#"{"id":"wt-1","name":"n","repoPath":"/r","branch":"b","worktreePath":"/w","host":{"startCmd":"","address":""},"links":[],"status":"ongoing"}"#;
        let wt: Worktree = serde_json::from_str(json).unwrap();
        assert_eq!(wt.prompt, None);
        assert!(!serde_json::to_string(&wt).unwrap().contains("prompt"));
        let with = Worktree { prompt: Some("fix the login bug".into()), ..wt };
        let back: Worktree = serde_json::from_str(&serde_json::to_string(&with).unwrap()).unwrap();
        assert_eq!(back.prompt.as_deref(), Some("fix the login bug"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test worktree_prompt_optional --manifest-path src-tauri/Cargo.toml`
Expected: COMPILE ERROR — `struct Worktree has no field named prompt`.

- [ ] **Step 3: Add the field**

In `src-tauri/src/settings.rs`, add as the last field of `struct Worktree` (after `pub status: String,`):

```rust
    // The deduce prompt that created this worktree (auto-sent to Claude once; kept copyable). Absent for manual/checkout worktrees.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
```

If any test or fixture constructs a `Worktree` literal elsewhere in the crate, add `prompt: None` there (compiler will point at each site).

- [ ] **Step 4: Run the Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests PASS (94 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat(settings): optional prompt field on Worktree (serde back-compat)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TS model + `claudeAutostart` escaping helper

**Files:**
- Modify: `src/settings/types.ts` (interface `Worktree`, ~line 37)
- Create: `src/worktrees/claudeCmd.ts`
- Test: `src/worktrees/claudeCmd.test.ts`

**Interfaces:**
- Produces:
  - `Worktree.prompt?: string` (TS mirror of Task 1).
  - `claudeAutostart(prompt: string): string` — returns `claude '<escaped>'` (POSIX single-quote escaping).
  - `claudePaneAutostart(prompt: string | undefined, pending: boolean): string` — returns `claudeAutostart(prompt)` when both truthy, else `"claude"`. Task 3 sets the flag it reads; Task 5 calls it.
- Note: `makeWorktree` in `src/worktrees/model.ts` needs **no change** — its param type is `Omit<Worktree, "status" | "links"> & …`, so the new optional field flows through automatically.

- [ ] **Step 1: Add the TS field**

In `src/settings/types.ts`, add to `interface Worktree` after `status`:

```ts
  prompt?: string; // the deduce prompt that created this worktree (auto-sent to Claude once; kept copyable)
```

- [ ] **Step 2: Write the failing tests**

Create `src/worktrees/claudeCmd.test.ts`:

```ts
// claudeCmd.test.ts — shell-escaping + one-shot autostart selection for the claude pane.
import { describe, it, expect } from "vitest";
import { claudeAutostart, claudePaneAutostart } from "./claudeCmd";

describe("claudeAutostart", () => {
  it("wraps a plain prompt in single quotes", () => {
    expect(claudeAutostart("fix the login bug")).toBe("claude 'fix the login bug'");
  });
  it("escapes single quotes with the POSIX '\\'' idiom", () => {
    expect(claudeAutostart("don't break")).toBe("claude 'don'\\''t break'");
  });
  it("passes double quotes, $ and backticks through untouched (single quotes neutralise them)", () => {
    expect(claudeAutostart('echo "$HOME" `id`')).toBe("claude 'echo \"$HOME\" `id`'");
  });
  it("keeps newlines literal inside the quotes (zsh reads continuation lines as one arg)", () => {
    expect(claudeAutostart("line one\nline two")).toBe("claude 'line one\nline two'");
  });
});

describe("claudePaneAutostart", () => {
  it("uses the prompt only while the initial send is pending", () => {
    expect(claudePaneAutostart("fix it", true)).toBe("claude 'fix it'");
  });
  it("falls back to plain claude when not pending or no prompt", () => {
    expect(claudePaneAutostart("fix it", false)).toBe("claude");
    expect(claudePaneAutostart(undefined, true)).toBe("claude");
    expect(claudePaneAutostart("", true)).toBe("claude");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/worktrees/claudeCmd.test.ts`
Expected: FAIL — cannot resolve `./claudeCmd`.

- [ ] **Step 4: Write the helper**

Create `src/worktrees/claudeCmd.ts`:

```ts
// claudeCmd.ts — pure builders for the claude pane's autostart line (one-shot prompt send). No IO.

// Shell-quote the prompt as one argument: POSIX single-quote idiom (' → '\''). Newlines stay
// literal — zsh keeps reading continuation lines until the closing quote, yielding one arg.
export function claudeAutostart(prompt: string): string {
  return `claude '${prompt.replace(/'/g, "'\\''")}'`;
}

// Autostart for the claude pane: send the prompt only on the one-shot initial spawn; plain claude otherwise.
export function claudePaneAutostart(prompt: string | undefined, pending: boolean): string {
  return pending && prompt ? claudeAutostart(prompt) : "claude";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/worktrees/claudeCmd.test.ts`
Expected: 6 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/settings/types.ts src/worktrees/claudeCmd.ts src/worktrees/claudeCmd.test.ts
git commit -m "feat(worktrees): Worktree.prompt field + claude autostart escaping helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Store — persist the prompt + session-only `initialPromptPending` flag

**Files:**
- Modify: `src/settings/store.ts` (interface `SettingsState` ~line 13; initial state ~line 96; `startDeduceWorktree` ~line 183)
- Test: `src/settings/store.test.ts` (describe `startDeduceWorktree — pending worktree flow`, ~line 288)

**Interfaces:**
- Consumes: `Worktree.prompt?` (Task 2).
- Produces (Task 5 reads these):
  - `initialPromptPending: Record<string, true>` — session-only, keyed by worktree id; present = the claude pane's first spawn should send the prompt.
  - `clearInitialPrompt(id: string): void` — removes the flag; same-object no-op when absent (mirrors `clearAttention`).
  - `startDeduceWorktree` success path now stores `prompt` on the created worktree AND sets the flag for the real id.

- [ ] **Step 1: Write the failing tests**

In `src/settings/store.test.ts`, first add `initialPromptPending: {}` to the `useSettings.setState({ … })` call in the `beforeEach` of the `startDeduceWorktree — pending worktree flow` describe (~line 298), so each test starts clean. Then add inside that describe:

```ts
  it("success: stores the prompt on the model and marks the initial claude send pending", async () => {
    vi.mocked(deduceWorktree).mockResolvedValue(deduced);
    vi.mocked(createWorktree).mockResolvedValue("/wt/fix-login");
    useSettings.getState().startDeduceWorktree("fix the login bug", "worktrees");
    await flush();
    const st = useSettings.getState();
    expect(st.cockpit.worktrees[0].prompt).toBe("fix the login bug");
    expect(st.initialPromptPending[st.cockpit.worktrees[0].id]).toBe(true);
  });

  it("clearInitialPrompt removes the flag; no-op (same object) when absent", () => {
    useSettings.setState({ initialPromptPending: { "wt-1": true } });
    useSettings.getState().clearInitialPrompt("wt-1");
    expect(useSettings.getState().initialPromptPending).toEqual({});
    const before = useSettings.getState().initialPromptPending;
    useSettings.getState().clearInitialPrompt("wt-ghost");
    expect(useSettings.getState().initialPromptPending).toBe(before);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings/store.test.ts`
Expected: the two new tests FAIL (`initialPromptPending`/`clearInitialPrompt` undefined); TS may reject first — that counts as the failing state.

- [ ] **Step 3: Implement the slice**

In `src/settings/store.ts`:

a) Add to `interface SettingsState`, directly under the `attention` block (~line 63):

```ts
  // Session-only "send the deduce prompt on the claude pane's first spawn" flags, keyed by worktree id. Not persisted.
  initialPromptPending: Record<string, true>;
  clearInitialPrompt: (id: string) => void;
```

b) Add initial value next to `attention: {}` (~line 96):

```ts
  initialPromptPending: {},
```

c) Add the action next to `clearAttention` (same no-op idiom):

```ts
  // No-op (same object) when absent, so clearing an unflagged worktree never triggers a re-render.
  clearInitialPrompt: (id) =>
    set((st) => {
      if (!st.initialPromptPending[id]) return st;
      const { [id]: _, ...rest } = st.initialPromptPending;
      return { initialPromptPending: rest };
    }),
```

d) In `startDeduceWorktree`'s success path: add `prompt,` to the `makeWorktree({ … })` fields (the raw action arg, verbatim), and add the flag to the existing swap `set` so it lands atomically with the slot swap:

```ts
        get().addWorktree(makeWorktree({
          id: realId, name: d.name, repoPath: d.repoPath, branch: d.branch, worktreePath,
          host: { startCmd, address }, links: sl ? [sl] : [], prompt,
        }));
        // Swap in place across both slot surfaces, then drop the pending entity.
        // The initial-send flag arms the claude pane's one-shot prompt autostart (cleared on first ensure).
        set((st) => ({
          slots: swapSlotId(st.slots, pendingId, realId),
          pendingWorktrees: st.pendingWorktrees.filter((p) => p.id !== pendingId),
          initialPromptPending: { ...st.initialPromptPending, [realId]: true },
        }));
```

- [ ] **Step 4: Run the full JS suite**

Run: `npx vitest run`
Expected: all PASS (113 existing + new). If any older test asserts on whole-state equality and trips on the new slice, reset `initialPromptPending: {}` in that test's setup the same way.

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat(store): persist deduce prompt on worktree + one-shot initialPromptPending flag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `useTerminal` — autostart in a ref + `onEnsured` completion hook

**Files:**
- Modify: `src/worktrees/useTerminal.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 5 relies on this exact contract):
  - `UseTerminalArgs` gains `onEnsured?: () => void` — called once per mount effect, right after `pty_ensure` resolves successfully (NOT on restart, NOT on spawn failure).
  - `autostartCmd` is removed from the mount effect's deps: changing it after mount no longer disposes/recreates the xterm; `restart` uses the **latest** value via a ref.

**Why:** Task 5 clears the pending flag from `onEnsured`, which flips `autostartCmd` from `claude '<prompt>'` to `claude`. Under the old deps that prop change would tear down the terminal and race a second plain-command `pty_ensure` against the first spawn. The dep was pointless anyway — same worktree/role means the PTY is already alive and ensure is idempotent.

- [ ] **Step 1: Implement the ref + hook**

In `src/worktrees/useTerminal.ts`:

a) Extend the args interface:

```ts
export interface UseTerminalArgs {
  worktreeId: string;
  role: string;
  cwd: string;
  autostartCmd?: string;
  onEnsured?: () => void; // fires after the mount-time pty_ensure resolves (one-shot autostart consumption)
}
```

b) Update the hook signature and add refs (before the mount effect):

```ts
export function useTerminal({ worktreeId, role, cwd, autostartCmd, onEnsured }: UseTerminalArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string>(makePtyId(worktreeId, role));
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // autostartCmd/onEnsured live in refs: a post-mount change (the one-shot prompt being consumed)
  // must NOT dispose/recreate the terminal — pty_ensure is idempotent, so re-running was pointless.
  const autostartRef = useRef(autostartCmd);
  autostartRef.current = autostartCmd;
  const onEnsuredRef = useRef(onEnsured);
  onEnsuredRef.current = onEnsured;
  const fontScale = useSettings((s) => s.fontScale);
```

c) In the mount effect's async block, use the ref and fire the hook after ensure:

```ts
        await invoke("pty_ensure", {
          worktreeId, role, cwd, autostartCmd: autostartRef.current, cols: term.cols, rows: term.rows,
        });
        onEnsuredRef.current?.(); // autostart consumed (or PTY already alive) — callers clear one-shot flags here
```

d) Change the mount effect's dep array from `[worktreeId, role, cwd, autostartCmd]` to `[worktreeId, role, cwd]`.

e) In `restart`, use the ref (picks up the post-clear plain command):

```ts
      .then(() => invoke("pty_ensure", { worktreeId, role, cwd, autostartCmd: autostartRef.current, cols, rows }))
```

- [ ] **Step 2: Typecheck + full JS suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all PASS (no behavior change for existing callers — `onEnsured` is optional).

- [ ] **Step 3: Commit**

```bash
git add src/worktrees/useTerminal.ts
git commit -m "refactor(useTerminal): autostartCmd via ref + onEnsured hook (no remount on autostart change)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: UI wiring — one-shot autostart, copy button, `CopyIcon`, `action` slot

**Files:**
- Modify: `src/views/icons.tsx` (add `CopyIcon`)
- Modify: `src/views/worktree-column/WorktreePane.tsx` (add `action` header slot)
- Modify: `src/views/worktree-column/WorktreeBody.tsx` (claude pane wiring)

**Interfaces:**
- Consumes: `claudePaneAutostart` (Task 2), `initialPromptPending`/`clearInitialPrompt` (Task 3), `onEnsured` (Task 4).
- Produces: `WorktreePane` prop `action?: ReactNode`, rendered in the header between the badge and the restart button.

- [ ] **Step 1: Add `CopyIcon`**

In `src/views/icons.tsx`, append (matches the existing 16-viewBox stroke idiom):

```tsx
// Copy: front sheet + peeking back sheet (copy-prompt action on the claude pane).
export function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <rect x="6" y="6" width="7.5" height="7.5" rx="1.5" />
      <path d="M3.5 10.5A1.5 1.5 0 0 1 2 9V4a2 2 0 0 1 2-2h5a1.5 1.5 0 0 1 1.5 1.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Add the `action` slot to `WorktreePane`**

In `src/views/worktree-column/WorktreePane.tsx`, destructure `action` (so it doesn't leak into `useTerminal` args) and render it before the restart button:

```tsx
export function WorktreePane({ title, icon, badge, action, ...args }: UseTerminalArgs & { title: string; icon?: ReactNode; badge?: ReactNode; action?: ReactNode }) {
```

and in the header, between `{badge}` and the restart button:

```tsx
        {badge}
        {action}
        <button className="icon-btn wt-pane__restart" title="restart" onClick={restart}><RestartIcon /></button>
```

- [ ] **Step 3: Wire the claude pane in `WorktreeBody`**

In `src/views/worktree-column/WorktreeBody.tsx`, add imports:

```tsx
import { useSettings } from "../../settings/store";
import { claudePaneAutostart } from "../../worktrees/claudeCmd";
import { CopyIcon } from "../icons";
```

At the top of the component body:

```tsx
  // One-shot: true only in the session that created this worktree, until the claude PTY's first ensure.
  const promptPending = useSettings((s) => Boolean(s.initialPromptPending[worktree.id]));
```

Replace the claude `WorktreePane` with:

```tsx
        <WorktreePane
          title="Claude Code" icon={<span className="wt-ico wt-ico--claude" aria-hidden />}
          worktreeId={worktree.id} role="claude" cwd={worktree.worktreePath}
          autostartCmd={claudePaneAutostart(worktree.prompt, promptPending)}
          onEnsured={() => useSettings.getState().clearInitialPrompt(worktree.id)}
          action={worktree.prompt ? (
            <button
              className="icon-btn" title={`copy prompt: ${worktree.prompt}`}
              onClick={() => navigator.clipboard.writeText(worktree.prompt!)}
            ><CopyIcon /></button>
          ) : undefined}
        />
```

- [ ] **Step 4: Typecheck + full JS suite + builds**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all clean/PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/icons.tsx src/views/worktree-column/WorktreePane.tsx src/views/worktree-column/WorktreeBody.tsx
git commit -m "feat(worktree-column): one-shot deduce-prompt autostart on the claude pane + copy-prompt button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (add an as-built note)

- [ ] **Step 1: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: all green, builds warning-free.

- [ ] **Step 2: Add the CLAUDE.md as-built note**

Append to the as-built notes section (after the "Instant, non-blocking Deduce flow" bullet), condensing:

```markdown
- **Deduce prompt → Claude pane (2026-07-08).** A deduce-created worktree persists the raw user prompt
  (`Worktree.prompt?`, `#[serde(default)]` + omitted-when-none — back-compat). The claude pane **auto-sends it
  once**: session-only `initialPromptPending[worktreeId]` (set by `startDeduceWorktree`) switches the autostart to
  `claude '<escaped prompt>'` (pure `claudeAutostart`/`claudePaneAutostart` in `src/worktrees/claudeCmd.ts`, POSIX
  `'\''` escaping); the flag clears via `useTerminal`'s new `onEnsured` hook after the first `pty_ensure`, so the
  restart button and app relaunches run plain `claude` (no re-send into a live session). `useTerminal` now holds
  `autostartCmd` in a **ref** (dropped from the mount deps) — clearing the flag doesn't recreate the xterm and can't
  race a plain-command spawn. Backup: a **copy-prompt button** (`CopyIcon`, new `action` header slot on
  `WorktreePane`) on the claude pane whenever `worktree.prompt` exists. Auto-send is a CLI arg, so Claude queues it
  behind the trust-folder dialog — no PTY typing race. Checkout/manual/scratch unchanged; **no Rust PTY changes**.
  GUI acceptance PENDING human eyeball. Spec: `docs/superpowers/specs/2026-07-08-deduce-prompt-to-claude-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): as-built note for deduce prompt → claude pane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual GUI acceptance (human — the native window can't be driven headlessly)**

In the running app (`npm run tauri dev`):
1. `+ New` → type a prompt → Create → when the worktree lands, the Claude pane starts `claude '<prompt>'` and the prompt is submitted as the first message (after granting trust if asked).
2. The copy button appears in the Claude pane header; click → prompt is on the clipboard; tooltip shows the text.
3. Press the pane's restart button → plain `claude`, no re-send.
4. Quit + relaunch the app, select the same worktree → plain `claude`; copy button still there.
5. A prompt containing a single quote (e.g. `don't break the header`) survives 1–2 intact.
