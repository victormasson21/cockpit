# Repo Defaults + Git Base Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make worktree deduction reliable for two fields the LLM can't infer well — the base branch (read deterministically from git) and the local host (start command + address, saved per-repo the first time and reused) — and unify per-repo config cleanly inside the `knownRepos` entries.

**Architecture:** Follow-on to sub-project 3 (smart new-worktree). `knownRepos` evolves from `string[]` to `KnownRepo[]` objects (`{ path, host? }`) so each repo carries its own saved host default in the single `cockpit.json` store — no parallel map. The Rust `deduce_worktree` command overrides the agent's `base` with the repo's git default branch. The form applies a repo's saved host after deduce and offers a "save host as default" action.

**Tech Stack:** Tauri v2, Rust (`std::process::Command`, `serde`), React 19 + TS, Zustand.

## Global Constraints

- **Learning project:** one-line role/intent comment at the top of every file and atop each significant block. High-signal only.
- **Minimalism:** smallest thing that works; no extra UI/fields/abstractions beyond this plan. Do NOT parse webpack/vite/env configs for ports (explicitly out of scope).
- **Dual-definition discipline:** persisted shapes exist as a Rust serde struct AND a mirrored TS type (camelCase via `#[serde(rename)]`).
- **Backward-compatible config:** `knownRepos` entries must deserialize from BOTH a bare string (legacy/hand-edited → `{ path }`) and the full object. New fields use `#[serde(default)]`. `version` stays `1`.
- **IPC unchanged:** `deduce_worktree(prompt, repoPaths: Vec<String>)` keeps taking an array of path strings; the frontend maps `knownRepos` → paths.
- **Base from git, not stored:** the base branch is read from git at deduce time; it is NOT a persisted field.
- **Never silent:** deduce still only fills fields; only the user-clicked Create makes a worktree.
- **Tests:** Rust `cd src-tauri && cargo test`; frontend `npm test`. Headless: `cargo build`, `npm run build`, `npx tsc --noEmit`.

## File Structure

- `src-tauri/src/settings.rs` (modify) — `KnownRepo` struct (string-or-object deserialize) + `CockpitConfig.known_repos: Vec<KnownRepo>` + tests.
- `src-tauri/src/deduce.rs` (modify) — `strip_origin_prefix` (pure) + `default_branch` (git IO) + apply override in `deduce_worktree` + test.
- `src/settings/types.ts` (modify) — `KnownRepo` type; `knownRepos: KnownRepo[]`.
- `src/settings/store.ts` (modify) — `addKnownRepo`/`removeKnownRepo` keyed by `.path`, new `setRepoHost`.
- `src/settings/store.test.ts` (modify) — update knownRepos tests to objects + cover `setRepoHost`.
- `src/tiles/worktree/KnownReposEditor.tsx` (modify) — render `r.path`, show a saved-host hint.
- `src/tiles/worktree/NewWorktreeForm.tsx` (modify) — pass paths to deduce, apply saved host, "save host as default" button.
- `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (modify) — as-built + status.

---

### Task 1: Evolve `knownRepos` from `string[]` to `KnownRepo[]`

Unify per-repo config into the repo entries: each is `{ path, host? }`. Backward-compatible deserialize accepts legacy bare-string entries. Touches the model + its store + editor consumers together so the app stays consistent.

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/settings/types.ts`
- Modify: `src/settings/store.ts`
- Modify: `src/settings/store.test.ts`
- Modify: `src/tiles/worktree/KnownReposEditor.tsx`

**Interfaces:**
- Produces (Rust): `KnownRepo { path: String, host: Option<HostConfig> }` (serializes to `{ path, host? }`, deserializes from string OR object); `CockpitConfig.known_repos: Vec<KnownRepo>`.
- Produces (TS): `KnownRepo { path: string; host?: HostConfig }`; `CockpitConfig.knownRepos: KnownRepo[]`.
- Produces (store): `addKnownRepo(path)`, `removeKnownRepo(path)`, `setRepoHost(path, host: HostConfig)`.

- [ ] **Step 1: Failing Rust test for string-or-object entries**

In `src-tauri/src/settings.rs` tests module, add:

```rust
#[test]
fn known_repos_accepts_string_or_object_entries() {
    let json = r#"{"version":1,"tiles":[],"worktrees":[],"knownRepos":["/a",{"path":"/b","host":{"startCmd":"pnpm start","address":"http://localhost:2000"}}],"preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.known_repos.len(), 2);
    assert_eq!(cfg.known_repos[0].path, "/a");
    assert_eq!(cfg.known_repos[0].host, None);
    assert_eq!(cfg.known_repos[1].path, "/b");
    assert_eq!(cfg.known_repos[1].host.as_ref().unwrap().address, "http://localhost:2000");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test known_repos_accepts`
