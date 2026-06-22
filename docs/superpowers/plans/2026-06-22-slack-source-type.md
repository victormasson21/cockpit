# Slack Source Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Implementation is deferred** — this plan is written now and executed later.
> Task 1 is a paid **human-run** smoke test that pins the Slack-MCP CLI facts the
> code depends on; do it first when work resumes.

**Goal:** Let a Slack message permalink in the new-worktree prompt be resolved — via the user's Slack MCP — into message+thread context that drives the deduction, with the worktree getting a new agent-named branch and the Slack link auto-added to the created worktree.

**Architecture:** Extend the existing `deduce_worktree` command. A pure Rust helper detects a Slack permalink; when present, the `claude` CLI call is run MCP-enabled (the shared source schema + a Slack system prompt + `--allowedTools`) so the agent fetches the message (and its thread) itself. A `sourceResolved` guardrail turns an unresolved message into an inline error (never fabricated params); Rust deterministically sets `source_url` to the pasted permalink; no id is pinned (Slack has no short id) so the branch/name are fully agent-proposed. The frontend is **unchanged** — Slack reuses the source-neutral fields, banner, and link-staging the GitHub iteration left. No new provider, no new file, no new dependency, no IPC signature change.

**Tech Stack:** Tauri v2, Rust (`std::process::Command` + `wait-timeout`, `serde_json` — hand-rolled ref parsing, no `regex` crate), React 19 + TS, Zustand, Vitest.

## Global Constraints

- **Learning project:** one-line role comment at the top of every file; one-line intent comment atop each significant block. High-signal only — explain intent, not syntax.
- **Minimalism:** smallest thing that works; no new files; **no new dependencies** (Slack ref parsing is hand-rolled).
- **Dual-definition discipline:** persisted/IPC shapes exist as a Rust serde struct AND a mirrored TS type (camelCase via `#[serde(rename)]`). (Slack adds no new fields — it reuses the existing source-neutral ones.)
- **Backward-compatible:** `DeducedWorktree` is unchanged; `cockpit.json` `version` stays `1`; `Worktree` model unchanged.
- **IPC unchanged:** `deduce_worktree(prompt: String, repo_paths: Vec<String>)` keeps its signature; the plain / Linear / GitHub paths stay byte-identical.
- **Never silent / never fabricate:** deduce only fills the form; only the user-clicked Create makes a worktree. A detected-but-unresolved message (`source_resolved == false`) returns an error and leaves manual entry working.
- **Reuse Claude Code auth/MCP:** the message fetch is delegated to the user's Slack MCP via the `claude` CLI; no API key, no in-app Slack auth this iteration.
- **Source-neutral naming:** Slack reuses `source_url`/`source_title`/`source_resolved`, `sourceLinkFrom`, the banner, and the `Source` enum. Slack-specific names stay inside `detect_slack_ref` / `compose_user_slack` / `SYSTEM_PROMPT_SLACK` / the `SLACK_*` consts.
- **Tests:** Rust `cd src-tauri && cargo test`; frontend `npm test` (Vitest). Headless build checks: `cargo build`, `npm run build`, `npx tsc --noEmit`. GUI the user eyeballs.

## Verified CLI facts (PINNED by Task 1 — fill in after the smoke test)

