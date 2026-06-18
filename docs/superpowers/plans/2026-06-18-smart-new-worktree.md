# Smart New-Worktree (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a single plain-prompt input into pre-filled worktree parameters via a Claude deduction agent, following **deduce → preview/confirm → create, never silent**, plugging into the existing collapsible new-worktree form.

**Architecture:** Provider + panel. A new Rust **`deduce` provider** reads a digest (package.json + README snippet) of each repo in a configured `knownRepos` list, shells out to the `claude` CLI in headless JSON mode (`-p --output-format json --json-schema`, reusing Claude Code auth — no API key), validates the returned params, and hands them back. The existing React `NewWorktreeForm` is the panel: a prompt input calls the provider, pre-fills the form's editable fields, and shows a "deduced" banner; the unchanged `create_worktree` does the actual git work.

**Tech Stack:** Tauri v2, Rust (`std::process::Command` + `wait-timeout` crate, `serde_json`), React 19 + TS, Zustand. The `claude` CLI binary (already installed; used by the worktree's claude terminal).

## Global Constraints

- **Learning project:** one-line role comment at the top of every file; one-line intent comment atop each significant block. High-signal only — explain intent, not syntax.
- **Minimalism:** smallest thing that works; no styling gold-plating; fewer files/deps/abstractions until one is needed.
- **Dual-definition discipline:** every persisted shape exists as a Rust serde struct AND a mirrored TS type (camelCase via `#[serde(rename)]`), exactly like SP1/SP2.
- **Backward-compatible config:** new `cockpit.json` fields use `#[serde(default)]` so existing files without them still load. `version` stays `1`.
- **IPC untouched:** `load_settings` / `save_settings` / `create_worktree` and the pty commands keep working; the new `deduce_worktree` command is added alongside.
- **Tauri arg casing:** JS passes camelCase params (`repoPaths`); Rust receives snake_case (`repo_paths`) — Tauri converts automatically.
- **Never silent:** nothing is created without the user confirming; a failed deduction surfaces inline and always leaves manual entry working.
- **Reuse Claude Code auth:** invoke the `claude` CLI without `--bare` (so OAuth/keychain auth is used); never require an API key.
- **Tests:** Rust `cd src-tauri && cargo test`; frontend `npm test` (Vitest). Headless build checks: `cargo build`, `npm run build`, `npx tsc --noEmit`. The GUI window the user eyeballs.

## Verified CLI facts (smoke-tested 2026-06-18)

- `--json-schema` takes the schema as an **inline JSON string**, not a path.
- With `--output-format json --json-schema <schema>`, the result is a single JSON envelope; the structured object is under top-level key **`structured_output`** (the `result` field is an empty string). Envelope also carries `is_error` (bool) and `subtype`.
- A custom `--system-prompt` is honoured and the model still fills `structured_output`.
- Latency is **~15–43s** per call, cost **~$0.08** (the CLI loads its full context). Use a **120s timeout** and a visible loading state.
- Exact verified command shape (used in Task 3):
  ```
  claude -p "<user prompt>" --system-prompt "<system>" --output-format json --json-schema '<inline schema>' --model claude-haiku-4-5
  ```
  run from a neutral cwd (`std::env::temp_dir()`) so the project's own `CLAUDE.md` is not auto-loaded.

---

## File Structure

- `src-tauri/src/settings.rs` (modify) — add `known_repos` field to `CockpitConfig` (+ default + backward-compat test).
- `src-tauri/src/deduce.rs` (create) — the deduce provider: `DeducedWorktree` struct, pure helpers (digest extraction, prompt composition, envelope parse, repo validation), the live `deduce_worktree` command, unit tests for the pure helpers.
- `src-tauri/src/lib.rs` (modify) — declare `mod deduce;` + register `deduce::deduce_worktree`.
- `src-tauri/Cargo.toml` (modify) — add `wait-timeout`.
- `src/settings/types.ts` (modify) — add `knownRepos: string[]` to `CockpitConfig`.
- `src/settings/store.ts` (modify) — `knownRepos: []` default + `addKnownRepo` / `removeKnownRepo` actions.
- `src/worktrees/api.ts` (modify) — `DeducedWorktree` type + `deduceWorktree` wrapper.
- `src/tiles/worktree/KnownReposEditor.tsx` (create) — tiny add/remove list bound to `knownRepos`.
- `src/tiles/worktree/NewWorktreeForm.tsx` (modify) — mount the editor; add the prompt input + Deduce button + pre-fill + banner.
- `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (modify) — as-built notes + status.

---

### Task 1: Data model — `knownRepos` config field

Adds the candidate-repos list to persisted config (backward-compatible) plus the store actions the UI will use. Mirrors SP2's worktree-model task.

**Files:**
- Modify: `src-tauri/src/settings.rs` (field + default + test)
- Modify: `src/settings/types.ts` (mirrored field)
- Modify: `src/settings/store.ts` (default + actions)

**Interfaces:**
- Produces (Rust): `CockpitConfig.known_repos: Vec<String>` (serde `knownRepos`, `#[serde(default)]`).
- Produces (TS): `CockpitConfig.knownRepos: string[]`.
- Produces (store actions): `addKnownRepo(path: string)`, `removeKnownRepo(path: string)`.

- [ ] **Step 1: Write the failing Rust backward-compat test**

In `src-tauri/src/settings.rs`, add to the `tests` module:

```rust
#[test]
fn cockpit_without_known_repos_field_still_loads() {
    let json = r#"{"version":1,"tiles":[],"worktrees":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert!(cfg.known_repos.is_empty());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test cockpit_without_known_repos`
Expected: FAIL to compile — `CockpitConfig` has no `known_repos` field yet.

- [ ] **Step 3: Add the Rust field + default**

In `src-tauri/src/settings.rs`, add the field to `CockpitConfig` (after `worktrees`):

```rust
pub struct CockpitConfig {
    pub version: u32,
    pub tiles: Vec<TileInstance>,
    #[serde(default)]
    pub worktrees: Vec<Worktree>,
    #[serde(default, rename = "knownRepos")]
    pub known_repos: Vec<String>,
    pub preferences: Preferences,
}
```

In `impl Default for CockpitConfig`, add `known_repos: vec![],` after the `worktrees: vec![],` line.

- [ ] **Step 4: Run Rust tests to verify pass**

Run: `cd src-tauri && cargo test settings::`
Expected: PASS — the new test plus the existing default/round-trip tests stay green (round-trip now includes an empty `knownRepos`).

- [ ] **Step 5: Mirror the TS type**

In `src/settings/types.ts`, add the field to `CockpitConfig`:

```ts
export interface CockpitConfig {
  version: number;
  tiles: TileInstance[];
  worktrees: Worktree[];
  knownRepos: string[];
  preferences: Preferences;
}
```

- [ ] **Step 6: Add the store default + actions**

In `src/settings/store.ts`:

Update the initial `cockpit` default (the `create(...)` default object) to include `knownRepos: []`:

```ts
  cockpit: { version: 1, tiles: [], worktrees: [], knownRepos: [], preferences: { theme: "system", defaultView: "main" } },
```

Extend the `SettingsState` interface with:

```ts
  addKnownRepo: (path: string) => void;
  removeKnownRepo: (path: string) => void;
```

Add the implementations inside `create(...)` (next to the worktree actions), using functional updaters so they compose with concurrent writes:

```ts
  // Known repos the deduce agent may pick from; add is idempotent (no duplicate paths).
  addKnownRepo: (path) =>
    get().setCockpit((c) => (c.knownRepos.includes(path) ? c : { ...c, knownRepos: [...c.knownRepos, path] })),
  removeKnownRepo: (path) =>
    get().setCockpit((c) => ({ ...c, knownRepos: c.knownRepos.filter((p) => p !== path) })),
```

- [ ] **Step 7: Type-check + test**

Run: `npx tsc --noEmit && npm test && cd src-tauri && cargo test settings::`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/settings.rs src/settings/types.ts src/settings/store.ts
git commit -m "feat(model): knownRepos config field (Rust+TS) + store actions"
```

---

### Task 2: Rust deduce provider — pure helpers + `DeducedWorktree`

The risky logic, fully unit-tested without invoking the CLI: the deduced-params struct, repo-digest extraction, prompt composition, envelope parsing, and repo validation. The live shell-out is added in Task 3.

**Files:**
- Create: `src-tauri/src/deduce.rs` (struct + pure helpers + tests only)

**Interfaces:**
- Produces (Rust): `pub struct DeducedWorktree { repo_path, name, branch, base, start_cmd, address, reason }` (serde: `repoPath`, `startCmd`).
- Produces (Rust, pure): `package_fields(&str) -> (String, String, serde_json::Value)`, `truncate(&str, usize) -> String`, `compose_user(prompt: &str, digests: &[serde_json::Value]) -> String`, `parse_envelope(&str) -> Result<DeducedWorktree, String>`, `validate_repo(DeducedWorktree, &[String]) -> Result<DeducedWorktree, String>`.

- [ ] **Step 1: Write the file with the struct, pure helpers, and failing tests**

Create `src-tauri/src/deduce.rs`:

```rust
//! deduce.rs — deduction provider: builds repo digests, shells out to the claude CLI (headless JSON), returns validated worktree params.
use serde::{Deserialize, Serialize};

// The deduced worktree parameters the agent returns; mirrors the TS DeducedWorktree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeducedWorktree {
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    pub name: String,
    pub branch: String,
    pub base: String,
    #[serde(rename = "startCmd")]
    pub start_cmd: String,
    pub address: String,
    pub reason: String,
}