Expected: FAIL to compile — `known_repos` is still `Vec<String>` (`.path` doesn't exist).

- [ ] **Step 3: Add the `KnownRepo` struct + change the field**

In `src-tauri/src/settings.rs`, add after `HostConfig` (which already exists):

```rust
// A repo the deduce agent may target, plus optional user-saved host default (start cmd + address) for fields git/the agent can't reliably supply.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KnownRepo {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<HostConfig>,
}

// Accept both a bare string (legacy / hand-edited config) and the full object form so old cockpit.json files still load.
impl<'de> Deserialize<'de> for KnownRepo {
    fn deserialize<D>(d: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Path(String),
            Full {
                path: String,
                #[serde(default)]
                host: Option<HostConfig>,
            },
        }
        Ok(match Repr::deserialize(d)? {
            Repr::Path(path) => KnownRepo { path, host: None },
            Repr::Full { path, host } => KnownRepo { path, host },
        })
    }
}
```

Change the `CockpitConfig` field from `pub known_repos: Vec<String>` to:

```rust
    #[serde(default, rename = "knownRepos")]
    pub known_repos: Vec<KnownRepo>,
```

(The `impl Default for CockpitConfig` already sets `known_repos: vec![]` — leave it.)

- [ ] **Step 4: Run Rust tests**

Run: `cd src-tauri && cargo test settings::`
Expected: PASS — the new string-or-object test plus the existing `cockpit_without_known_repos_field_still_loads` (absent field → empty) and round-trip tests stay green.

- [ ] **Step 5: Mirror the TS types**

In `src/settings/types.ts`, add above `CockpitConfig` (next to `HostConfig`):

```ts
export interface KnownRepo { path: string; host?: HostConfig }
```

Change the `CockpitConfig` field from `knownRepos: string[];` to `knownRepos: KnownRepo[];`.

- [ ] **Step 6: Update the store actions**

In `src/settings/store.ts`:

Import `KnownRepo` and `HostConfig` alongside the existing type imports:

```ts
import type { CockpitConfig, HostConfig, KnownRepo, LayoutConfig, Settings, Worktree } from "./types";
```

Update the `SettingsState` interface entries:

```ts
  addKnownRepo: (path: string) => void;
  removeKnownRepo: (path: string) => void;
  setRepoHost: (path: string, host: HostConfig) => void;
```

Replace the existing `addKnownRepo`/`removeKnownRepo` implementations and add `setRepoHost` (keep using functional `setCockpit` so writes compose):

```ts
  // Known repos the deduce agent may pick from; each carries an optional saved host default. add dedupes by path.
  addKnownRepo: (path) =>
    get().setCockpit((c) =>
      c.knownRepos.some((r) => r.path === path) ? c : { ...c, knownRepos: [...c.knownRepos, { path }] },
    ),
  removeKnownRepo: (path) =>
    get().setCockpit((c) => ({ ...c, knownRepos: c.knownRepos.filter((r) => r.path !== path) })),
  setRepoHost: (path, host) =>
    get().setCockpit((c) => ({
      ...c,
      knownRepos: c.knownRepos.map((r) => (r.path === path ? { ...r, host } : r)),
    })),
```

The `cockpit` default object already has `knownRepos: []` — leave it (an empty array satisfies `KnownRepo[]`).

- [ ] **Step 7: Update the store tests (objects, not strings) + cover setRepoHost**

In `src/settings/store.test.ts`, the `knownRepos` tests added earlier assert on string entries. Update them so entries are objects and add a `setRepoHost` case. Find the `knownRepos actions` describe block and replace its body with:

```ts
  it("addKnownRepo appends a { path } object", () => {
    useSettings.getState().addKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/a" }]);
  });
  it("addKnownRepo is idempotent by path", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().addKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toHaveLength(1);
  });
  it("removeKnownRepo drops the entry by path", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().removeKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([]);
  });
  it("setRepoHost sets the host on the matching entry", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().setRepoHost("/a", { startCmd: "pnpm start", address: "http://localhost:2000" });
    expect(useSettings.getState().cockpit.knownRepos[0].host).toEqual({
      startCmd: "pnpm start",
      address: "http://localhost:2000",
    });
  });
```

If the existing block initializes/resets store state a particular way (e.g. a `beforeEach` that sets `cockpit`), KEEP that harness — only change the assertions/bodies to match objects. Read the file first and match its existing reset pattern; do not introduce a new one.

- [ ] **Step 8: Update `KnownReposEditor` to objects**

In `src/tiles/worktree/KnownReposEditor.tsx`, change the file role comment to mention the entries carry an optional host, and update the map to use `r.path` plus a small saved-host hint:

```tsx
      {repos.map((r) => (
        <div key={r.path} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.path}</span>
          {r.host && <span style={{ opacity: 0.6 }}>· {r.host.address}</span>}
          <button onClick={() => removeKnownRepo(r.path)}>✕</button>
        </div>
      ))}
```

(The add field/handler are unchanged — `addKnownRepo(path)` still takes a path string.)

- [ ] **Step 9: Full verification**

Run: `cd src-tauri && cargo test settings:: && cd .. && npm test && npx tsc --noEmit && npm run build`
Expected: all green; build clean.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/settings.rs src/settings/types.ts src/settings/store.ts src/settings/store.test.ts src/tiles/worktree/KnownReposEditor.tsx
git commit -m "refactor(model): knownRepos entries become objects carrying an optional host default"
```

---

### Task 2: Git-derived base branch in deduce

Override the agent's `base` with the repo's real default branch read from git. The agent often guesses `main` when the repo uses `master`; git is authoritative.

**Files:**
- Modify: `src-tauri/src/deduce.rs`

**Interfaces:**
- Produces (Rust, pure): `strip_origin_prefix(&str) -> String`.
- Internal: `default_branch(repo_path: &str) -> Option<String>` (git IO); applied inside `deduce_worktree` so the returned `DeducedWorktree.base` is the git default branch when available.

- [ ] **Step 1: Failing test for the pure helper**

In `src-tauri/src/deduce.rs` tests module, add:

```rust
#[test]
fn strip_origin_prefix_handles_origin_head() {
    assert_eq!(strip_origin_prefix("origin/master"), "master");
    assert_eq!(strip_origin_prefix("origin/main"), "main");
    assert_eq!(strip_origin_prefix("develop"), "develop"); // no prefix: unchanged
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test strip_origin_prefix`
Expected: FAIL to compile — `strip_origin_prefix` not defined.

- [ ] **Step 3: Add the helpers + apply the override**

In `src-tauri/src/deduce.rs`, add near the other pure helpers (e.g. after `validate_repo`):

```rust
// "origin/master" -> "master" (pure); leaves an already-bare branch name unchanged.
pub fn strip_origin_prefix(s: &str) -> String {
    s.strip_prefix("origin/").unwrap_or(s).to_string()
}
```

Add the git IO helper near `read_repo_digest` (it needs `Command`, already imported in this file):

```rust
// Read the repo's default branch from git (origin/HEAD -> e.g. "master"); None when there is no remote/HEAD.
fn default_branch(repo_path: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", repo_path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(strip_origin_prefix(&s))
    }
}
```

In `deduce_worktree`, after the `validate_repo` result, override `base` with the git default branch when git provides one. Change the tail of the function so it reads:

```rust
    let mut deduced = validate_repo(parse_envelope(&stdout)?, &repo_paths)?;
    // Base branch is deterministic from git; don't trust the agent's main/master guess.
    if let Some(b) = default_branch(&deduced.repo_path) {
        deduced.base = b;
    }
    Ok(deduced)
```

(The original final line was `validate_repo(deduced, &repo_paths)` — replace the binding + return as shown.)

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test deduce:: && cargo build`
Expected: `strip_origin_prefix` test passes with the rest; build warning-clean.

- [ ] **Step 5: Optional live smoke (paid ~$0.08, ~15-43s)**

Confirm base now reflects git. Pick a real repo whose default branch is NOT main (e.g. `/Users/victormasson/Repos/elder/pro-web-portal`, default `master`). From the repo root, you can sanity-check the git side directly first:

```bash
git -C /Users/victormasson/Repos/elder/pro-web-portal symbolic-ref --short refs/remotes/origin/HEAD
```
Expected: `origin/master`. (A full deduce smoke through the running app is covered in Task 4's manual acceptance — no separate paid call required here.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/deduce.rs
git commit -m "feat(deduce): override base with the repo's git default branch (fixes main vs master)"
```

---

### Task 3: Apply saved host post-deduce + "save host as default" button

Wire the frontend: pass repo paths to deduce (knownRepos is now objects), override the host fields from a repo's saved default when present, and add a button to save the current host as that repo's default.

**Files:**
- Modify: `src/tiles/worktree/NewWorktreeForm.tsx`

**Interfaces:**
- Consumes: store `cockpit.knownRepos` (objects), `setRepoHost` (Task 1); `deduceWorktree` (unchanged signature `(prompt, repoPaths: string[])`).

- [ ] **Step 1: Pass paths + read setRepoHost**

In `src/tiles/worktree/NewWorktreeForm.tsx`, change the store destructure to include `setRepoHost`:

```tsx
  const { addWorktree, cockpit, setRepoHost } = useSettings();
```

In `runDeduce`, map `knownRepos` to paths when calling deduce, and apply a saved host default if the picked repo has one:

```tsx
      const d = await deduceWorktree(prompt, cockpit.knownRepos.map((r) => r.path));
      setName(d.name);
      setRepoPath(d.repoPath);
      setMode("new");
      setBranch(d.branch);
      setBase(d.base);
      // A repo's saved host default wins over the agent's guess (port/start cmd aren't reliably inferable).
      const saved = cockpit.knownRepos.find((r) => r.path === d.repoPath)?.host;
      setStartCmd(saved?.startCmd ?? d.startCmd);
      setAddress(saved?.address ?? d.address);
      setBanner({ prompt, repoPath: d.repoPath, reason: d.reason, hostFromSaved: !!saved });
```

- [ ] **Step 2: Extend the banner type + text**

Update the `banner` state type to carry `hostFromSaved`:

```tsx
  const [banner, setBanner] = useState<{ prompt: string; repoPath: string; reason: string; hostFromSaved: boolean } | null>(null);
```

In the banner JSX, note when the host came from a saved default — change the banner body to:

```tsx
          deduced from "{banner.prompt}" → <strong>{banner.repoPath}</strong><br />
          {banner.reason} — review the fields below and Create.
          {banner.hostFromSaved && <><br />host loaded from this repo's saved default.</>}
```

- [ ] **Step 3: Add the "save host as default" button**

Immediately after the host `address` input (the line `<input placeholder="host address" .../>`), add:

```tsx
      {repoPath && (
        <button disabled={!startCmd || !address} onClick={() => setRepoHost(repoPath, { startCmd, address })}>
          save host as default for this repo
        </button>
      )}
```

- [ ] **Step 4: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. (`deduceWorktree` still takes `string[]`; we now pass `knownRepos.map(r => r.path)`.)

- [ ] **Step 5: Commit**

```bash
git add src/tiles/worktree/NewWorktreeForm.tsx
git commit -m "feat(tile): apply saved per-repo host after deduce + save-as-default button"
```

---

### Task 4: Docs + acceptance

Headless verification, as-built/status doc updates, and manual GUI acceptance.

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

In `CLAUDE.md`:
- Update the `knownRepos` note: entries are now objects `{ path, host? }` (each repo carries an optional saved host default — start cmd + address); the deserializer also accepts legacy bare-string entries.
- In the deduce-provider note, add that `deduce_worktree` overrides the agent's `base` with the repo's git default branch (`git symbolic-ref refs/remotes/origin/HEAD`), and that the form applies a repo's saved host default after deduce (with a "save host as default" action) — base from git, host from saved defaults.

In `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`: under the sub-project-3 area / decomposition item 3, note the follow-on: git-derived base branch + per-repo saved host defaults (stored in the unified `knownRepos` entries).

- [ ] **Step 3: Manual GUI acceptance (ask the user to eyeball)**

Run: `npm run tauri dev`. Ask the user to confirm:
1. Add `pro-web-portal` (or any repo whose default branch is `master`). Deduce a task → the **base branch** field shows `master` (from git), not `main`.
2. Correct the host start cmd/address to the right values, click **save host as default for this repo** → the repo row in Known repos shows the saved address.
3. Deduce again for that repo → the host fields pre-fill from the saved default and the banner notes "host loaded from this repo's saved default".
4. Deduce works unchanged for a repo with no saved host (agent's guess used).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "docs: git base branch + per-repo saved host defaults (as-built + status)"
```

---

## Notes for the implementer

- **knownRepos is unmerged.** It only shipped on this branch, so there's no production migration — but the string-or-object deserialize still matters: it loads the user's local test cockpit.json (which has bare-string entries) and keeps settings hand-editable per the product spec.
- **Base is from git, not stored.** Don't add a base field to `KnownRepo`. If git has no default branch (no remote), the agent's guess stays.
- **Host default wins over the agent.** When a repo has a saved host, it overrides the agent's guess in the form; the agent still returns a guess (used only when no default is saved).
- **No config parsing for ports.** The whole point of saved defaults is to avoid brittle webpack/vite/env scraping.
