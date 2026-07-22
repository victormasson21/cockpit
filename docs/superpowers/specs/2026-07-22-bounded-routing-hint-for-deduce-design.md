# Bounded routing hint for deduce — design

**Date:** 2026-07-22
**Status:** design approved, pre-plan

## Problem

The new-worktree flow uses one `prompt` string for two consumers with opposite needs:

1. **Deduce (step 1)** — `deduce_worktree(prompt, …)` shells out to `claude -p` (haiku)
   to pick a repo and name a branch. It is lightweight and wants a *short, targeted*
   signal; latency and cost scale with prompt length, and long prose can dilute the
   repo-selection signal.
2. **Work (step 2)** — the same prompt is persisted as `Worktree.prompt` and auto-sent
   into the Claude pane (`claudeAutostart`) to do the actual implementation. This wants
   the *full, rich* context.

A long prompt that works well for step 2 blocks step 1 for ages; a short prompt that
works well for step 1 launches step 2 with too little to go on. One string cannot serve
both.

## Decision

Resolve the tension at step 1 only, by deriving a short **routing hint** from the prompt
for the deduce LLM call, while step 2 keeps the full prompt unchanged.

Key facts from the existing code that make this clean:

- `deduce_worktree(prompt, repo_paths)` (`src-tauri/src/deduce.rs`) receives the **full
  prompt** and runs ref-detection on it (`detect_github_ref` / `detect_linear_ref` /
  `detect_slack_ref`), then routes to one of four paths, each calling a `compose_user*`
  builder that embeds the prompt into the `claude -p` `user_prompt`.
- On **ref paths**, the ref is passed as its own argument (`id` / `url` / `ctx`) and the
  ticket / PR / Slack content is *fetched separately*. The user's free-prose is therefore
  low-value for routing on those paths.
- The **frontend uses the same `prompt` variable** for both the deduce call
  (`store.ts:234`) and the persisted `Worktree.prompt` that feeds the pane (`store.ts:250`).
  The pane's copy is independent of whatever deduce does internally.

Therefore the fix is **entirely Rust-internal**, with **no frontend change**.

## The routing-hint rule

A single pure helper in `deduce.rs`:

```rust
routing_hint(prompt: &str) -> String
```

- Take the **first ~2 sentences** — split on sentence terminators `.` `!` `?`.
- Then **hard-cap at 200 chars**, truncating on a UTF-8 character boundary (never mid-codepoint).
- If there are fewer than 2 sentence terminators, use the whole prompt, still capped at 200.

Rationale: titles/summaries almost always lead (Linear/PR titles, commit-style pastes),
so the first couple of sentences carry the routing intent; the 200-char cap backstops
pathological single-sentence paste-bombs. Simplest thing that works — a slightly-off
sentence boundary is harmless because the 200-char cap is the real safety net and the
ref (when present) is carried by a separate argument.

## Wiring

In `deduce_worktree`, compute the hint **once**:

```rust
let hint = routing_hint(&prompt);
```

Then pass `&hint` in place of `&prompt` into all four `compose_user*` builders (plain /
ticket / slack / github). Nothing else in the function changes:

- **Ref-detection still runs on the full `prompt`** → ref-safe. A buried `ENG-123` or PR
  URL is never lost, because detection sees the whole string.
- The **ref/id/url and the fetched ticket / PR / Slack context stay full** — they are
  separate arguments and carry the real routing signal. Only the free-prose is bounded.
- The **full `prompt` still flows back to the frontend** for step 2 (it was passed in by
  the caller and is persisted as `Worktree.prompt`), untouched.

## Net effect

- Step 1 always receives a short, targeted signal regardless of prompt length.
- Step 2 is completely untouched — the Claude pane still gets the full prompt.
- The "long prompt blocks deduce" problem is eliminated.

## Testing

- New unit tests for `routing_hint`: two-sentence extraction, the 200-char hard cap,
  the UTF-8 char-boundary safety, and the fewer-than-two-sentences fallback.
- Existing `compose_user*` tests are unaffected — their fixtures are short,
  single-sentence prompts (`"fix login"`, `"do the thing"`), all under 200 chars.

## Scope

This spec covers **only** the prompt-tension fix (option B from the design discussion).
The broader "make the input→worktree flow reusable" work is tracked separately and is not
part of this change.

## Out of scope / considered and rejected

- **Two explicit UI fields** (short summary + long task) — kills the "paste one thing, go"
  fast path and forces every programmatic caller (PR tile, future callers) to supply two
  values. Rejected in favour of the zero-friction single-input approach.
- **A second LLM call to summarize the prompt for routing** — defeats the "lightweight
  step 1" goal by adding a call. Rejected in favour of the deterministic local helper.
- **Deriving the hint in the frontend** — ref-detection must run on the *full* prompt in
  Rust to choose the invocation, so hint derivation must happen after detection, in Rust.
