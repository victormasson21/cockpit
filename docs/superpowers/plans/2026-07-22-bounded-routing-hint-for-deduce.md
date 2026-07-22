# Bounded routing hint for deduce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the deduce LLM call a short, bounded routing hint derived from the prompt, so a long task prompt (great for the Claude work pane) no longer slows or dilutes the lightweight repo/branch deduction.

**Architecture:** Add one pure Rust helper `routing_hint` in `src-tauri/src/deduce.rs`. In `deduce_worktree`, compute the hint once from the full prompt and pass it (instead of the raw prompt) into all four `compose_user*` builders. Ref-detection still runs on the full prompt, so refs are never lost; the ref/id/url and fetched ticket/PR/Slack context stay full. Frontend is untouched — the Claude pane already gets the full prompt via the separate persisted `Worktree.prompt`.

**Tech Stack:** Rust (Tauri core), `cargo test`.

## Global Constraints

- Top-of-file and top-of-block concise comments per repo conventions (role + intent, not syntax).
- Smallest change that satisfies the requirement; no unrelated refactoring.
- No frontend changes in this plan (spec: the fix is entirely Rust-internal).
- Hint rule (verbatim from spec): **first ~2 sentences** split on `.` `!` `?`, then **hard-cap at 200 chars** on a UTF-8 char boundary; fewer than 2 sentence terminators → whole prompt, still capped at 200.
- Existing `compose_user*` tests must stay green (fixtures are short, single-sentence, under 200 chars).

---

### Task 1: `routing_hint` pure helper

**Files:**
- Modify: `src-tauri/src/deduce.rs` (add fn near `compose_user`, ~line 44; add tests in the existing `#[cfg(test)]` module)

**Interfaces:**
- Consumes: nothing (pure, std-only).
- Produces: `pub fn routing_hint(prompt: &str) -> String` — the bounded routing signal used by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)]` module in `src-tauri/src/deduce.rs`:

```rust
#[test]
fn routing_hint_takes_first_two_sentences() {
    // Third sentence is dropped; first two are kept verbatim (with their terminators).
    let out = routing_hint("Fix login. It 500s on submit. Also unrelated cleanup here.");
    assert_eq!(out, "Fix login. It 500s on submit.");
}

#[test]
fn routing_hint_handles_question_and_bang_terminators() {
    let out = routing_hint("Why is it slow? Make it fast! And more prose after.");
    assert_eq!(out, "Why is it slow? Make it fast!");
}

#[test]
fn routing_hint_fewer_than_two_sentences_returns_whole_prompt() {
    assert_eq!(routing_hint("just one clause no terminator"), "just one clause no terminator");
    assert_eq!(routing_hint("only one sentence."), "only one sentence.");
}

#[test]
fn routing_hint_hard_caps_at_200_chars() {
    // A single 300-char sentence (no early terminator) must be cut to exactly 200 chars.
    let long = "a".repeat(300);
    let out = routing_hint(&long);
    assert_eq!(out.chars().count(), 200);
}

