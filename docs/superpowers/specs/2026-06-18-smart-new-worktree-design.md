# Cockpit — Smart New-Worktree (sub-project 3) — Design

> Status: approved (brainstorming), ready for an implementation plan. A single
> Claude agent turns one **plain-prompt** input into pre-filled worktree
> parameters, always following **deduce → preview/confirm → create, never
> silent**. It populates the existing collapsible new-worktree form (the seam
> left by sub-project 2) and never blocks manual entry.
>
> Product vision: `2026-06-16-cockpit-product-spec.md` (esp. "Right column —
> worktrees", decomposition item 3, cross-cutting decision 3). Plugs into
> sub-project 2: `2026-06-17-worktree-engine-design.md`. Stack & conventions:
> `../../../CLAUDE.md`.

## Goal

Let the user type a single task prompt and have Cockpit **deduce** the worktree
parameters — which repo, a short clear name, a branch, and the local host
(start command + address) — then **preview/confirm** them in the existing form
and **create** via the unchanged sub-project-2 path. This is the first AI piece
of the app, and the second instance of the **provider + panel** pattern: a
Rust-side `deduce` provider that does the privileged work (reading repos,
shelling out to Claude) paired with the existing React form as the panel.

This iteration is **plain-prompt only**. Source types (Linear → GitHub → Slack)
come one at a time in later iterations; the deduction contract is shaped so a
future `source` is just extra context fed to the same agent.

## Scope

**In scope**
- A new top-level `knownRepos: string[]` in `cockpit.json` (the candidate repos
  the agent may pick from), with a tiny inline add/remove UI.
- A Rust **`deduce` provider**: builds a compact digest of each known repo
  (package.json + README snippet), shells out to the `claude` CLI in headless
  JSON mode, returns validated, clamped `DeducedWorktree` params.
- Frontend wiring: a prompt input + "Deduce" button at the top of
  `NewWorktreeForm`, which fills the existing editable fields and shows a
  "deduced" banner; **Create** is unchanged.

**Out of scope** (later sub-projects)
- Linear/GitHub/Slack source types (next iterations of sub-project 3).
- Post-create setup (`npm install` for the fresh empty worktree; unborn-branch
  handling) — a candidate later, not pulled in here.
- Auto-status inference; agent choosing existing-vs-new branch (always new here).
- Letting the agent browse repos with tools (Rust pre-reads a digest instead).

## Keystone decisions (locked during brainstorming)

1. **Repo source = known-repos list, agent picks.** With no integrations, the
   prompt alone can't know which repo to use. Cockpit keeps a small configured
   `knownRepos` list; the agent matches the prompt against it (the user can
   override in the confirm step). Repo becomes genuinely deducible with a tiny
   config addition.
2. **Invocation = shell out to the `claude` CLI** (`-p --output-format json
   --json-schema`). Reuses Claude Code auth (NO API key, exactly what the spec
   prefers), returns validated structured JSON, and matches the `claude` binary
   the worktree's claude terminal already uses. Privileged work stays in the
   Rust core.
3. **Repo reading = Rust pre-reads a digest; the agent has no tools.** Rust reads
   each known repo's package.json + a README snippet and passes a compact JSON
   digest inline. The agent is pure text→JSON: deterministic, fast (one-shot, no
   agentic loop), cheap, no permission prompts. File access stays in the
   provider.
4. **Confirm UX = pre-fill the existing editable form + a "deduced" banner.**
   Deduction populates the current fields; a banner shows the prompt, the picked
   repo, and a one-line "why". Every field stays editable; Create is unchanged.
   Smallest change; every guess is visible and correctable inline.
5. **Repo management = a tiny inline add/remove UI** bound to `knownRepos`, so
   the feature works end-to-end without hand-editing JSON.

## A. Data model

New top-level `knownRepos` array in `cockpit.json`, alongside `tiles`,
`worktrees`, and `preferences`. Mirrored in the Rust `CockpitConfig` struct and
the TS `CockpitConfig` type (same dual-definition discipline as SP1/SP2).

```jsonc
{
  "version": 1,
  "tiles": [ /* … */ ],
  "worktrees": [ /* … */ ],
  "knownRepos": [ "/Users/me/Repos/elder-api", "/Users/me/Repos/cockpit" ],
  "preferences": { "theme": "system", "defaultView": "main" }
}
```

- `knownRepos` is a plain `Vec<String>` (Rust) / `string[]` (TS) of absolute repo
  paths. `#[serde(default)]` so existing files without it still load; `version`
  stays `1`.
- The `Worktree` model is **unchanged** — deduction only produces values that
  flow into the existing `create_worktree`.
- Store gains `addKnownRepo(path)` / `removeKnownRepo(path)`, reusing
  `setCockpit` (already debounced-saves), exactly like the SP2 worktree actions.

## B. Rust `deduce` provider — `src-tauri/src/deduce.rs`

The second **provider** in the provider+panel pattern. One new IPC command:

`deduce_worktree(prompt: String, repoPaths: Vec<String>) -> Result<DeducedWorktree, String>`

Pipeline:

1. **Digest each repo** — read `package.json` (`name`, `description`, `scripts`)
   + a truncated `README` snippet → a compact per-repo JSON. This is the *only*
   file reading and it stays in the provider. A repo that can't be read degrades
   to a minimal digest (basename only) rather than failing the whole call.
2. **Compose the agent prompt** (pure) — system instructions + the digest array
   + the user's prompt.
3. **Shell out** — `claude -p <composed> --output-format json --json-schema
   <schema>` with a fast model for low latency, a **timeout** (kill the child on
   expiry), and a neutral cwd. Reuses Claude Code auth; no API key. Not `--bare`
   (we want the user's normal auth).
4. **Parse + validate** — extract the structured object from the CLI's JSON
   envelope into `DeducedWorktree`; **clamp `repoPath` to the provided list**
   (never trust the model to invent a path — if it returns one not in the list,
   reject or snap to the closest known path).

### `DeducedWorktree` (the `--json-schema` contract)

```jsonc
{
  "repoPath": "string — MUST be one of the provided repo paths",
  "name":     "string — short, clear worktree name",
  "branch":   "string — proposed new branch name",
  "base":     "string — base branch to cut from (e.g. the repo default)",
  "startCmd": "string — dev server command from package.json scripts",
  "address":  "string — dev server URL the agent infers (e.g. vite→5173)",
  "reason":   "string — one-line why (repo pick + key guesses), for the banner"
}
```

All fields required. **Mode is always *new branch from base*** this iteration
(the form's default); the agent does not choose existing-vs-new.

### Pure, unit-tested seams

- package.json string → digest fields (name/description/scripts).
- README snippet truncation (bounded length).
- prompt composition (digests + prompt → composed string).
- CLI-envelope string → `DeducedWorktree` parse **+ repo clamp** against the list.

The live `claude` call is integration-ish → manual.

> **Implementation-time unknown to verify** with a quick `claude -p` smoke test:
> the exact shape of the `--output-format json` envelope when `--json-schema` is
> set — whether the structured object lands under `.result` as a JSON string or
> a nested object. Pin the parser to the real envelope.

### Timeout

Prefer no new dependency: spawn the child, wait on a thread + `mpsc::recv_timeout`,
and `child.kill()` on expiry. Pull a tiny crate (`wait-timeout`) only if the
hand-rolled version proves fragile. A generous default (≈60 s) — deduction is a
single fast-model call.

## C. Frontend changes

- **`src/worktrees/api.ts`** — add `deduceWorktree(prompt, repoPaths):
  Promise<DeducedWorktree>` and the mirrored `DeducedWorktree` type.
- **`src/tiles/worktree/NewWorktreeForm.tsx`** (the seam) — add at the top a
  **prompt textarea + "Deduce" button** with `deducing… / error` states. On
  success, set the existing field state (`name`, `repoPath`, `mode="new"`,
  `branch`, `base`, `startCmd`, `address`) and show a **deduced banner** (the
  prompt, the picked repo, `reason`). All fields stay editable; **Create** is
  unchanged. Deduction failure surfaces inline and leaves the form fully usable
  for manual entry.
- **`src/tiles/worktree/KnownReposEditor.tsx`** (new, tiny) — an add (text field)
  / remove (✕) list bound to `knownRepos`, shown near the prompt input so the
  flow works end-to-end without JSON hand-editing.
- **`src/settings/types.ts` / `src/settings/store.ts`** — `knownRepos` field +
  `addKnownRepo` / `removeKnownRepo` actions; default config includes
  `knownRepos: []`.

If `DeducedWorktree`→form-state mapping is non-trivial, extract it to a pure
helper so it can be unit-tested.

## D. Error handling

Throughline (inherited from SP1/SP2): **a failed deduction never breaks the
form.** The user can always fall back to manual entry.

| Failure | Behaviour |
|---|---|
| `claude` not on PATH | Inline "claude CLI not found"; manual entry still works |
| Non-zero exit / auth failure | Surface git/CLI stderr inline |
| Timeout | "deduction timed out"; manual entry still works |
| Malformed / schema-invalid JSON | "couldn't parse deduction"; manual entry still works |
| No known repos configured | "Deduce" disabled with a hint to add a repo |
| Agent returns a path not in the list | Clamp to the list (or error if none match) — never fabricate a repo |
| Unreadable repo in the list | Degrade that repo to a basename-only digest; don't fail the call |

## E. Testing

Mirrors SP1/SP2: unit-test the pure/risky logic; manual for the GUI + live CLI.

- **Rust (`deduce.rs`):** digest extraction from a sample package.json; README
  truncation; prompt composition; envelope→`DeducedWorktree` parse + repo clamp.
  Live CLI call manual.
- **TS:** `knownRepos` store add/remove; `DeducedWorktree`→form-state mapping if
  extracted to a pure helper.
- **Headless verification the agent can run:** `cargo test`, `cargo build`,
  `npm test`, `npx tsc --noEmit`, `npm run build`.
- **Manual GUI acceptance (user eyeballs):** add a repo → type "fix the login
  bug" → Deduce → fields fill with a sensible branch + start command, banner
  shows the picked repo + why → edit a field → Create runs `git worktree add`
  exactly as in SP2.

## F. File-level change surface

- **New:** `src-tauri/src/deduce.rs` (provider + pure helpers + tests).
- **Modify:** `src-tauri/src/lib.rs` (declare module + register
  `deduce_worktree`), `src-tauri/src/settings.rs` (`knownRepos` field + default
  + backward-compat test), possibly `src-tauri/Cargo.toml` (only if a timeout
  crate is needed — lean toward none).
- **Frontend:** `src/worktrees/api.ts`, `src/settings/types.ts`,
  `src/settings/store.ts`, `src/tiles/worktree/NewWorktreeForm.tsx`, new
  `src/tiles/worktree/KnownReposEditor.tsx`.

## Definition of done

- A `knownRepos` list exists in `cockpit.json` (backward-compatible) with a
  working inline add/remove UI; old configs without it still load.
- Typing a prompt and clicking **Deduce** shells out to `claude` (reusing Claude
  Code auth, no API key) and pre-fills the form with a picked repo + name +
  branch + base + start command + address, plus a "deduced" banner with the
  reason.
- Every deduced field is editable; **Create** runs the unchanged SP2
  `create_worktree`. Nothing is ever created silently.
- Every failure mode (no CLI, auth, timeout, bad JSON, no repos, bad repo pick)
  surfaces inline and leaves manual entry working.
- Rust pure-logic tests + TS tests green; app builds and launches.
- As-built notes + status updated; spec decomposition item 3 marked in progress
  for plain-prompt, with source types noted as the next iterations.