// Char-safe truncation so a long README snippet stays small without splitting a multibyte char.
pub fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

// Extract (name, description, scripts) from a package.json string, defaulting missing/invalid pieces.
pub fn package_fields(pkg_json: &str) -> (String, String, serde_json::Value) {
    let v: serde_json::Value = serde_json::from_str(pkg_json).unwrap_or(serde_json::Value::Null);
    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let description = v.get("description").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let scripts = v.get("scripts").cloned().unwrap_or_else(|| serde_json::json!({}));
    (name, description, scripts)
}

// Compose the user-prompt text: the task prompt plus the per-repo digests the agent picks from.
pub fn compose_user(prompt: &str, digests: &[serde_json::Value]) -> String {
    format!(
        "Task prompt: {prompt}\n\nKnown repos (digests, pick repoPath from these only):\n{}",
        serde_json::to_string_pretty(digests).unwrap_or_else(|_| "[]".into())
    )
}

// Parse the claude CLI JSON envelope: reject errors / empty output, then deserialize structured_output.
pub fn parse_envelope(stdout: &str) -> Result<DeducedWorktree, String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("couldn't parse deduction output: {e}"))?;
    if v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(true) {
        let msg = v.get("result").and_then(|r| r.as_str()).filter(|s| !s.is_empty()).unwrap_or("unknown error");
        return Err(format!("deduction failed: {msg}"));
    }
    let so = v.get("structured_output").cloned().unwrap_or(serde_json::Value::Null);
    if so.is_null() {
        return Err("deduction returned no structured output".into());
    }
    serde_json::from_value::<DeducedWorktree>(so)
        .map_err(|e| format!("deduction output didn't match schema: {e}"))
}