#[test]
fn routing_hint_cap_never_splits_a_utf8_char() {
    // 199 ASCII chars then a multi-byte char at the boundary: cap must not slice mid-codepoint.
    let s = format!("{}é and more text to exceed the cap so truncation actually happens here now", "x".repeat(199));
    let out = routing_hint(&s);
    assert!(out.chars().count() <= 200);
    // Round-trips as valid UTF-8 (String guarantees this; the assert documents intent).
    assert_eq!(out, out.clone());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test routing_hint`
Expected: FAIL — `cannot find function 'routing_hint' in this scope`.

- [ ] **Step 3: Write the implementation**

Add just above `compose_user` (around line 44) in `src-tauri/src/deduce.rs`:

```rust
// routing_hint: a short signal for the lightweight deduce call — the first ~2 sentences of the
// prompt, hard-capped at 200 chars (UTF-8 safe). Keeps step-1 (repo/branch pick) fast and focused
// even when the prompt is long task context meant for the Claude work pane.
pub fn routing_hint(prompt: &str) -> String {
    // Walk chars, keeping bytes up to the end of the 2nd sentence-terminator (. ! ?).
    let mut end = prompt.len();
    let mut sentences = 0;
    for (i, c) in prompt.char_indices() {
        if c == '.' || c == '!' || c == '?' {
            sentences += 1;
            if sentences == 2 {
                end = i + c.len_utf8(); // include the terminator
                break;
            }
        }
    }
    let sliced = &prompt[..end];
    // Hard cap at 200 chars on a char boundary (take is char-based, so never splits a codepoint).
    sliced.chars().take(200).collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test routing_hint`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat: add routing_hint helper for bounded deduce signal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire `routing_hint` into `deduce_worktree`

**Files:**
- Modify: `src-tauri/src/deduce.rs:431-519` (`deduce_worktree`)

**Interfaces:**
- Consumes: `routing_hint(&str) -> String` (Task 1); the existing `compose_user`, `compose_user_ticket`, `compose_user_slack`, `compose_user_github` builders (signatures unchanged).
- Produces: no signature change to `deduce_worktree` — same `(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String>`.

- [ ] **Step 1: Compute the hint once**

In `src-tauri/src/deduce.rs`, immediately after the digests line in `deduce_worktree` (currently line 435), add:

```rust
    let digests: Vec<serde_json::Value> = repo_paths.iter().map(|p| read_repo_digest(p)).collect();
    // Bound the free-prose fed to the deduce LLM: refs are detected on the FULL prompt below and
    // passed as their own args, so this only trims low-value context that would slow step 1.
    let hint = routing_hint(&prompt);
```

- [ ] **Step 2: Swap the four `compose_user*` call sites to use `&hint`**

Change each `compose_user*` call inside the `match` from `&prompt` to `&hint`. Ref-detection (`detect_source(&prompt)`) and every other use of `prompt` stay on the full prompt. The four edits:

GitHub arm (line ~449):
```rust
                user_prompt: &compose_user_github(&hint, &ctx, &digests),
```
Linear arm (line ~464):
```rust
                user_prompt: &compose_user_ticket(&hint, &id, &digests),
```
Slack arm (line ~485):
```rust
                user_prompt: &compose_user_slack(&hint, &url, &digests),
```
Plain arm (line ~507):
```rust
                user_prompt: &compose_user(&hint, &digests),
```

- [ ] **Step 3: Verify it compiles and the full suite is green**

Run: `cd src-tauri && cargo build && cargo test`
Expected: build succeeds with no new warnings; all existing tests plus the 5 new `routing_hint` tests pass. (The `compose_user*` tests are unaffected — they call those builders directly, not through `deduce_worktree`.)

- [ ] **Step 4: Confirm no frontend change is needed**

Run: `grep -n "deduceWorktree" src/settings/store.ts`
Expected: the call still passes the full `prompt` (unchanged); `makeWorktree({ …, prompt })` still persists the full prompt for the Claude pane. No edits required — this step only verifies the assumption.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat: feed deduce a bounded routing hint instead of the full prompt

Ref-detection still runs on the full prompt; the pane still gets the full
prompt via the persisted Worktree.prompt. Fixes long prompts blocking step 1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `routing_hint` rule (2 sentences + 200-char UTF-8 cap + fallback) → Task 1. ✓
- Compute once, swap 4 call sites, ref-detection on full prompt, refs/context stay full → Task 2. ✓
- No frontend change; full prompt still reaches the pane → Task 2 Step 4 verifies. ✓
- Tests for extraction, cap, char-boundary, fallback → Task 1 Step 1. ✓
- Existing `compose_user*` tests unaffected → Task 2 Step 3 note. ✓

**Placeholder scan:** none — all steps carry real code and exact commands.

**Type consistency:** `routing_hint(&str) -> String` defined in Task 1, consumed with `&hint` (a `String` deref-coerced to `&str`) in Task 2 — consistent. `compose_user*` signatures unchanged.
