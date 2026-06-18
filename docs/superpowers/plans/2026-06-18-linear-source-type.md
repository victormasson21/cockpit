# Linear Source Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Implementation is deferred** — this plan is written now and executed later.
> Task 1 is a paid manual smoke test that pins three CLI facts the code depends
> on; do it first when work resumes.

**Goal:** Let a Linear ticket ref (`ENG-1234` or a `linear.app` URL) in the new-worktree prompt be resolved — via Claude Code's Linear MCP — into ticket context that drives the deduction, with the ticket id guaranteed in the name/branch and the ticket link auto-added to the created worktree.

**Architecture:** Extend the existing `deduce_worktree` command. A pure Rust helper detects a Linear ref; when present, the `claude` CLI call is run MCP-enabled (extended schema + system prompt + `--allowedTools`) so the agent fetches the ticket itself. A `sourceResolved` guardrail turns an unresolved ticket into an inline error (never fabricated params), and a deterministic Rust helper guarantees the ticket id is in the name/branch. The frontend stages the resolved ticket URL into the worktree's `links` on Create. No new provider, no new dependencies, no IPC signature change.

**Tech Stack:** Tauri v2, Rust (`std::process::Command` + `wait-timeout`, `serde_json` — hand-rolled ref parsing, no `regex` crate), React 19 + TS, Zustand, Vitest.

## Global Constraints

- **Learning project:** one-line role comment at the top of every file; one-line intent comment atop each significant block. High-signal only — explain intent, not syntax.
- **Minimalism:** smallest thing that works; no new files beyond those listed; **no new dependencies** (Rust ref parsing is hand-rolled).
- **Dual-definition discipline:** persisted/IPC shapes exist as a Rust serde struct AND a mirrored TS type (camelCase via `#[serde(rename)]`).
- **Backward-compatible:** new `DeducedWorktree` fields use `#[serde(default)]` so the plain-prompt path's narrower JSON still deserializes. `cockpit.json` `version` stays `1`; `Worktree` model unchanged.
- **IPC unchanged:** `deduce_worktree(prompt: String, repo_paths: Vec<String>)` keeps its signature; the plain-prompt path stays byte-identical (same system prompt, same schema, haiku, no tools).
- **Never silent / never fabricate:** deduce only fills the form; only the user-clicked Create makes a worktree. A detected-but-unresolved ticket (`source_resolved == false`) returns an error and leaves manual entry working.
- **Reuse Claude Code auth/MCP:** the ticket fetch is delegated to the user's Linear MCP via the `claude` CLI; no API key, no in-app Linear auth this iteration.
- **Source-neutral naming:** the guardrail field is `source_resolved` (not `linear_resolved`) so GitHub/Slack iterations reuse it. Linear-specific names stay inside the `detect_linear_*` / ticket-prompt code.
- **Tests:** Rust `cd src-tauri && cargo test`; frontend `npm test` (Vitest). Headless build checks: `cargo build`, `npm run build`, `npx tsc --noEmit`. GUI the user eyeballs.

## Verified CLI facts (TO PIN in Task 1, then copy here)

These three values are unknown until Task 1's smoke test; record them here once pinned, then use them verbatim in Task 3:

- `LINEAR_ALLOWED_TOOLS` — the exact `--allowedTools` string enabling the Linear MCP non-interactively (e.g. `mcp__linear` or `mcp__linear__get_issue`): **<pin in Task 1>**
- whether a `--permission-mode` flag is also required: **<pin in Task 1>**
- `LINEAR_MODEL` — whether haiku suffices for MCP tool-use + structured output, or a stronger model is needed: **<pin in Task 1>**
- whether a user-scoped Linear MCP loads for `claude -p` run from `std::env::temp_dir()` (if not, the ticket call needs a cwd/config that has it): **<pin in Task 1>**

---

## File Structure