// Guard against the model inventing a repo: repo_path must be one of the provided paths (spec §B.4: never silent).
pub fn validate_repo(d: DeducedWorktree, repo_paths: &[String]) -> Result<DeducedWorktree, String> {
    if repo_paths.iter().any(|p| p == &d.repo_path) {
        Ok(d)
    } else {
        Err(format!("agent chose a repo not in the known list: {}", d.repo_path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_is_char_safe_and_bounded() {
        assert_eq!(truncate("hello world", 5), "hello");
        assert_eq!(truncate("héllo", 2), "hé"); // does not split the multibyte char
        assert_eq!(truncate("hi", 99), "hi");
    }

    #[test]
    fn package_fields_extracts_and_defaults() {
        let (n, d, s) = package_fields(r#"{"name":"elder-api","description":"API","scripts":{"dev":"vite"}}"#);
        assert_eq!(n, "elder-api");
        assert_eq!(d, "API");
        assert_eq!(s["dev"], "vite");
        // Missing/invalid input degrades to empty defaults rather than panicking.
        let (n2, d2, s2) = package_fields("not json");
        assert_eq!(n2, "");
        assert_eq!(d2, "");
        assert_eq!(s2, serde_json::json!({}));
    }

    #[test]
    fn compose_user_includes_prompt_and_digests() {
        let digests = vec![serde_json::json!({"basename": "elder-api"})];
        let out = compose_user("fix login", &digests);
        assert!(out.contains("fix login"));
        assert!(out.contains("elder-api"));
    }

    #[test]
    fn parse_envelope_extracts_structured_output() {
        let env = r#"{"type":"result","subtype":"success","is_error":false,"result":"","structured_output":{"repoPath":"/r","name":"login","branch":"fix-login","base":"main","startCmd":"npm run dev","address":"http://localhost:5173","reason":"vite app"}}"#;
        let d = parse_envelope(env).unwrap();
        assert_eq!(d.repo_path, "/r");
        assert_eq!(d.start_cmd, "npm run dev");
    }

    #[test]
    fn parse_envelope_rejects_error_and_null() {
        let err = r#"{"is_error":true,"result":"boom","structured_output":null}"#;
        assert!(parse_envelope(err).is_err());
        let null_so = r#"{"is_error":false,"result":"","structured_output":null}"#;
        assert!(parse_envelope(null_so).is_err());
        assert!(parse_envelope("not json").is_err());
    }

    #[test]
    fn validate_repo_enforces_membership() {
        let d = DeducedWorktree {
            repo_path: "/a".into(), name: "n".into(), branch: "b".into(), base: "main".into(),
            start_cmd: "c".into(), address: "x".into(), reason: "r".into(),
        };
        assert!(validate_repo(d.clone(), &["/a".into(), "/b".into()]).is_ok());
        assert!(validate_repo(d, &["/b".into()]).is_err());
    }
}
```

- [ ] **Step 2: Declare the module**

In `src-tauri/src/lib.rs`, add `mod deduce;` alongside the other modules (after `mod commands;`, keeping them alphabetical: `commands`, `deduce`, `pty`, `settings`, `worktree`). The helpers are `pub` in the `cockpit_lib` crate, so they are part of its public surface and won't trigger dead-code warnings even before Task 3 calls them.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test deduce::`
Expected: PASS — all six `deduce::tests` pass; crate compiles clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/deduce.rs src-tauri/src/lib.rs
git commit -m "feat(deduce): DeducedWorktree + pure helpers (digest, compose, parse, validate) with tests"
```

---

### Task 3: Rust deduce command — live `claude` shell-out + timeout

Wires the pure helpers into the real IPC command: read each repo's digest from disk, shell out to `claude` with a 120s timeout, parse + validate. The live call is verified with a manual smoke test (deduction makes a real, paid CLI call).

**Files:**
- Modify: `src-tauri/src/deduce.rs` (add IO digest reader, system prompt + schema consts, `run_claude`, `deduce_worktree` command; remove the `#![allow(dead_code)]`)
- Modify: `src-tauri/src/lib.rs` (register the command)
- Modify: `src-tauri/Cargo.toml` (add `wait-timeout`)

**Interfaces:**
- Consumes: Task 2 helpers (`package_fields`, `truncate`, `compose_user`, `parse_envelope`, `validate_repo`).
- Produces (IPC, JS-callable): `deduce_worktree(prompt: String, repoPaths: Vec<String>) -> Result<DeducedWorktree, String>`.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml` under `[dependencies]` add:

```toml
wait-timeout = "0.2"
```

- [ ] **Step 2: Add the IO + command code**

In `src-tauri/src/deduce.rs`, add the following above the `#[cfg(test)]` block:

```rust
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

// System prompt: keeps the agent a pure text->JSON deducer (no tools, single structured answer).
const SYSTEM_PROMPT: &str = "You deduce git worktree parameters from a task prompt. \
Choose repoPath from the provided repo digests ONLY (copy one of their paths exactly). \
Propose a short clear name, a new branch name, the base branch to cut from, and the dev-server \
start command and address inferred from that repo's package.json scripts / README. Give a one-line \
reason. Output only the structured object.";

// Inline JSON Schema enforcing the DeducedWorktree shape (claude --json-schema wants the schema inline).
const DEDUCE_SCHEMA: &str = r#"{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"}},"required":["repoPath","name","branch","base","startCmd","address","reason"],"additionalProperties":false}"#;

const DEDUCE_TIMEOUT: Duration = Duration::from_secs(120); // CLI calls observed at 15-43s; generous ceiling.

// Build a compact JSON digest of one repo (basename + package.json fields + README snippet) for the agent to match against.
fn read_repo_digest(repo_path: &str) -> serde_json::Value {
    let dir = Path::new(repo_path);
    let basename = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let pkg = std::fs::read_to_string(dir.join("package.json")).unwrap_or_default();
    let (package_name, description, scripts) = package_fields(&pkg);
    let readme = std::fs::read_to_string(dir.join("README.md"))
        .or_else(|_| std::fs::read_to_string(dir.join("readme.md")))
        .unwrap_or_default();
    serde_json::json!({
        "path": repo_path,
        "basename": basename,
        "packageName": package_name,
        "description": description,
        "scripts": scripts,
        "readme": truncate(&readme, 800),
    })
}

// Shell out to the claude CLI in headless JSON mode (reuses Claude Code auth), with a hard timeout.
fn run_claude(user_prompt: &str) -> Result<String, String> {
    let mut child = Command::new("claude")
        .args([
            "-p", user_prompt,
            "--system-prompt", SYSTEM_PROMPT,
            "--output-format", "json",
            "--json-schema", DEDUCE_SCHEMA,
            "--model", "claude-haiku-4-5",
        ])
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

// Deduce worktree params from a prompt + the known-repos list; reads digests, calls the agent, validates the pick.
#[tauri::command]
pub fn deduce_worktree(prompt: String, repo_paths: Vec<String>) -> Result<DeducedWorktree, String> {
    if repo_paths.is_empty() {
        return Err("no known repos configured".into());
    }
    let digests: Vec<serde_json::Value> = repo_paths.iter().map(|p| read_repo_digest(p)).collect();
    let user = compose_user(&prompt, &digests);
    let stdout = run_claude(&user)?;
    let deduced = parse_envelope(&stdout)?;
    validate_repo(deduced, &repo_paths)
}
```

- [ ] **Step 3: Register the command**

In `src-tauri/src/lib.rs`, add `deduce::deduce_worktree` to the `generate_handler!` list (after `worktree::create_worktree`):

```rust
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            pty::pty_ensure,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            worktree::create_worktree,
            deduce::deduce_worktree
        ])
```

- [ ] **Step 4: Build + run tests**

Run: `cd src-tauri && cargo test deduce:: && cargo build`
Expected: pure-helper tests still pass; crate builds clean with `wait-timeout` linked and no dead-code warnings.

- [ ] **Step 5: Manual smoke test of the live CLI call (paid; ~15–43s)**

This confirms the real envelope + auth path end-to-end before the UI depends on it. From the repo root run (uses a real local repo path that has a `package.json`):

```bash
SCHEMA='{"type":"object","properties":{"repoPath":{"type":"string"},"name":{"type":"string"},"branch":{"type":"string"},"base":{"type":"string"},"startCmd":{"type":"string"},"address":{"type":"string"},"reason":{"type":"string"}},"required":["repoPath","name","branch","base","startCmd","address","reason"],"additionalProperties":false}'
claude -p 'Task prompt: fix the login bug

Known repos (digests, pick repoPath from these only):
[{"path":"/Users/victormasson/Repos/perso/cockpit","basename":"cockpit","packageName":"cockpit","scripts":{"dev":"vite"},"readme":"Tauri + React dev cockpit"}]' \
  --system-prompt 'You deduce git worktree parameters. Choose repoPath from the provided repos only. Output only the structured object.' \
  --output-format json --json-schema "$SCHEMA" --model claude-haiku-4-5 \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("is_error:", d.get("is_error")); print("structured_output:", json.dumps(d.get("structured_output"), indent=2))'
```

Expected: `is_error: False` and a `structured_output` object whose `repoPath` is the provided cockpit path, with a sensible `name`/`branch`/`startCmd`/`address`. If `is_error: True`, check `claude` is authenticated (run `claude` once interactively) before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/deduce.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(deduce): live claude-CLI shell-out with timeout + deduce_worktree command"
```

---

### Task 4: Known-repos inline editor

The tiny add/remove UI that makes the feature usable without hand-editing JSON. Mounted at the top of the new-worktree form so the deduce step (Task 5) has repos to pick from.

**Files:**
- Create: `src/tiles/worktree/KnownReposEditor.tsx`
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx` (mount the editor)

**Interfaces:**
- Consumes: store (`useSettings`: `cockpit.knownRepos`, `addKnownRepo`, `removeKnownRepo`) from Task 1.
- Produces: `<KnownReposEditor />` (no props; reads/writes the store directly).

- [ ] **Step 1: Write the editor component**

Create `src/tiles/worktree/KnownReposEditor.tsx`:

```tsx
// KnownReposEditor.tsx — tiny add/remove list of known repo paths the deduce agent may pick from.
import { useState } from "react";
import { useSettings } from "../../settings/store";

export function KnownReposEditor() {
  const { cockpit, addKnownRepo, removeKnownRepo } = useSettings();
  const repos = cockpit.knownRepos;
  const [path, setPath] = useState("");

  // add the trimmed path, then clear the field (store dedupes).
  const add = () => {
    const p = path.trim();
    if (!p) return;
    addKnownRepo(p);
    setPath("");
  };

  return (
    <div style={{ fontSize: 12, display: "grid", gap: 4 }}>
      <strong>Known repos</strong>
      {repos.length === 0 && <div style={{ opacity: 0.6 }}>Add a repo path so deduction can pick one.</div>}
      {repos.map((p) => (
        <div key={p} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
          <button onClick={() => removeKnownRepo(p)}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4 }}>
        <input placeholder="/Users/…/repo" value={path} style={{ flex: 1 }}
          onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button disabled={!path.trim()} onClick={add}>+ repo</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the editor in the form**

In `src/tiles/worktree/NewWorktreeForm.tsx`, import the editor:

```tsx
import { KnownReposEditor } from "./KnownReposEditor";
```

Render it as the first child inside the expanded form's outer `<div>` (immediately before the `name` input), followed by a thin divider:

```tsx
      <KnownReposEditor />
      <hr style={{ width: "100%", border: "none", borderTop: "1px solid #eee", margin: "4px 0" }} />
```

- [ ] **Step 3: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/tiles/worktree/KnownReposEditor.tsx src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "feat(tile): known-repos inline add/remove editor in the new-worktree form"
```

---

### Task 5: Deduce flow in the form — prompt input, pre-fill, banner

The panel half of the feature: a prompt input + Deduce button that calls the provider, pre-fills the existing editable fields, and shows a "deduced" banner. Failure surfaces inline and leaves manual entry working. Create is unchanged.

**Files:**
- Modify: `src/worktrees/api.ts` (type + wrapper)
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx` (prompt UI + deduce handler + banner)

**Interfaces:**
- Consumes: store `cockpit.knownRepos` (Task 1); existing field setters in `NewWorktreeForm` (`setName`, `setRepoPath`, `setMode`, `setBranch`, `setBase`, `setStartCmd`, `setAddress`).
- Produces (TS): `interface DeducedWorktree { repoPath; name; branch; base; startCmd; address; reason }`, `deduceWorktree(prompt: string, repoPaths: string[]): Promise<DeducedWorktree>`.

- [ ] **Step 1: Add the api wrapper + type**

In `src/worktrees/api.ts`, append:

```ts
// Mirrors the Rust DeducedWorktree: the params the deduce agent returns.
export interface DeducedWorktree {
  repoPath: string;
  name: string;
  branch: string;
  base: string;
  startCmd: string;
  address: string;
  reason: string;
}

// Deduce worktree params from a prompt + the known-repos list; rejects with an inline-displayable error string.
export const deduceWorktree = (prompt: string, repoPaths: string[]) =>
  invoke<DeducedWorktree>("deduce_worktree", { prompt, repoPaths });
```

- [ ] **Step 2: Add prompt state + deduce handler to the form**

In `src/tiles/worktree/NewWorktreeForm.tsx`:

Update the imports to pull the store's `cockpit` and the new api:

```tsx
import { createWorktree, deduceWorktree, type BranchSpec } from "../../worktrees/api";
```

Change the `useSettings()` destructure to also read `cockpit`:

```tsx
  const { addWorktree, cockpit } = useSettings();
```

Add deduce state alongside the existing `useState` hooks:

```tsx
  const [prompt, setPrompt] = useState("");
  const [deducing, setDeducing] = useState(false);
  const [deduceError, setDeduceError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ prompt: string; repoPath: string; reason: string } | null>(null);
```

Add the deduce handler (above the `submit` function):

```tsx
  // deduce: ask the agent for params, pre-fill the editable fields, and record the banner. Never creates anything.
  const runDeduce = async () => {
    setDeduceError(null);
    setDeducing(true);
    try {
      const d = await deduceWorktree(prompt, cockpit.knownRepos);
      setName(d.name);
      setRepoPath(d.repoPath);
      setMode("new");
      setBranch(d.branch);
      setBase(d.base);
      setStartCmd(d.startCmd);
      setAddress(d.address);
      setBanner({ prompt, repoPath: d.repoPath, reason: d.reason });
    } catch (e) {
      setDeduceError(String(e));
    } finally {
      setDeducing(false);
    }
  };
```

- [ ] **Step 3: Render the prompt section + banner**

In the expanded form JSX, insert the prompt block immediately after the `<KnownReposEditor />` + `<hr/>` added in Task 4 (so it sits above the `name` input):

```tsx
      {/* deduce: one prompt -> pre-filled fields (deduce -> preview/confirm -> create) */}
      <textarea placeholder="describe the task (e.g. fix the login bug)" value={prompt} rows={2}
        onChange={(e) => setPrompt(e.target.value)} />
      <button disabled={deducing || !prompt.trim() || cockpit.knownRepos.length === 0} onClick={runDeduce}>
        {deducing ? "deducing…" : "deduce"}
      </button>
      {cockpit.knownRepos.length === 0 && <div style={{ opacity: 0.6 }}>Add a known repo above to enable deduce.</div>}
      {deduceError && <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{deduceError}</div>}
      {banner && (
        <div style={{ background: "#eef6ff", border: "1px solid #cfe2ff", borderRadius: 4, padding: 6 }}>
          deduced from “{banner.prompt}” → <strong>{banner.repoPath}</strong><br />
          {banner.reason} — review the fields below and Create.
        </div>
      )}
      <hr style={{ width: "100%", border: "none", borderTop: "1px solid #eee", margin: "4px 0" }} />
```

- [ ] **Step 4: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean — all field setters referenced in `runDeduce` already exist in the component.

- [ ] **Step 5: Commit**

```bash
git add src/worktrees/api.ts src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "feat(tile): prompt-driven deduce -> pre-fill form + deduced banner"
```

---

### Task 6: Acceptance + docs

Full headless verification, manual GUI acceptance, and as-built/status doc updates.

**Files:**
- Modify: `CLAUDE.md` (as-built notes + status)
- Modify: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (decomposition item 3 status)

- [ ] **Step 1: Full headless verification**

Run:
```bash
cd src-tauri && cargo test && cargo build && cd .. && npm test && npx tsc --noEmit && npm run build
```
Expected: all Rust + JS tests green; both builds succeed.

- [ ] **Step 2: Manual GUI acceptance (ask the user to eyeball)**

Run: `npm run tauri dev` (blocking, opens the native window). Ask the user to confirm:
1. The new-worktree form shows the **Known repos** editor and a **prompt** textarea with a **deduce** button.
2. Add a real local repo path → the **deduce** button enables.
3. Type "fix the login bug" → **deduce** → after ~15–43s the fields fill (name, repo, branch, base, start command, address) and a **deduced** banner shows the picked repo + reason. (Deduce never creates anything on its own.)
4. Edit any field, then **create** → `git worktree add` runs exactly as in SP2 and the worktree tile populates.
5. Break the prompt path (e.g. clear all known repos) → deduce is disabled with the hint; with a repo present but `claude` unauthenticated, the error surfaces inline and the form is still fully usable manually.

- [ ] **Step 3: Update as-built docs**

In `CLAUDE.md` under "As-built notes", record: the `knownRepos` array in `cockpit.json`; the **deduce provider** (`src-tauri/src/deduce.rs`) — reads per-repo digests, shells out to `claude -p --output-format json --json-schema` (reuses Claude Code auth, no API key; haiku model; 120s timeout; neutral cwd; parses top-level `structured_output`, validates `repoPath` against the known list); the new `deduce_worktree` IPC command; and the form's prompt → pre-fill → banner flow with the `KnownReposEditor`. Under "Status", mark sub-project 3 (plain-prompt) complete and point "Next" at the source-type iterations (Linear → GitHub → Slack).

In `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`, mark decomposition item 3 as in progress/✅ for plain-prompt, noting source types are the next iterations.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "docs: as-built notes + status for sub-project 3 (smart new-worktree, plain prompt)"
```

---

## Notes for the implementer

- **No new capability entries needed.** The custom `invoke` command is covered by the existing `core:default`. Don't edit `src-tauri/capabilities/default.json`.
- **The deduce call is real and paid (~$0.08, ~15–43s).** Only the Task 3 / Task 6 manual steps invoke it; the unit tests never do. If `claude` errors instantly with `is_error: true` and cost 0, it's almost always an auth issue — run `claude` interactively once to authenticate.
- **Never trust the model's repo pick.** `validate_repo` rejects any `repoPath` not in the supplied list; the UI shows that as an inline error and leaves manual entry working.
- **Deduce never creates.** It only fills the form. `create_worktree` is unchanged and runs only when the user clicks Create — this is the "never silent" guarantee.
- **Reuse Claude Code auth.** Do not pass `--bare` and do not introduce an API key; the CLI's normal OAuth/keychain auth is the point.
