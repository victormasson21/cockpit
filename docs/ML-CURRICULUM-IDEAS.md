# Cockpit × ML Curriculum — Practice Ideas

> Ways to improve Cockpit that double as practice for the Founders and Coders Level 6 ML
> Engineer apprenticeship (`~/Repos/fac/fac-ml-curriculum.md`). Nothing here is scheduled —
> this is a parking lot, separate from `ROADMAP.md`. When an idea gets picked up, run it
> through the normal brainstorming → spec → plan cycle and move it to the roadmap.
>
> Cockpit's advantage: it already has an LLM call at its core (`deduce_worktree`) plus real
> data streams (PTY scrollback, Slack, PRs), so most modules map onto genuine improvements
> rather than artificial exercises.

---

## Strongest fits

### 1. Deduce evaluation harness — *Module 2 (RAG & Evaluation), Module 4 (agent testing)*

Deduce is a black-box LLM call with zero regression protection today. Build an eval harness:

- A test set of prompts (Linear refs, GitHub URLs, Slack permalinks, plain prompts) with
  expected outputs (repo, branch mode, name shape).
- **Synthetic test data generation** — use Claude to generate adversarial prompts and
  edge-case variations from real repo digests.
- Score deduce accuracy, run in CI, detect regressions when the system prompt or model changes.

Almost exactly Module 2's deliverable 2, applied to our own system. **Keystone idea:** the
harness becomes the measurement layer for #4 (routing), #6 (fine-tune comparison), and
#5 (injection defences) — build it first.

### 2. Cockpit MCP server + agent loop — *Module 4 (Building an Agent)*

- An MCP server exposing Cockpit's internals: `create_worktree`, `list_worktrees`,
  `read_pane_scrollback`, `worktree_diff`, `teardown`.
- Upgrade deduce from a one-shot call into a real **agent loop**: planning, tool calls
  (inspect the repo, check branches, read the ticket), error recovery, and a
  human-in-the-loop checkpoint before `create_worktree` runs.
- **Trajectory tests**: assert on tool-call sequences across a task set.

Covers Module 4 deliverables 1–3; Rust-side MCP is a strong learning axis.

### 3. Semantic search over the workspace ("Recall" tile) — *Module 2 (RAG)*

Ingest terminal scrollback, worktree specs/plans (`docs/superpowers/`), Slack messages, and
PR descriptions → chunk, embed, store in a local vector DB → ask "which worktree was I
fixing the diff base fallback in?" with cited answers. The full pipeline (chunking,
embeddings, cosine similarity, re-ranking) against a genuinely messy real corpus.

### 4. MLOps layer on deduce — *Module 7 (MLOps)*

Deduce hardcodes `claude-haiku-4-5` everywhere. Build:

- **Model routing** — simple prompt → haiku, ambiguous multi-repo prompt → a bigger model;
  measure cost/latency/quality per configuration.
- **Caching** of repo digests and repeated deductions.
- **Cost tracking** — a spend tile (the `claude -p` JSON envelope already returns usage).
- **Prompt versioning** for the deduce system prompts.
- Latency/failure monitoring.

Module 7's deliverable is literally "a production ops layer on one of your existing systems".

### 5. Red-team the deduce flow — *Module 9 (Security & Responsible AI)*

Cockpit has a real, non-toy prompt-injection surface: untrusted content flows into deduce
prompts — README snippets, `package.json` descriptions, GitHub PR bodies, Slack message
text. A malicious README could try to steer branch names, exfiltrate the known-repos list,
or abuse the `bypassPermissions` Slack MCP path.

- Attack it (garak, hand-crafted injections); document severity.
- Build defences: input sanitisation, output validation (extend the existing
  `sourceResolved` guardrail pattern), before/after testing.

Module 9's deliverable 3, on a system we actually run.

---

## Good fits with more stretch

### 6. Fine-tune a small model to replace haiku in deduce — *Modules 5 + 8*

Collect deduce history (prompt → chosen repo/branch/name) as seed data, expand it
synthetically, LoRA-fine-tune a small open model, quantise it, serve it on RunPod behind
FastAPI then vLLM, and point Cockpit's deduce at the endpoint via a configurable base URL.
Then use the #1 eval harness to compare fine-tuned vs. haiku vs. base — the exact "was
fine-tuning worth it" question Module 8 asks.

### 7. Voice-driven worktree creation — *Module 1 (LiveKit)*

Push-to-talk in Cockpit: speak "check out the PR Sarah posted about the diff tab" →
Realtime API → text → the existing `startDeduceWorktree` flow. Tool calling mid-dialogue
maps to deduce + create. Caveat: WebRTC-in-Tauri is a chunk of plumbing that teaches
Module 1's material but adds the least everyday value to the app.

### 8. From-scratch classifier for attention/triage — *Module 3 (Maths for DL)*

A tiny model trained from scratch (NumPy or even Rust) on a real micro-problem: classify
terminal output lines as "needs attention" vs. noise (richer than the current bell
heuristic), or predict which repo a prompt targets before calling the LLM. Small enough to
hand-implement gradient descent, real enough to ship into the app.

---

## Suggested sequencing

Build the **eval harness (#1)** first — it is the measurement layer everything else scores
against, mirroring how the curriculum sequences evaluation (Module 2) before MLOps
(Module 7) and production DL (Module 8).
