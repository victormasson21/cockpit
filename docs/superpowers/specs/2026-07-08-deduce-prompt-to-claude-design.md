# Deduce prompt → Claude pane (auto-send + copy backup) — design

**Date:** 2026-07-08
**Status:** approved

## Problem

The Deduce flow captures a rich user prompt ("fix the login bug", a pasted PR/ticket/Slack link with
context), uses it to create the worktree… and then drops it. The user must re-type or re-paste the
same intent into the freshly-opened Claude pane. The prompt should follow the worktree: ideally
Claude starts working from it; at minimum it must be easy to copy into Claude.

## Decisions (made interactively)

| Question | Choice | Why |
|----------|--------|-----|
| Delivery mechanism | **Auto-send**: autostart becomes `claude '<prompt>'` | Claude Code has no pre-fill flag; typing into the input box via the PTY needs a readiness heuristic and races Claude's trust-folder dialog. A CLI arg is queued by Claude itself and submitted after trust is granted — zero timing risk, one-line-shaped change. Details can still be added as a follow-up message. |
| Persistence | **Persist on the model, one-shot send** | `prompt?` on `Worktree` in `cockpit.json` gives the copy-paste backup for free (survives app restarts). The auto-send happens only on the first claude spawn of the creating session — never on the pane's restart button or app relaunch (re-sending into a live/aged session would restart the task). |
| Backup UI | **Copy icon in the claude pane header** | Sits exactly where you'd paste it; zero layout impact; tooltip shows the text. |

Rejected alternatives: PTY pre-fill via bracketed paste (fragile readiness detection + trust-dialog
collision); copy-paste only (manual); a prompt row in `WorktreeBody` (vertical space in every column).

## Design

### 1. Model

- `Worktree` gains `prompt?: string` — `src/settings/types.ts` and the mirrored Rust serde struct in
  `src-tauri/src/settings.rs` (`#[serde(default)]`, `skip_serializing_if = "Option::is_none"` —
  existing `cockpit.json` files load unchanged and non-deduce worktrees serialize without the field).
- `makeWorktree` accepts and passes through `prompt`; `startDeduceWorktree` supplies the **raw user
  prompt verbatim**. Checkout, manual, and scratch entities never set it.

### 2. One-shot auto-send

- New **session-only** store slice `initialPromptPending: Record<string /* worktreeId */, true>`
  (same idiom as `attention`; not persisted), plus `clearInitialPrompt(id)`. Set in
  `startDeduceWorktree`'s success path alongside `addWorktree`.
- `WorktreeBody` computes the claude pane's autostart: pending → `claudeAutostart(worktree.prompt)`,
  else plain `"claude"`.
- The pending flag is **cleared once the first `pty_ensure` resolves** (small completion hook from
  `useTerminal`). Resulting behavior:
  - **Restart button** later → plain `claude` (no re-send into a live conversation).
  - **App restart** → session slice is gone → plain `claude`; the prompt remains copyable.
  - **Slot repick within the session** never re-sends anyway — the PTY stays alive and
    `pty_ensure` is idempotent (autostart only runs on actual spawn).
- Supporting change in `useTerminal`: hold `autostartCmd` in a **ref** and drop it from the mount
  effect's deps. Clearing the flag then doesn't dispose/recreate the xterm, and there is no race
  where a second `pty_ensure` carrying the plain command could win the spawn. (The dep was pointless:
  same worktree/role → PTY already alive → ensure is a no-op.) `restart` reads the ref, so it picks
  up the post-clear plain command.

### 3. Escaping

- Pure tested helper `claudeAutostart(prompt: string): string` builds `claude '<escaped>'` using the
  POSIX single-quote idiom (`'` → `'\''`). Quotes, `$`, backticks, and multi-line prompts pass
  through as one argument to `claude`.
- **No Rust PTY changes** — it is still just the `autostart_cmd` string `pty_ensure` already takes.

### 4. Copy UI (backup)

- `WorktreePane` gets an optional `action?: ReactNode` header slot rendered next to the restart
  control.
- `WorktreeBody` passes a small copy button there for the **claude pane only**, and only when
  `worktree.prompt` exists: click → `navigator.clipboard.writeText(prompt)`; the button's `title`
  tooltip shows the prompt text.

### 5. Edge cases

- **Trust-folder dialog** on a fresh worktree dir: the prompt is a CLI arg, so Claude queues it and
  submits after trust is granted — the main robustness win of auto-send over PTY typing.
- **Prompt contains a source URL** (Linear/GitHub/Slack deduce paths): sent verbatim, same as typed.
- **Deduce failure**: no worktree is created; the existing error/reopen flow is untouched.
- **User closes the slot before the pane ever mounts**: the pending flag survives (session-only);
  the first time the worktree is selected that session, the prompt sends. After an app restart it
  does not — copy button covers it.

### 6. Testing

- **JS:** `claudeAutostart` escaping cases (plain, single quotes, double quotes, `$`/backticks,
  newlines); store test that the deduce success path sets `prompt` + the pending flag and that
  `clearInitialPrompt` clears it; autostart-selection logic (pending vs not).
- **Rust:** serde back-compat — a `Worktree` JSON without `prompt` deserializes; one with it
  round-trips; `None` is omitted on serialize.
- No new Rust commands; `cargo test` + vitest + both builds stay green.

## Out of scope

- Pre-filling Claude's input box without sending (no CLI support; PTY injection rejected as fragile).
- Prompt editing after creation, prompt display row in the worktree body, prompt on checkout/manual
  worktrees.