Confirm against a real permalink with the Slack MCP connected, via a headless `claude -p` smoke run by the **human** (the agent's Bash-spawned `claude` is not logged into the MCPs):

**PINNED (live smoke, 2026-06-22).** Confirmed against a real DM permalink with the `claude.ai Slack` connector `✔ Connected`, via a headless `claude -p` from a temp dir:

- `SLACK_ALLOWED_TOOLS` — the exact `--allowedTools` string: **`mcp__slack`** (the claude.ai connector's headless name, like `mcp__linear` — NOT the in-session tool-namespace UUID `mcp__01908495-…`, which was the original wrong guess).
- whether a `--permission-mode` flag is also required: **Yes — `bypassPermissions` is required.** Unlike Linear, the Slack connector gates its tool calls even when allow-listed via `--allowedTools`; without the bypass the agent reports "Slack message fetch requires permission" and returns `sourceResolved=false`. Kept alongside `--allowedTools "mcp__slack"`, so the agent is still restricted to Slack tools only.
- `SLACK_MODEL` — **`claude-haiku-4-5` suffices** (resolved the DM, read the message, emitted the forced JSON; ~6 turns).
- whether the Slack MCP can resolve a **permalink** directly: **Yes** — the agent resolved a bare `archives/<channel>/p<ts>` permalink (a DM, `D…` channel) with no channel+ts parsing needed; Rust passes the raw permalink. (Private/DM access confirmed working.)
- whether the connector loads for `claude -p` from `std::env::temp_dir()`: **Yes** (`claude mcp list` shows it `✔ Connected` from the temp dir, and the smoke ran from one).
- Note: the agent's own Bash-spawned `claude` **was** able to reach the connector this time (the connectors show `✔ Connected`), so this smoke was run by the agent — contrary to the earlier assumption. The GUI end-to-end retry remains the human's final confirmation.

---

## File Structure

- `src-tauri/src/deduce.rs` (modify) — pure helpers `detect_slack_ref`, `compose_user_slack`; rename `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE`; `SYSTEM_PROMPT_SLACK` + `SLACK_*` consts; the `Source::Slack` variant + `detect_source` branch + the Slack arm in `deduce_worktree`.
- `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (modify) — as-built notes + status.

No frontend files change (the source-neutral seam already handles Slack). No new files.

---

### Task 1: Smoke-test the Slack-MCP `claude -p` call (manual, paid ~$0.08) + pin CLI facts

The Slack path depends on empirically-unknown CLI behaviours (mirrors the Linear const-pinning task). This task runs a real call and records the answers; no code ships here. **Do this first when implementation resumes. Run by the human — the agent's `claude` is not logged into the MCPs.**

**Files:** none (updates the "Verified CLI facts" block of this plan).

- [ ] **Step 1: Find the Slack MCP server name**

Run: `claude mcp list`
Note the Slack server's name (the `mcp__<name>__…` prefix). If no Slack MCP is listed, connect one before continuing (this iteration assumes the user has it).

- [ ] **Step 2: Run an MCP-enabled headless call against a real permalink**

From the repo root, substituting the server name from Step 1 (try `--allowedTools "mcp__<name>"` first; if it doesn't fetch, retry with a specific tool e.g. `"mcp__<name>__slack_read_thread"`, then with `--permission-mode acceptEdits` added). Use a real permalink you can access — the thread-reply form exercises the richest path:

```bash
SCHEMA='{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"sourceResolved":{"type":"boolean"}},"required":["repoPath","name","branch","base","startCmd","address","reason","sourceUrl","sourceTitle","sourceResolved"],"additionalProperties":false}'
(cd "$(mktemp -d)" && claude -p 'A Slack message (https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782140757530969?thread_ts=1782140735.398509&cid=C0ADKCM7A4U) was referenced; fetch it and its thread via the Slack MCP and use the discussion to choose a short name + new branch. Pick repoPath from these only. Set sourceTitle from the discussion and sourceResolved=true. Known repos: [{"path":"/Users/victormasson/Repos/perso/cockpit","basename":"cockpit"}]' \
  --system-prompt 'You deduce git worktree parameters and may fetch a referenced Slack message (and its thread) via the Slack MCP. Output only the structured object.' \
  --output-format json --json-schema "$SCHEMA" --model claude-haiku-4-5 \
  --allowedTools "mcp__<name>" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("is_error:", d.get("is_error")); print(json.dumps(d.get("structured_output"), indent=2))')
```

Expected: `is_error: False`, a `structured_output` whose `sourceResolved` is `true`, with a `sourceTitle` derived from the message/thread and a sensible `name`/`branch`. Running from `$(mktemp -d)` checks the temp-cwd MCP-loading question. **Watch specifically whether the agent could resolve the permalink** (vs. complaining it needs a channel id + ts).

- [ ] **Step 3: If haiku fails to use the tool reliably, retry with a stronger model**

Re-run Step 2 with `--model claude-sonnet-4-6`. Decide the smallest model that reliably fetches the message + thread.

- [ ] **Step 4: If the MCP can't resolve a bare permalink, test the channel+ts fallback**

Re-run Step 2 but append to the prompt: `The channel id is C0ADKCM7A4U and the thread_ts is 1782140735.398509.` If that fixes it, record in the facts block that Rust should parse `cid`/`thread_ts` from the permalink and pass them in the user prompt (a small change to `compose_user_slack` in Task 2 — add the parsed hints).

- [ ] **Step 5: Record the pinned facts + commit**

Edit the "Verified CLI facts" block above with the working `--allowedTools` string, whether `--permission-mode` was needed, the chosen model, whether the bare permalink resolved (or the channel+ts fallback was needed), and whether the temp-cwd worked. Commit:

```bash
git add docs/superpowers/plans/2026-06-22-slack-source-type.md
git commit -m "docs(plan): pin Slack-MCP CLI facts from smoke test"
```

---

### Task 2: Pure Rust helpers + the source-neutral schema rename (no CLI)

All the risky, deterministic logic, fully unit-tested without invoking the CLI: Slack ref detection, the Slack user-prompt composer, and the `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE` rename (now shared by Linear and Slack). The `Source::Slack` variant and the live branch come in Task 3 (kept separate so this task compiles with an exhaustive `match`).

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Produces (Rust, pure): `detect_slack_ref(&str) -> Option<String>`, `compose_user_slack(prompt: &str, url: &str, digests: &[serde_json::Value]) -> String`.
- Renames (Rust): const `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE` (value unchanged); updates its one use in the Linear arm of `deduce_worktree`.

- [ ] **Step 1: Write the failing tests for the new pure helpers**

In `src-tauri/src/deduce.rs` `tests` module, add:

```rust
    #[test]
    fn detect_slack_ref_matches_permalinks_and_rejects_noise() {
        assert_eq!(
            detect_slack_ref("https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782139459441759"),
            Some("https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782139459441759".into())
        ); // plain permalink
        assert_eq!(
            detect_slack_ref("see (https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782140757530969?thread_ts=1782140735.398509&cid=C0ADKCM7A4U)."),
            Some("https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782140757530969?thread_ts=1782140735.398509&cid=C0ADKCM7A4U".into())
        ); // thread form embedded in prose: surrounding ()./ trimmed, query kept verbatim
        assert_eq!(detect_slack_ref("fix the login bug"), None); // plain prompt
        assert_eq!(detect_slack_ref("https://elderteam.slack.com/"), None); // workspace home, not an archives permalink
        assert_eq!(detect_slack_ref("https://github.com/a/b/pull/3"), None); // github not misdetected
        assert_eq!(detect_slack_ref("fix ENG-1234"), None); // linear ref not misdetected
    }

    #[test]
    fn compose_user_slack_names_url_prompt_and_digests() {
        let digests = vec![serde_json::json!({"basename": "web-app"})];
        let out = compose_user_slack("do this in the web-app", "https://x.slack.com/archives/C1/p1", &digests);
        assert!(out.contains("do this in the web-app"));
        assert!(out.contains("https://x.slack.com/archives/C1/p1"));
        assert!(out.contains("web-app"));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test deduce::`
Expected: FAIL to compile — `detect_slack_ref`, `compose_user_slack` not defined.

- [ ] **Step 3: Implement the pure helpers**

In `src-tauri/src/deduce.rs`, add near the other pure helpers (e.g. after `compose_user_ticket`):

```rust
// Detect a Slack message permalink (*.slack.com/archives/…) anywhere in the prompt; None for plain prompts. Pure, no I/O.
pub fn detect_slack_ref(prompt: &str) -> Option<String> {
    // Scan whitespace-delimited tokens; return the whole permalink with surrounding paste-punctuation trimmed.
    prompt
        .split_whitespace()
        .find(|t| t.contains(".slack.com/archives/"))
        .map(|t| t.trim_matches(|c| matches!(c, '(' | ')' | ',' | '.' | '<' | '>')).to_string())
}

// Compose the Slack-path user prompt: the plain composition plus an instruction to fetch the message+thread.
pub fn compose_user_slack(prompt: &str, url: &str, digests: &[serde_json::Value]) -> String {
    format!(
        "{}\n\nA Slack message ({url}) was referenced; fetch it (and its thread, if any) via the Slack MCP \
and use the discussion to choose the name and branch, and set sourceTitle/sourceResolved accordingly.",
        compose_user(prompt, digests)
    )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test deduce::`
Expected: PASS — all existing `deduce::tests` plus the two new ones.

- [ ] **Step 5: Rename `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE`**

The schema's fields are already source-neutral (`sourceUrl`/`sourceTitle`/`sourceResolved`); the name should be too now that Linear and Slack both use it. In `src-tauri/src/deduce.rs`:

1. Rename the const definition (the comment too):

```rust
// Source-path schema: the plain fields plus the source-context fields, all required. Shared by the Linear and Slack paths.
const DEDUCE_SCHEMA_SOURCE: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"},"sourceUrl":{"type":"string"},"sourceTitle":{"type":"string"},"sourceResolved":{"type":"boolean"}},"required":["repoPath","name","branch","base","startCmd","address","reason","sourceUrl","sourceTitle","sourceResolved"],"additionalProperties":false}"#;
```

2. Update its one current use in the Linear arm of `deduce_worktree` (the `schema:` field):

```rust
                schema: DEDUCE_SCHEMA_SOURCE,
```

- [ ] **Step 6: Build to confirm the rename compiles**

Run: `cd src-tauri && cargo test deduce:: && cargo build`
Expected: PASS + clean build — `DEDUCE_SCHEMA_TICKET` no longer referenced anywhere.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): pure Slack ref detection + slack prompt; rename ticket schema source-neutral"
```

---

### Task 3: Live Slack branch in `deduce_worktree` (MCP-enabled CLI call + guardrail)

Wires the pure helpers into the command: add the `Source::Slack` variant, branch on it in `detect_source`, run the MCP-enabled call with the Task-1-pinned tool/model, apply the `source_resolved` guardrail, and set `source_url` deterministically (no id pinning). Uses the values pinned in "Verified CLI facts".

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Consumes: Task 2 helpers (`detect_slack_ref`, `compose_user_slack`, `DEDUCE_SCHEMA_SOURCE`); existing `run_claude`/`ClaudeCall`, `parse_envelope`, `validate_repo`, `default_branch`.
- Produces (IPC, unchanged signature): `deduce_worktree(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String>` — now Slack-aware.

- [ ] **Step 1: Add the Slack-path consts**

In `src-tauri/src/deduce.rs`, next to the `LINEAR_*` consts, add (set `SLACK_ALLOWED_TOOLS` / `SLACK_MODEL` to the Task-1 pinned values — the defaults below are the starting guesses):

```rust
// Slack-path system prompt: same deduction, but the agent fetches the referenced Slack message (and its thread) via MCP and must report whether it did.
const SYSTEM_PROMPT_SLACK: &str = "You deduce git worktree parameters from a task prompt that references a Slack message. \
Fetch the referenced message via the Slack MCP, and if it is part of a thread, read the thread for context. Use the \
discussion to choose a short descriptive name and a new branch. Choose repoPath from the provided repo digests ONLY \
(copy one exactly); the prompt text may name the repo. Also propose the base branch and the dev-server start \
command/address from that repo's scripts/README, with a one-line reason. Set sourceTitle to a short label for the \
discussion and sourceResolved=true (sourceUrl may echo the permalink). If you CANNOT fetch the message, set \
sourceResolved=false. Output only the structured object.";

// Pinned in Task 1's smoke test (Verified CLI facts). Starting guesses below.
const SLACK_ALLOWED_TOOLS: &str = "mcp__01908495-040f-4e65-9662-113bde0be3f5";
const SLACK_MODEL: &str = "claude-haiku-4-5";
```

- [ ] **Step 2: Add the `Source::Slack` variant + the `detect_source` branch**

In `src-tauri/src/deduce.rs`, extend the enum and the detector (Slack is detected after GitHub and Linear):

```rust
// The resolved kind of source the prompt references — one branch point for deduction.
enum Source {
    GitHub(GithubRef),
    Linear(String),
    Slack(String),
    Plain,
}

// Detect which source a prompt references: a GitHub URL wins, then a Linear ref, then a Slack permalink, else plain.
fn detect_source(prompt: &str) -> Source {
    if let Some(r) = github::detect_github_ref(prompt) {
        Source::GitHub(r)
    } else if let Some(id) = detect_linear_ref(prompt) {
        Source::Linear(id)
    } else if let Some(url) = detect_slack_ref(prompt) {
        Source::Slack(url)
    } else {
        Source::Plain
    }
}
```

- [ ] **Step 3: Add the failing `detect_source` test for Slack**

In the `tests` module, add:

```rust
    #[test]
    fn detect_source_picks_slack_after_github_and_linear() {
        assert!(matches!(detect_source("https://x.slack.com/archives/C1/p1"), Source::Slack(_)));
        // GitHub still wins when both a GitHub URL and a Slack link are present.
        assert!(matches!(detect_source("github.com/a/b/pull/3 https://x.slack.com/archives/C1/p1"), Source::GitHub(_)));
    }
```

- [ ] **Step 4: Run it to verify it fails (non-exhaustive match)**

Run: `cd src-tauri && cargo test deduce::`
Expected: FAIL to compile — the `match detect_source(&prompt)` in `deduce_worktree` is now non-exhaustive (missing `Source::Slack`).

- [ ] **Step 5: Add the Slack arm to `deduce_worktree`**

In `src-tauri/src/deduce.rs`, inside the `match detect_source(&prompt)` of `deduce_worktree`, add the Slack arm (e.g. after the `Source::Linear` arm):

```rust
        // Slack: MCP-enabled call so the agent fetches the message+thread. New branch, no id pinned.
        Source::Slack(url) => {
            let stdout = run_claude(ClaudeCall {
                user_prompt: &compose_user_slack(&prompt, &url, &digests),
                system_prompt: SYSTEM_PROMPT_SLACK,
                schema: DEDUCE_SCHEMA_SOURCE,
                model: SLACK_MODEL,
                allowed_tools: Some(SLACK_ALLOWED_TOOLS),
            })?;
            let mut deduced = validate_repo(parse_envelope(&stdout)?, &repo_paths)?;
            if let Some(b) = default_branch(&deduced.repo_path) {
                deduced.base = b;
            }
            // Never fabricate on an unresolved message.
            if !deduced.source_resolved {
                return Err("couldn't resolve Slack message (is the Slack MCP connected?)".into());
            }
            // The permalink the user pasted is the canonical URL — trust it over the agent's echo.
            deduced.source_url = url;
            Ok(deduced)
        }
```

- [ ] **Step 6: Build + run tests**

Run: `cd src-tauri && cargo test deduce:: && cargo build`
Expected: all `deduce::tests` pass (incl. the new `detect_source` Slack test); crate builds warning-clean (the new consts + `compose_user_slack` are now used).

- [ ] **Step 7: Manual smoke of the live Slack call (paid; optional if Task 1 already covered it)**

If you changed `SLACK_ALLOWED_TOOLS`/`SLACK_MODEL` from Task 1's pinned values, re-run the Task 1 Step 2 command with the final values to confirm the wired path still resolves a message. Otherwise the Task 4 GUI acceptance covers it.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): MCP-enabled Slack branch + sourceResolved guardrail + deterministic source_url"
```

---

### Task 4: Docs + acceptance

Full headless verification, as-built/status updates, and manual GUI acceptance. No frontend code changes were needed (the source-neutral seam already handles Slack), so this task is docs + verification only.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`

- [ ] **Step 1: Full headless verification**

Run:
```bash
cd src-tauri && cargo test && cargo build && cd .. && npm test && npx tsc --noEmit && npm run build
```
Expected: all Rust + JS tests green; both builds succeed (frontend tests unchanged and still passing confirms the no-frontend-change claim). If anything fails, STOP and report BLOCKED — do not patch code in a docs task.

- [ ] **Step 2: Update as-built docs**

In `CLAUDE.md` under "As-built notes", record the Slack source type: `deduce_worktree` detects a Slack permalink (`*.slack.com/archives/…`, plain or `?thread_ts=` form) via the pure `detect_slack_ref`; when present it runs the `claude` call MCP-enabled (`--allowedTools <pinned>`, the shared `DEDUCE_SCHEMA_SOURCE` + a Slack system prompt, model `<pinned>`) so the agent fetches the message + its thread via the user's Slack MCP — no in-app Slack auth (the Rust `slack.rs` + Keychain-token provider is the deferred sub-project-4 swap point, the same place the future unread-messages tile's Web-API provider lands). A `sourceResolved=false` on a detected message returns an inline error (never fabricated params); Rust sets `source_url` to the pasted permalink deterministically; no id is pinned (Slack has no short id) so the branch/name are fully agent-proposed and `existingBranch=false`. The resolved Slack link is auto-added to the worktree's `links` on Create. The frontend is unchanged (reuses the source-neutral fields/banner/link-staging). Note the `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE` rename. Under "Status", mark the Slack source type complete — **all three source types done** — and point "Next" at sub-project 4 (auth manager + first read-only integration tile).

In `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`, under decomposition item 3, note all three source types (Linear, GitHub, Slack) are done; record the MCP-vs-API split for the future Slack tile (deduce uses the MCP; the unread tile will use the Slack Web API + Socket Mode + Keychain token).

- [ ] **Step 3: Manual GUI acceptance (ask the user to eyeball)**

Run: `npm run tauri dev` (blocking, opens the native window). Ask the user to confirm:
1. With a known repo added and the Slack MCP connected, paste a real permalink (e.g. `https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782139459441759`) → **deduce** → fields fill with a repo + descriptive branch, banner shows the link with "link will be added".
2. `do this in the web-app: <permalink>` → repo resolves to the web-app repo, branch is named from the message content.
3. **Create** → the worktree tile shows the Slack link.
4. A permalink with the Slack MCP disconnected → inline error ("couldn't resolve Slack message …"), form still usable manually.
5. A plain prompt, a Linear ref, and a GitHub URL still deduce exactly as before.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "docs: as-built notes + status for the Slack source type (source types complete)"
```

---

## Notes for the implementer

- **Task 1 is paid, human-run, and gates the code.** The agent's Bash-spawned `claude` is not logged into the MCPs, so the smoke must be run by the human. The `--allowedTools` string (a UUID server name), the model, whether `--permission-mode` is needed, and **whether the MCP resolves a bare permalink or needs channel+ts** are empirical — pin them before Task 3 and copy them into the "Verified CLI facts" block and the Task-3 consts. If channel+ts are needed, extend `compose_user_slack` to include them (parse `cid` + `thread_ts`/`p<ts>` from the permalink) — record that in Task 1 Step 4.
- **Plain / Linear / GitHub paths must stay byte-identical.** Only the new `Source::Slack` arm and the `DEDUCE_SCHEMA_TICKET`→`DEDUCE_SCHEMA_SOURCE` rename (value identical) touch shared code — verify nothing regresses there.
- **Never fabricate.** A detected message that returns `sourceResolved=false` is an error, not a silently-guessed worktree. The model is *forced* to answer the schema, so this flag is the only honest signal that the fetch happened — don't drop it.
- **No id pinning for Slack.** Unlike Linear (`eng-1234-…`) and GitHub (`pr-N`/`issue-N`), Slack has no meaningful short id, so `ensure_ref_prefix` is intentionally NOT called on this path. The auto-attached permalink preserves traceability.
- **No frontend changes.** Slack reuses `sourceUrl`/`sourceTitle`/`sourceResolved`, `existingBranch=false`, `prNumber=0`, `sourceLinkFrom`, the banner, and link-staging untouched — and therefore adds no new staged form state (it stays inside the set the pending clear-deduced-state-on-edit fix will cover).
- **No new deps, no new files, no IPC signature change.**
```
