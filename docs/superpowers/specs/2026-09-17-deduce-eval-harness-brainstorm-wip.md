# Deduce evaluation harness — brainstorm (IN PROGRESS)

> **Status: WIP brainstorm, not an approved design.** Decision 1 of 6 is open. No code
> was written and no decision is settled. Resume by reading this file, then re-asking the
> open decision below.
>
> Source: idea #1 in `docs/ML-CURRICULUM-IDEAS.md`. Curriculum: Module 2 (RAG &
> Evaluation) in `~/Repos/fac/fac-ml-curriculum.md`.
>
> **Mode: dialectic.** The point is that the human owns every decision and can explain it
> afterwards. Work one decision at a time. State the recommendation and the reasoning,
> then let the human choose. Do not batch the remaining decisions into one proposal.

---

## Context established so far

**What deduce is.** `src-tauri/src/deduce.rs` (860 lines) turns a task prompt plus a list
of known repos into worktree parameters: `repoPath`, `name`, `branch`, `base`, `startCmd`,
`address`, `reason`. It shells out to the `claude` CLI in headless JSON mode
(`-p --output-format json --json-schema <inline> --model claude-haiku-4-5`) from a neutral
cwd. Four paths branch off `detect_source`: GitHub (fetch via `gh`, then deterministic
overrides), Linear (MCP), Slack (MCP + permission bypass), and plain.

**What is tested today.** About 30 `cargo test` cases in `deduce.rs`. Every one covers a
pure function *around* the model call — `routing_hint`, `detect_linear_ref`,
`detect_slack_ref`, `parse_envelope`, `apply_github_overrides`, `validate_repo`,
`with_install`, `tauri_dev_url`, `strip_origin_prefix`.

**What has no coverage.** The judgement itself. Nothing measures whether the model picks
the right repo, proposes a sensible name and branch, or infers the right start command.
That is what this harness measures, and it is a different kind of test: non-deterministic,
slow (15–43 s per call, 120 s timeout), networked, and scored rather than asserted.

**Why this idea first.** It is the measurement layer that ideas #4 (model routing and
MLOps), #5 (prompt-injection defences) and #6 (fine-tune vs. haiku) all score against.

**Curriculum fit.** Module 2, deliverable 2: "an evaluation harness with synthetic test
data and automated tests that produce quantitative results on retrieval and generation
quality." So synthetic test-data generation and real metrics are both in scope, not just
pass/fail. Named technologies: NumPy, the Anthropic API, a custom evaluation harness.

---

## Decision 1 (OPEN) — where the harness sits relative to the code it tests

Ask this first on resume. Framing to re-use:

The trap is option C. It is the most pleasant to work in, because prompts iterate without
a recompile. But it scores a Python copy of the prompt assembly. The moment
`compose_user_github` changes in Rust, the harness stays green while the app regresses. An
eval that can lie about the shipped path is worse than no eval, because it gets trusted.

**A. Python harness → real Rust path (recommended).** Add a headless entry point to the
Rust crate — a `cockpit-deduce` bin, or an `--eval` subcommand — that runs the real
`deduce_worktree` logic and prints JSON. A Python harness shells out to it, scores the
results, and writes a run artefact. No prompt duplication, so the shipped code path is
what gets measured; scoring, metrics and plots live in the curriculum's own toolchain.

**B. Harness in Rust, as `#[ignore]`d cargo tests** that hit the live CLI. No new plumbing
and one language, but scoring functions, metric aggregation and comparable run reports are
painful in Rust, and none of the Python data-handling the curriculum wants gets exercised.

**C. Pure Python, prompts reimplemented.** Fastest iteration, no Rust changes, but it
scores a copy. Drift makes a green harness meaningless.

---

## Remaining decisions (not yet discussed)

Each one is a separate dialectic round. Order is deliberate — later ones depend on earlier.

2. **Ground truth corpus.** Fixture repos committed to this repo (deterministic digests,
   reproducible across machines and over time) vs. the real `~/Repos` (realistic, but the
   ground truth moves whenever a README or `package.json` changes). Note that
   `read_repo_digest` reads `package.json`, `README.md`, lockfiles and
   `src-tauri/tauri.conf.json`, so a fixture repo is only a handful of small files.

3. **Per-field scoring.** The output fields need different scorers. `repoPath` is exact
   match against the known list. `base`, `existingBranch`, `prNumber` are exact. `startCmd`
   and `address` are near-exact. `name` and `branch` are semantic — options are shape
   rules (kebab-case, length, contains the ticket id), embedding similarity, or
   LLM-as-judge. Pick per field and justify each.

4. **Path coverage.** Plain path only to start, or GitHub / Linear / Slack too. The three
   source paths need live network, a `gh` account and connected MCPs, so they are the
   flaky, expensive part of any run.

5. **Non-determinism.** Whether to sample each case k times and report consistency
   (pass@k, or per-field agreement across runs), and how many cases a run can afford at
   15–43 s each. This decides whether a full run is minutes or an hour.

6. **Run artefact and regression detection.** The JSON/CSV shape a run writes, how two runs
   are compared, and what counts as a regression. Also: does this ever run in CI? It needs
   `claude` CLI auth and MCP connections, so a local `make eval` is the likely answer.

Synthetic test-data generation (Module 2's explicit ask) attaches to decision 2 — generate
adversarial prompts and edge cases from the fixture digests once the corpus is settled.

---

## How to resume

1. Read this file.
2. Re-ask decision 1 with the framing above, as a single question.
3. Work down the remaining decisions one at a time.
4. When all six are settled, write the real design doc to
   `docs/superpowers/specs/<date>-deduce-eval-harness-design.md`, then use the
   writing-plans skill for the implementation plan. Delete this WIP file at that point.
