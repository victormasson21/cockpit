# Deduce hint: first sentence only (spec + plan)

2026-07-28 · lightweight combined spec/plan (change is one pure function).

## Requirement

The deduce flow should derive the worktree name/branch from only the **first sentence** of the
user's prompt. The full prompt keeps flowing everywhere else — source-ref detection and the
Claude-pane auto-send are untouched (already the case).

## Design

Change `routing_hint` (`src-tauri/src/deduce.rs`) from "first 2 sentences" to "first sentence",
with a smarter boundary so dots inside tokens don't truncate:

- A sentence ends at a `.` `!` `?` **followed by whitespace or end-of-input** — so `store.ts`,
  URLs, and `v2.1` don't end the sentence.
- A **newline** also ends the sentence (title-style prompts: first line = the hint).
- The 200-char UTF-8-safe hard cap stays; a prompt with no boundary returns whole (capped).

Explicitly unchanged: `detect_source` still scans the full prompt; `Worktree.prompt` persistence
and the Claude-pane auto-send still get the full input; no frontend/IPC changes.

## Plan

1. RED: rewrite the `routing_hint_*` tests for one-sentence semantics + new cases
   (mid-token dot, newline boundary, terminator at end-of-input); watch them fail.
2. GREEN: reimplement `routing_hint`; all Rust tests green, builds clean.