- `src-tauri/src/deduce.rs` (modify) — three new `DeducedWorktree` fields; pure helpers `detect_linear_ref`, `ensure_ref_prefix`, `compose_user_ticket` (+ private `is_ticket_id`, `leading_ticket_id`); ticket-path system-prompt + schema + tool/model consts; a `ClaudeCall` struct so `run_claude` is parameterized; the ref branch + guardrail + id-enforcement in `deduce_worktree`.
- `src/worktrees/api.ts` (modify) — optional `ticketUrl`/`ticketTitle`/`sourceResolved` on `DeducedWorktree`.
- `src/worktrees/model.ts` (modify) — pure `ticketLinkFrom(d) -> WorktreeLink | null`.
- `src/worktrees/model.test.ts` (create) — unit tests for `ticketLinkFrom`.
- `src/tiles/worktree/NewWorktreeForm.tsx` (modify) — stage the ticket link, banner note, thread `links` into `makeWorktree` on Create.
- `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (modify) — as-built notes + status.

---

### Task 1: Smoke-test the Linear-MCP `claude -p` call (manual, paid ~$0.08) + pin CLI facts

The ticket path depends on three empirically-unknown CLI behaviours (mirrors how the plain-prompt plan smoke-tested the JSON envelope). This task runs a real call and records the answers; no code ships here. **Do this first when implementation resumes.**

**Files:** none (updates the "Verified CLI facts" block of this plan).

- [ ] **Step 1: Find the Linear MCP server name**

Run: `claude mcp list`
Note the Linear server's name (the `mcp__<name>__…` prefix). If no Linear MCP is listed, connect one before continuing (this iteration assumes the user has it).

- [ ] **Step 2: Run an MCP-enabled headless call against a real ticket**

From the repo root, substituting a real ticket id you can access and the server name from Step 1 (try `--allowedTools "mcp__<name>"` first; if the call doesn't fetch, retry with the specific tool `"mcp__<name>__get_issue"`, then with `--permission-mode acceptEdits` added):

```bash
SCHEMA='{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"},"ticketUrl":{"type":"string"},"ticketTitle":{"type":"string"},"sourceResolved":{"type":"boolean"}},"required":["repoPath","name","branch","base","startCmd","address","reason","ticketUrl","ticketTitle","sourceResolved"],"additionalProperties":false}'
(cd "$(mktemp -d)" && claude -p 'A Linear ticket (ENG-1234) was referenced; fetch it via the Linear MCP and return its title/description-derived name + branch (include ENG-1234 in both), set ticketUrl/ticketTitle from the fetched ticket and sourceResolved=true. Known repos (pick repoPath from these only): [{"path":"/Users/victormasson/Repos/perso/cockpit","basename":"cockpit"}]' \
  --system-prompt 'You deduce git worktree parameters and may fetch a referenced Linear ticket via the Linear MCP. Output only the structured object.' \
  --output-format json --json-schema "$SCHEMA" --model claude-haiku-4-5 \
  --allowedTools "mcp__linear" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("is_error:", d.get("is_error")); print(json.dumps(d.get("structured_output"), indent=2))')
```

Expected: `is_error: False`, a `structured_output` whose `sourceResolved` is `true`, with a real `ticketUrl`/`ticketTitle` from the ticket and `ENG-1234` present in `name`+`branch`. Running from `$(mktemp -d)` checks the temp-cwd MCP-loading question.

- [ ] **Step 3: If haiku fails to use the tool reliably, retry with a stronger model**

Re-run Step 2 with `--model claude-sonnet-4-6`. Decide the smallest model that reliably fetches the ticket.

- [ ] **Step 4: Record the pinned facts**

Edit the "Verified CLI facts" block at the top of this plan with the working `--allowedTools` string, whether `--permission-mode` was needed, the chosen model, and whether the temp-cwd worked (and if not, the cwd/config workaround). Commit:

```bash
git add docs/superpowers/plans/2026-06-18-linear-source-type.md
git commit -m "docs(plan): pin Linear-MCP CLI facts from smoke test"
```

---

### Task 2: Pure Rust helpers + `DeducedWorktree` fields (no CLI)

All the risky, deterministic logic, fully unit-tested without invoking the CLI: the new struct fields (with defaults so the plain path still parses), ref detection, id enforcement, and the ticket user-prompt composer.

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Produces (Rust): `DeducedWorktree` gains `ticket_url: String` (`ticketUrl`, default), `ticket_title: String` (`ticketTitle`, default), `source_resolved: bool` (`sourceResolved`, default).
- Produces (Rust, pure): `detect_linear_ref(&str) -> Option<String>`, `ensure_ref_prefix(value: &str, id: &str) -> String`, `compose_user_ticket(prompt: &str, id: &str, digests: &[serde_json::Value]) -> String`.

- [ ] **Step 1: Add the three fields to `DeducedWorktree`**

In `src-tauri/src/deduce.rs`, extend the struct (after `reason`):

```rust
    pub reason: String,
    // Source-context fields: populated only on the ticket path; default so the plain path's JSON still deserializes.
    #[serde(rename = "ticketUrl", default)]
    pub ticket_url: String,
    #[serde(rename = "ticketTitle", default)]
    pub ticket_title: String,
    #[serde(rename = "sourceResolved", default)]
    pub source_resolved: bool,
```

- [ ] **Step 2: Fix the existing struct-literal test**

The `validate_repo_enforces_membership` test builds a `DeducedWorktree` literal that now misses three fields. In that test, add them to the literal so it compiles:

```rust
        let d = DeducedWorktree {
            repo_path: "/a".into(), name: "n".into(), branch: "b".into(), base: "main".into(),
            start_cmd: "c".into(), address: "x".into(), reason: "r".into(),
            ticket_url: "".into(), ticket_title: "".into(), source_resolved: false,
        };
```

- [ ] **Step 3: Write the failing tests for the new pure helpers**

In `src-tauri/src/deduce.rs` `tests` module, add:

```rust
    #[test]
    fn detect_linear_ref_matches_id_url_and_rejects_noise() {
        assert_eq!(detect_linear_ref("fix ENG-1234 please"), Some("ENG-1234".into())); // bare id in text
        assert_eq!(detect_linear_ref("ENG-1234, backend only"), Some("ENG-1234".into())); // mixed input
        assert_eq!(detect_linear_ref("see https://linear.app/acme/issue/ABC-42-fix-login now"),
                   Some("ABC-42".into())); // url form, id parsed out of the slug
        assert_eq!(detect_linear_ref("eng-1234"), None); // lowercase is not canonical
        assert_eq!(detect_linear_ref("fix the login bug"), None); // plain prompt
        assert_eq!(detect_linear_ref("v2-3 release"), None); // lowercase team -> not a ref
    }

    #[test]
    fn ensure_ref_prefix_adds_id_only_when_absent() {
        assert_eq!(ensure_ref_prefix("fix-login", "eng-1234"), "eng-1234-fix-login"); // absent -> prepended
        assert_eq!(ensure_ref_prefix("eng-1234-fix-login", "eng-1234"), "eng-1234-fix-login"); // present -> unchanged
        assert_eq!(ensure_ref_prefix("ENG-1234 fix login", "eng-1234"), "ENG-1234 fix login"); // case-insensitive match
    }

    #[test]
    fn compose_user_ticket_names_id_prompt_and_digests() {
        let digests = vec![serde_json::json!({"basename": "cockpit"})];
        let out = compose_user_ticket("do the thing", "ENG-1234", &digests);
        assert!(out.contains("do the thing"));
        assert!(out.contains("ENG-1234"));
        assert!(out.contains("cockpit"));
    }

    #[test]
    fn parse_envelope_reads_ticket_fields_and_defaults_them() {
        let with = r#"{"is_error":false,"result":"","structured_output":{"repoPath":"/r","name":"n","branch":"b","base":"main","startCmd":"c","address":"a","reason":"r","ticketUrl":"https://linear.app/x","ticketTitle":"Fix login","sourceResolved":true}}"#;
        let d = parse_envelope(with).unwrap();
        assert_eq!(d.ticket_url, "https://linear.app/x");
        assert!(d.source_resolved);
        // Plain-path envelope (no ticket fields) still parses, with defaults.
        let without = r#"{"is_error":false,"result":"","structured_output":{"repoPath":"/r","name":"n","branch":"b","base":"main","startCmd":"c","address":"a","reason":"r"}}"#;
        let d2 = parse_envelope(without).unwrap();
        assert_eq!(d2.ticket_url, "");
        assert!(!d2.source_resolved);
    }
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test deduce::`
Expected: FAIL to compile — `detect_linear_ref`, `ensure_ref_prefix`, `compose_user_ticket` not defined.

- [ ] **Step 5: Implement the pure helpers**

In `src-tauri/src/deduce.rs`, add near the other pure helpers (e.g. after `compose_user`):

```rust
// True if token is exactly a canonical Linear id: [A-Z][A-Z0-9]*-[0-9]+ (whole token, no trailing slug).
fn is_ticket_id(token: &str) -> bool {
    match token.split_once('-') {
        Some((team, num)) => {
            let mut tc = team.chars();
            tc.next().is_some_and(|c| c.is_ascii_uppercase())
                && team.chars().skip(1).all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && !num.is_empty()
                && num.chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

// Pull a leading id off the front of a URL slug segment (e.g. "ABC-42-fix-login" -> "ABC-42").
fn leading_ticket_id(s: &str) -> Option<String> {
    let dash = s.find('-')?;
    let team = &s[..dash];
    let mut tc = team.chars();
    if !tc.next()?.is_ascii_uppercase() || !team.chars().skip(1).all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return None;
    }
    let num: String = s[dash + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
    if num.is_empty() { None } else { Some(format!("{team}-{num}")) }
}

// Detect a Linear ticket ref in the prompt: a linear.app issue URL first, else a bare canonical id token. None for plain prompts.
pub fn detect_linear_ref(prompt: &str) -> Option<String> {
    // URL form: take the segment after "/issue/" and parse the id off its front.
    if let Some(base) = prompt.find("linear.app/") {
        if let Some(rel) = prompt[base..].find("/issue/") {
            let after = &prompt[base + rel + "/issue/".len()..];
            if let Some(id) = leading_ticket_id(after) {
                return Some(id);
            }
        }
    }
    // Bare id: scan tokens delimited by anything that isn't alphanumeric or '-'.
    prompt
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .find(|t| is_ticket_id(t))
        .map(|t| t.to_string())
}

// Guarantee the ticket id is present: unchanged if value already contains it (case-insensitive), else "{id}-{value}".
pub fn ensure_ref_prefix(value: &str, id: &str) -> String {
    if value.to_lowercase().contains(&id.to_lowercase()) {
        value.to_string()
    } else {
        format!("{id}-{value}")
    }
}

// Compose the ticket-path user prompt: the plain composition plus an instruction to fetch the ticket and include its id.
pub fn compose_user_ticket(prompt: &str, id: &str, digests: &[serde_json::Value]) -> String {
    format!(
        "{}\n\nA Linear ticket ({id}) was referenced; fetch it via the Linear MCP and use its title/description \
to choose the name and branch (include {id} in both), and set ticketUrl/ticketTitle/sourceResolved accordingly.",
        compose_user(prompt, digests)
    )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test deduce::`
Expected: PASS — all existing `deduce::tests` plus the four new ones.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): ticket-context fields + pure ref detection/id-prefix/ticket-prompt helpers"
```

---

### Task 3: Live ticket branch in `deduce_worktree` (MCP-enabled CLI call + guardrail)

Wires the pure helpers into the command: parameterize the CLI call, branch on a detected ref, run the MCP-enabled call with the Task-1-pinned tool/model, apply the `source_resolved` guardrail and the id enforcement. Uses the values pinned in "Verified CLI facts".

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Consumes: Task 2 helpers; existing `compose_user`, `parse_envelope`, `validate_repo`, `default_branch`, `read_repo_digest`.
- Produces (IPC, unchanged signature): `deduce_worktree(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String>` — now ticket-aware.

- [ ] **Step 1: Add the ticket-path consts**

In `src-tauri/src/deduce.rs`, next to `SYSTEM_PROMPT` / `DEDUCE_SCHEMA`, add (set `LINEAR_ALLOWED_TOOLS` / `LINEAR_MODEL` to the values pinned in Task 1 — the defaults below are the starting guesses):

```rust
// Ticket-path system prompt: same deduction, but the agent may fetch the referenced Linear ticket via MCP and must report whether it did.
const SYSTEM_PROMPT_TICKET: &str = "You deduce git worktree parameters from a task prompt that references a Linear ticket. \
Fetch the referenced ticket via the Linear MCP and use its title/description to choose a short name and a new branch \
(include the ticket id in BOTH). Choose repoPath from the provided repo digests ONLY (copy one exactly). Also propose the \
base branch and the dev-server start command/address from that repo's scripts/README, with a one-line reason. \
Set ticketUrl and ticketTitle from the fetched ticket and sourceResolved=true. If you CANNOT fetch the ticket, set \
sourceResolved=false and leave ticketUrl/ticketTitle empty. Output only the structured object.";

// Ticket-path schema: the plain fields plus the source-context fields, all required.
const DEDUCE_SCHEMA_TICKET: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"},"ticketUrl":{"type":"string"},"ticketTitle":{"type":"string"},"sourceResolved":{"type":"boolean"}},"required":["repoPath","name","branch","base","startCmd","address","reason","ticketUrl","ticketTitle","sourceResolved"],"additionalProperties":false}"#;

// Pinned in Task 1's smoke test (Verified CLI facts). Starting guesses below.
const LINEAR_ALLOWED_TOOLS: &str = "mcp__linear";
const LINEAR_MODEL: &str = "claude-haiku-4-5";
```

- [ ] **Step 2: Parameterize `run_claude` via a `ClaudeCall` struct**

In `src-tauri/src/deduce.rs`, replace the `run_claude` function with a parameterized version (the plain path passes `allowed_tools: None`, keeping its invocation identical to today):

```rust
// One headless claude invocation's knobs; lets the plain and ticket paths share the spawn/timeout logic.
struct ClaudeCall<'a> {
    user_prompt: &'a str,
    system_prompt: &'a str,
    schema: &'a str,
    model: &'a str,
    allowed_tools: Option<&'a str>, // Some(..) only on the ticket path, to enable the Linear MCP
}

// Shell out to the claude CLI in headless JSON mode (reuses Claude Code auth), with a hard timeout.
fn run_claude(call: ClaudeCall) -> Result<String, String> {
    let mut args: Vec<&str> = vec![
        "-p", call.user_prompt,
        "--system-prompt", call.system_prompt,
        "--output-format", "json",
        "--json-schema", call.schema,
        "--model", call.model,
    ];
    // Ticket path only: allow the Linear MCP tools so the agent can fetch the ticket non-interactively.
    if let Some(tools) = call.allowed_tools {
        args.push("--allowedTools");
        args.push(tools);
    }

    let mut child = Command::new("claude")
        .args(&args)
        .current_dir(std::env::temp_dir()) // neutral cwd: don't auto-load the project's CLAUDE.md
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("claude CLI not found: {e}"))?;

    match child.wait_timeout(DEDUCE_TIMEOUT).map_err(|e| e.to_string())? {
        None => {
            let _ = child.kill();
            Err("deduction timed out".into())
        }
        Some(status) => {
            // Output is a few KB (well under the pipe buffer), so reading after wait can't deadlock.
            let mut out = String::new();
            if let Some(mut so) = child.stdout.take() {
                let _ = so.read_to_string(&mut out);
            }
            if !status.success() && out.trim().is_empty() {
                let mut err = String::new();
                if let Some(mut se) = child.stderr.take() {
                    let _ = se.read_to_string(&mut err);
                }
                return Err(format!("claude exited with an error: {}", err.trim()));
            }
            Ok(out)
        }
    }
}
```

- [ ] **Step 3: Branch on the ref in `deduce_worktree`**

In `src-tauri/src/deduce.rs`, replace the body of `deduce_worktree` with:

```rust
#[tauri::command]
pub fn deduce_worktree(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String> {
    if repo_paths.is_empty() {
        return Err("no known repos configured".into());
    }
    let digests: Vec<serde_json::Value> = repo_paths.iter().map(|p| read_repo_digest(p)).collect();
    let detected = detect_linear_ref(&prompt);

    // Ticket path: MCP-enabled call so the agent fetches the ticket. Plain path: byte-identical to before (no tools).
    let stdout = match &detected {
        Some(id) => run_claude(ClaudeCall {
            user_prompt: &compose_user_ticket(&prompt, id, &digests),
            system_prompt: SYSTEM_PROMPT_TICKET,
            schema: DEDUCE_SCHEMA_TICKET,
            model: LINEAR_MODEL,
            allowed_tools: Some(LINEAR_ALLOWED_TOOLS),
        })?,
        None => run_claude(ClaudeCall {
            user_prompt: &compose_user(&prompt, &digests),
            system_prompt: SYSTEM_PROMPT,
            schema: DEDUCE_SCHEMA,
            model: "claude-haiku-4-5",
            allowed_tools: None,
        })?,
    };

    let mut deduced = validate_repo(parse_envelope(&stdout)?, &repo_paths)?;
    // Base branch is deterministic from git; don't trust the agent's main/master guess.
    if let Some(b) = default_branch(&deduced.repo_path) {
        deduced.base = b;
    }
    // Ticket guardrails: never fabricate on an unresolved ticket; guarantee the id is in name + branch.
    if let Some(id) = &detected {
        if !deduced.source_resolved {
            return Err(format!("couldn't resolve Linear ticket {id} (is the Linear MCP connected?)"));
        }
        deduced.branch = ensure_ref_prefix(&deduced.branch, &id.to_lowercase());
        deduced.name = ensure_ref_prefix(&deduced.name, id);
    }
    Ok(deduced)
}
```

- [ ] **Step 4: Build + run tests**

Run: `cd src-tauri && cargo test deduce:: && cargo build`
Expected: all `deduce::tests` still pass; crate builds warning-clean (the plain path is unchanged; `ClaudeCall`/ticket consts are now used).

- [ ] **Step 5: Manual smoke of the live ticket call (paid; optional if Task 1 already covered it)**

If you changed `LINEAR_ALLOWED_TOOLS`/`LINEAR_MODEL` from Task 1's pinned values, re-run the Task 1 Step 2 command with the final values to confirm the wired path still resolves a ticket. Otherwise the Task 6 GUI acceptance covers it.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): MCP-enabled ticket branch + sourceResolved guardrail + id enforcement"
```

---

### Task 4: Frontend types + pure `ticketLinkFrom` helper

Mirror the new fields in TS and add the one pure piece of frontend logic — building the worktree link from a deduction — so it's unit-testable without a DOM.

**Files:**
- Modify: `src/worktrees/api.ts`
- Modify: `src/worktrees/model.ts`
- Create: `src/worktrees/model.test.ts`

**Interfaces:**
- Produces (TS): `DeducedWorktree` gains optional `ticketUrl?`, `ticketTitle?`, `sourceResolved?`.
- Produces (TS): `ticketLinkFrom(d: DeducedWorktree): WorktreeLink | null`.

- [ ] **Step 1: Add the optional fields to the TS type**

In `src/worktrees/api.ts`, extend `DeducedWorktree` (the new fields are optional because the plain path omits them):

```ts
export interface DeducedWorktree {
  repoPath: string;
  name: string;
  branch: string;
  base: string;
  startCmd: string;
  address: string;
  reason: string;
  ticketUrl?: string;
  ticketTitle?: string;
  sourceResolved?: boolean;
}
```

- [ ] **Step 2: Write the failing test for `ticketLinkFrom`**

Create `src/worktrees/model.test.ts`:

```ts
// model.test.ts — pure worktree helpers (ticket link construction from a deduction).
import { describe, it, expect } from "vitest";
import { ticketLinkFrom } from "./model";
import type { DeducedWorktree } from "./api";

const base: DeducedWorktree = {
  repoPath: "/r", name: "n", branch: "b", base: "main", startCmd: "c", address: "a", reason: "r",
};

describe("ticketLinkFrom", () => {
  it("returns null when there is no ticket url", () => {
    expect(ticketLinkFrom(base)).toBeNull();
  });
  it("uses the ticket title as the link label", () => {
    expect(ticketLinkFrom({ ...base, ticketUrl: "https://linear.app/x", ticketTitle: "Fix login" }))
      .toEqual({ label: "Fix login", url: "https://linear.app/x" });
  });
  it("falls back to the url when there is no title", () => {
    expect(ticketLinkFrom({ ...base, ticketUrl: "https://linear.app/x" }))
      .toEqual({ label: "https://linear.app/x", url: "https://linear.app/x" });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- model.test`
Expected: FAIL — `ticketLinkFrom` not exported from `./model`.

- [ ] **Step 4: Implement `ticketLinkFrom`**

In `src/worktrees/model.ts`, add the import and the helper:

```ts
import type { DeducedWorktree } from "./api";
```

```ts
// Build the worktree link to attach from a deduction, or null when no ticket was resolved.
export function ticketLinkFrom(d: DeducedWorktree): WorktreeLink | null {
  if (!d.ticketUrl) return null;
  return { label: d.ticketTitle || d.ticketUrl, url: d.ticketUrl };
}
```

- [ ] **Step 5: Run tests + type-check**

Run: `npm test -- model.test && npx tsc --noEmit`
Expected: PASS; types clean.

- [ ] **Step 6: Commit**

```bash
git add src/worktrees/api.ts src/worktrees/model.ts src/worktrees/model.test.ts
git commit -m "feat(worktree): DeducedWorktree ticket fields + pure ticketLinkFrom helper"
```

---

### Task 5: Wire the ticket link + banner into `NewWorktreeForm`

The panel half: after deduce, stage the resolved ticket link, surface it in the banner, and attach it to the worktree on Create. The unresolved-ticket error already flows through the existing inline `deduceError` display (Rust returns an `Err`), so no new error UI is needed.

**Files:**
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx`

**Interfaces:**
- Consumes: `ticketLinkFrom` (Task 4); existing field setters and `makeWorktree`.

- [ ] **Step 1: Import the helper + the link type**

In `src/tiles/worktree/NewWorktreeForm.tsx`, update imports:

```tsx
import { makeWorktree, ticketLinkFrom } from "../../worktrees/model";
import type { WorktreeLink } from "../../settings/types";
```

- [ ] **Step 2: Add ticket-link state**

Alongside the existing `useState` hooks, add:

```tsx
  const [ticketLink, setTicketLink] = useState<WorktreeLink | null>(null);
```

- [ ] **Step 3: Stage the link + banner in `runDeduce`**

In `runDeduce`, after the existing `setStartCmd`/`setAddress`/`setBanner` block, stage the ticket link and include it in the banner. Replace the `setBanner(...)` line with:

```tsx
      const tl = ticketLinkFrom(d);
      setTicketLink(tl);
      setBanner({ prompt, repoPath: d.repoPath, reason: d.reason, hostFromSaved: !!(saved?.startCmd && saved?.address), ticket: tl });
```

And widen the `banner` state type to carry the ticket:

```tsx
  const [banner, setBanner] = useState<{ prompt: string; repoPath: string; reason: string; hostFromSaved: boolean; ticket: WorktreeLink | null } | null>(null);
```

- [ ] **Step 4: Show the ticket in the banner JSX**

In the banner block, after the `hostFromSaved` line, add:

```tsx
          {banner.ticket && <><br />🎫 {banner.ticket.label} — link will be added.</>}
```

- [ ] **Step 5: Attach the link on Create**

In `submit`, pass the staged link into `makeWorktree`:

```tsx
      addWorktree(makeWorktree({
        id, name, repoPath, branch, worktreePath,
        host: { startCmd, address },
        links: ticketLink ? [ticketLink] : [],
      }));
```

- [ ] **Step 6: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "feat(tile): stage deduced Linear ticket link + banner, attach on create"
```

---

### Task 6: Docs + acceptance

Full headless verification, as-built/status updates, and manual GUI acceptance.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`

- [ ] **Step 1: Full headless verification**

Run:
```bash
cd src-tauri && cargo test && cargo build && cd .. && npm test && npx tsc --noEmit && npm run build
```
Expected: all Rust + JS tests green; both builds succeed. If anything fails, STOP and report BLOCKED — do not patch code in a docs task.

- [ ] **Step 2: Update as-built docs**

In `CLAUDE.md` under "As-built notes", record the Linear source type: `deduce_worktree` detects a Linear ref (`ENG-1234` id or `linear.app` issue URL) in the prompt via the pure `detect_linear_ref`; when present it runs the `claude` call MCP-enabled (`--allowedTools <pinned>`, extended schema + system prompt, model `<pinned>`) so the agent fetches the ticket via the user's Linear MCP — no in-app Linear auth (the Rust `linear.rs` + Keychain-token provider is the deferred sub-project-4 swap point). A `sourceResolved=false` on a detected ticket returns an inline error (never fabricated params); `ensure_ref_prefix` guarantees the ticket id is in the name + branch; the resolved ticket link is auto-added to the worktree's `links` on Create. Under "Status", mark the Linear source type complete and point "Next" at the GitHub then Slack source types (same MCP-delegation shape).

In `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`, under decomposition item 3, note the Linear source type is done and GitHub/Slack are the next source-type iterations.

- [ ] **Step 3: Manual GUI acceptance (ask the user to eyeball)**

Run: `npm run tauri dev` (blocking, opens the native window). Ask the user to confirm:
1. With a known repo added and the Linear MCP connected, type a real ticket id (e.g. `ENG-1234`) → **deduce** → fields fill, name+branch contain the id, and the banner shows the ticket title with "link will be added".
2. **Create** → the worktree tile shows the Linear ticket link.
3. A plain prompt (no ref) still deduces exactly as before (no ticket banner line).
4. A ticket ref with the Linear MCP disconnected → inline error ("couldn't resolve Linear ticket …"), form still usable manually.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "docs: as-built notes + status for the Linear source type"
```

---

## Notes for the implementer

- **Task 1 is paid and gates the code.** The `--allowedTools` string, the model, and whether `--permission-mode` / a non-temp cwd are needed are empirical — pin them before Task 3 and copy them into the "Verified CLI facts" block and the Task-3 consts.
- **Plain path must stay byte-identical.** Passing `allowed_tools: None` with the original system prompt/schema/haiku keeps the no-ticket deduction exactly as it shipped — verify nothing regresses there.
- **Never fabricate.** A detected ticket that returns `sourceResolved=false` is an error, not a silently-guessed worktree. The model is *forced* to answer the schema, so this flag is the only honest signal that the fetch happened — don't drop it.
- **Source-neutral seam.** `source_resolved` and the staged-link/banner code are deliberately not Linear-specific so the GitHub/Slack iterations reuse them — keep Linear-specific strings inside `detect_linear_ref` and the ticket prompt only.
- **No new deps, no new files beyond `model.test.ts`, no IPC signature change.**
