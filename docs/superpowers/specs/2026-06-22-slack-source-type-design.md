# Cockpit — Slack Source Type (sub-project 3, iteration 3) — Design

> Status: approved (brainstorming), ready for an implementation plan.
> **Third and final** of the deduction **source types** (Linear → GitHub → **Slack**,
> one at a time). A Slack message permalink in the new-worktree prompt is resolved —
> via the user's Slack MCP — into discussion context that feeds the **same** deduction
> agent, and the Slack link auto-populates the new worktree's links. Flow stays
> **deduce → preview/confirm → create, never silent**.
>
> Builds on the Linear iteration (`2026-06-18-linear-source-type-design.md`, the
> MCP-delegation template) and the GitHub iteration
> (`2026-06-19-github-source-type-design.md`, which left the source-neutral seam —
> `sourceUrl`/`sourceTitle`/`sourceResolved`, `sourceLinkFrom`, the `Source` enum).
> Slack plugs into that seam as the third branch its §G anticipated. Product vision:
> `2026-06-16-cockpit-product-spec.md`. Stack & conventions: `../../../CLAUDE.md`.

## Goal

Let the user paste a **Slack message permalink**
(`<workspace>.slack.com/archives/<channel>/p<ts>`, with or without `?thread_ts=…`)
into the existing new-worktree prompt box. Cockpit detects it, has the deduction
agent **fetch the message (and its thread, if any) via the Slack MCP** and deduce
the worktree name + branch from the discussion, picks the repo from `knownRepos`,
and **auto-adds the Slack link** to the created worktree. Everything else
(base-from-git, saved host defaults, preview/confirm, manual editability) is unchanged.

## Keystone decision (confirmed during brainstorming): MCP delegation, like Linear

The central question was *how Cockpit reads Slack*. Like Linear (and unlike GitHub),
**the app has no Slack CLI to reuse** — there is no `gh`-equivalent — so it cannot
fetch in Rust. **The fetch is delegated to the user's Slack MCP via the `claude`
CLI** (`--allowedTools mcp__<slack-server>`), exactly as Linear delegates its ticket
fetch. This is the third instance of the same mechanism, the one the Linear spec's
§G explicitly named ("a Slack permalink would be the third branch — same
MCP-delegation shape, same `sourceResolved` guardrail, same link auto-population").

Why this is the right MVP and is spec-consistent:

- The product spec sanctions **reusing the dev tool's auth** (decision 4); "reuse
  Claude Code's MCP" is the same philosophy already used for Linear.
- Zero app auth code — the smallest thing that works for a single-user app where the
  developer is the user. No `keyring`, no token UI, no OAuth, no `slack.rs`.
- The source-neutral seam from the GitHub iteration means Slack is a near-pure
  **drop-in branch**: no schema invention, no frontend change.

**Accepted trade-offs (with mitigations):**

1. It is MCP-mediated (LLM round-trip) rather than a deterministic Rust fetch like
   GitHub. → Accepted: an on-demand, human-triggered, reason-over-a-thread fetch is
   exactly what an LLM-mediated tool is good at. (Contrast: a future *unread-messages
   tile* is background/continuous/deterministic and will instead use the Slack Web
   API + Socket Mode + a Keychain token as a Rust provider — a different access
   pattern, deferred to sub-project 4/5. The MCP choice here does **not** bind that
   tile to the MCP.)
2. Forced `--json-schema` could make the agent **fabricate** params if the fetch
   fails. → **Mitigated by the `sourceResolved` guardrail** (§B/§D): a detected
   permalink that wasn't actually fetched returns an inline error, never guessed
   params.
3. It **couples Cockpit to the user's Claude Code MCP config.** (The live smoke
   resolved `SLACK_ALLOWED_TOOLS` to the clean connector name `mcp__slack`, like
   Linear's — *not* the per-install UUID first guessed; but it also revealed the
   Slack connector needs `--permission-mode bypassPermissions`, which Linear did
   not.) → **Documented, not hidden** (§F): acceptable for a single-user
   app; making it configurable is part of the sub-project-4 auth manager, alongside
   `linear.rs`.

## Scope

**In scope**
- Pure Rust ref detection: a `*.slack.com/archives/…` permalink (`detect_slack_ref`),
  plain and `?thread_ts=` forms.
- A `Source::Slack(String)` branch in `deduce_worktree`: an MCP-enabled `claude` call
  (Slack `--allowedTools`, the shared source schema + a Slack system prompt) so the
  agent fetches the message+thread itself.
- The repo is picked **by the agent from `knownRepos`** (Linear's shape), aided by
  any free text the user types alongside the link; `validate_repo` rejects an invented
  repo, and the preview/confirm step + editable `repoPath` are the safety net.
- A `sourceResolved` guardrail (unresolved → inline error, never fabricated params).
- **Deterministic `source_url`:** the resolved link is the permalink the user pasted
  (Rust overwrites it; the agent supplies only `sourceTitle`/`sourceResolved`).
- The resolved Slack link auto-populates the worktree's `links` on Create; the
  existing banner shows it.
- A small source-neutral rename: `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE`
  (now shared by Linear **and** Slack), mirroring the GitHub field rename.

**Out of scope** (later iterations / sub-projects)
- The **unread-messages Slack tile** (background panel of unread messages from chosen
  channels) — a different access pattern (continuous/deterministic/push), built on the
  Slack Web API + Socket Mode + a Keychain OAuth token as a Rust provider. Sub-project
  4 (auth manager + first read-only tile) / 5 (Slack panel).
- In-app Slack auth / `slack.rs` provider / token UI — deferred to sub-project 4.
- Pinning a Slack id into name/branch — there is no meaningful short id (locked: pin
  nothing; the name/branch are fully agent-proposed).
- Choosing an existing branch from a Slack ref (a Slack discussion is always "start
  new work" → new branch).

## A. Detection — pure, in `deduce.rs` (no new file)

Like Linear, Slack needs **no Rust fetch** (the MCP fetches), so detection lives in
`deduce.rs` and there is **no `slack.rs`** (contrast GitHub, which needed `github.rs`
for its `gh` fetch + repo match).

```rust
// Some(permalink) for a *.slack.com/archives/… URL anywhere in the prompt; None otherwise. Pure, no I/O.
pub fn detect_slack_ref(prompt: &str) -> Option<String>
```

- Scans whitespace-delimited tokens for one containing `.slack.com/archives/`, trims
  common trailing punctuation (`)`, `,`, `.`), and returns the **whole permalink**
  (both the plain and `?thread_ts=…&cid=…` forms are returned verbatim).
- **Channel/timestamp are NOT parsed in Rust** — the permalink is handed to the agent,
  which resolves it via the Slack MCP. (Pure MCP-delegation; the §F smoke confirms the
  MCP can resolve a permalink.)
- Slack-looking but non-permalink text (e.g. a bare `slack.com` link, a workspace
  home URL) does not match → falls through to the plain path.
- **Canonical fixtures** (real shapes, used by the unit tests + the §F smoke):
  - plain: `https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782139459441759`
  - thread reply: `https://elderteam.slack.com/archives/C0ADKCM7A4U/p1782140757530969?thread_ts=1782140735.398509&cid=C0ADKCM7A4U`
  The `?thread_ts=…&cid=…` form both signals a thread and carries `thread_ts`/`cid`
  (likely the exact keys the MCP needs — see §F item 3).

The `Source` enum gains a `Slack(String)` variant; detection order becomes:

```rust
// detect_source: a GitHub URL wins, then a Linear ref, then a Slack permalink, else plain.
enum Source { GitHub(GithubRef), Linear(String), Slack(String), Plain }
```

The three URL/ref shapes are mutually exclusive in practice; for the rare prompt
carrying more than one, the documented precedence is GitHub → Linear → Slack.

## B. The Slack branch in `deduce_worktree` (mirrors the Linear arm)

The command keeps its signature (`prompt`, `repo_paths`) and its tail (repo validation
+ base-from-git). The Slack arm:

```text
Source::Slack(url) -> MCP-enabled call: SYSTEM_PROMPT_SLACK + DEDUCE_SCHEMA_SOURCE,
                      --allowedTools SLACK_ALLOWED_TOOLS, model SLACK_MODEL,
                      user prompt = compose_user_slack(prompt, url, digests)
```

After `parse_envelope` + `validate_repo` + base-from-git (all reused unchanged):

1. **Guardrail:** if `source_resolved == false`, return
   `Err("couldn't resolve Slack message (is the Slack MCP connected?)")` — never the
   fabricated params.
2. **Deterministic `source_url`:** overwrite `deduced.source_url = url`. The permalink
   the user pasted *is* the canonical URL, so Rust supplies it rather than trusting the
   agent to echo a long URL — the GitHub-style "Rust knows it for certain" principle
   applied where it cheaply can. `source_title` and `source_resolved` still come from
   the agent.
3. **No id pinning:** `ensure_ref_prefix` is **not** called on this path (no
   meaningful short id). `existing_branch` stays `false` and `pr_number` stays `0`
   (their defaults) → a new branch with a fully agent-proposed name.

### Consts + the one rename (in `deduce.rs`)

```rust
// Slack-path system prompt: fetch the referenced message (and its thread) via the Slack MCP and deduce from the discussion.
const SYSTEM_PROMPT_SLACK: &str = "You deduce git worktree parameters from a task prompt that references a Slack message. \
Fetch the referenced message via the Slack MCP, and if it is part of a thread, read the thread for context. Use the \
discussion to choose a short descriptive name and a new branch. Choose repoPath from the provided repo digests ONLY \
(copy one exactly); the prompt text may name the repo. Also propose the base branch and the dev-server start \
command/address from that repo's scripts/README, with a one-line reason. Set sourceTitle to a short label for the \
discussion and sourceResolved=true (sourceUrl may echo the permalink). If you CANNOT fetch the message, set \
sourceResolved=false. Output only the structured object.";

// Pinned by live smoke (2026-06-22). The Slack connector also needs a permission-mode bypass (Linear did not).
const SLACK_ALLOWED_TOOLS: &str = "mcp__slack";          // claude.ai Slack connector's headless name (like mcp__linear)
const SLACK_MODEL: &str = "claude-haiku-4-5";            // haiku resolved the DM + thread reliably
const SLACK_PERMISSION_MODE: &str = "bypassPermissions"; // scoped to Slack tools by SLACK_ALLOWED_TOOLS
```

- **Rename** `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE` (its fields —
  `sourceUrl`/`sourceTitle`/`sourceResolved` — are already source-neutral; now that
  Linear **and** Slack both use it, the name should be too; same spirit as the GitHub
  field rename). `SYSTEM_PROMPT_TICKET` and `compose_user_ticket` stay Linear-named.
- **New** `compose_user_slack(prompt, url, digests)` — the plain composition plus an
  instruction to fetch the message+thread and set `sourceTitle`/`sourceResolved`:

```rust
// Compose the Slack-path user prompt: the plain composition plus an instruction to fetch the message+thread.
pub fn compose_user_slack(prompt: &str, url: &str, digests: &[serde_json::Value]) -> String
```

No `DeducedWorktree` field changes — Slack reuses the existing source-neutral fields.

## C. Frontend — no changes

This is the payoff of the source-neutral seam the GitHub iteration left. A Slack
deduction returns `sourceUrl`/`sourceTitle`/`sourceResolved` (already in `api.ts`),
with `existingBranch=false` and `prNumber=0` (defaults). `runDeduce` already calls
`sourceLinkFrom(d)`, stages `sourceLink`, shows the generic
`🔗 <title> — link will be added` banner line, sets `mode="new"`, and attaches the
link on Create. **`src/worktrees/api.ts`, `src/worktrees/model.ts`, and
`src/tiles/worktree/NewWorktreeForm.tsx` are untouched.**

Consequently Slack introduces **zero new staged form state**, so it remains inside the
same set (`sourceLink`, `prNumber`, `banner`, …) that the pending
clear-deduced-state-on-edit follow-up will reset — this iteration does not worsen that
known issue.

## D. Error handling (additions to the GitHub table)

| Failure | Behaviour |
|---|---|
| Permalink detected, Slack MCP missing / unauthenticated | `sourceResolved=false` → inline "couldn't resolve Slack message (is the Slack MCP connected?)"; manual entry still works |
| Message / thread not accessible | same `sourceResolved=false` path |
| No Slack URL in the prompt | GitHub → Linear → plain path, byte-identical to today |
| Slack-looking but non-permalink text | detector matches only `.slack.com/archives/…`; otherwise treated as a plain prompt |

## E. Testing

Mirrors the prior iterations: unit-test the pure/risky logic; manual for the GUI +
live MCP call.

- **Rust (pure):** `detect_slack_ref` (plain permalink / `?thread_ts=` form /
  embedded in prose / trailing punctuation trimmed / non-Slack URL → None / a GitHub
  or Linear ref not misdetected as Slack); `detect_source` picks Slack after
  GitHub/Linear; `compose_user_slack` includes the prompt, the url, and a digest. The
  shared-schema envelope parse (`sourceUrl`/`sourceTitle`/`sourceResolved` + defaults)
  is already covered by the existing `parse_envelope` tests.
- **No new TS tests** — `sourceLinkFrom` is already covered and the frontend is
  unchanged.
- **Rust (manual, paid — gates the code):** the §F human-run smoke pins
  `SLACK_ALLOWED_TOOLS` + `SLACK_MODEL` and confirms a real permalink is fetched.
- **Headless (agent-runnable):** `cargo test`, `cargo build`, `npm test`,
  `npx tsc --noEmit`, `npm run build`.
- **Manual GUI (user eyeballs):** paste a real permalink → deduce → repo + descriptive
  branch filled, banner shows the link → Create → the worktree tile shows the Slack
  link. Then: `"do this in the web-app: <permalink>"` → repo resolves to web-app, the
  branch is named from the message. Then: a permalink with the Slack MCP disconnected
  → inline error, form still usable manually. Plain / Linear / GitHub prompts behave
  exactly as before.

## F. Implementation-time unknowns — RESOLVED by live smoke (2026-06-22)

A live `claude -p` smoke against a real DM permalink (connector `✔ Connected`) pinned
all four, recorded in the plan's "Verified CLI facts" block:

1. **Server name → `mcp__slack`** (the claude.ai connector's headless name, like
   `mcp__linear`). The `mcp__01908495-…` UUID first guessed was the *in-session*
   tool-namespace id, NOT the `--allowedTools` token — using it was the cause of the
   first live failure (`sourceResolved=false`, "fetch requires permission").
2. **haiku suffices** — resolved the message and emitted the forced JSON (~6 turns).
3. **The MCP resolves a bare permalink** — no channel+ts parsing needed; Rust passes
   the raw permalink (a `D…` DM resolved, so private/DM access works too).
4. **The connector loads from `std::env::temp_dir()`** (`✔ Connected` there; smoke ran
   from a temp dir).

**New finding (not anticipated):** the Slack connector **gates its tool calls even when
allow-listed**, so the path additionally needs `--permission-mode bypassPermissions`
(Linear needed none). It is kept alongside `--allowedTools "mcp__slack"`, so the agent
stays restricted to Slack tools. Pinned as `SLACK_PERMISSION_MODE`.

## G. Extensibility / what this closes

- This is the **last of the three planned source types** (Linear → GitHub → Slack).
  After it, "deduce a worktree from a referenced thing" covers tickets, PRs/issues, and
  Slack discussions. Further sources would each still be a single `detect_*` + a branch
  in `detect_source`, but none are planned.
- **The MCP-vs-API split is deliberate and recorded** (Keystone trade-off 1): the
  *deduce flow* uses the Slack MCP (on-demand, LLM-mediated, zero auth); a future
  *unread tile* uses the Slack Web API + Socket Mode + Keychain token as a Rust
  provider (background, deterministic, push). Choosing the MCP here does not bind the
  tile to it. Once that API provider exists (SP4/5), the deduce flow *could* optionally
  swap onto it — the generalized "linear.rs swap point" — but that is YAGNI now.

## H. File-level change surface

- **Modify:** `src-tauri/src/deduce.rs` — `detect_slack_ref` (pure + tests);
  `Source::Slack` + the `detect_source` branch; `SYSTEM_PROMPT_SLACK` + `SLACK_*`
  consts; rename `DEDUCE_SCHEMA_TICKET` → `DEDUCE_SCHEMA_SOURCE`; `compose_user_slack`;
  the Slack arm in `deduce_worktree` (guardrail + deterministic `source_url`, no id
  pinning).
- **Modify:** `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`
  — as-built notes + status (Slack done → source types complete; Next = sub-project 4).
- **No frontend changes, no new files, no new dependencies, no IPC signature change.**

## Definition of done

- A Slack permalink typed into the prompt is detected; the deduce call fetches the
  message (and its thread) via the Slack MCP and deduces name/branch from the
  discussion, with repo picked from `knownRepos` (free text in the prompt can name the
  repo) and base/host behaviour unchanged.
- The deduced worktree gets a **new branch with a fully agent-proposed name** (no id
  pinned); `existing_branch=false`.
- The resolved Slack link (the pasted permalink) is auto-added to the worktree's
  `links` on Create; the banner shows it.
- A detected-but-unresolved message (`sourceResolved=false`) surfaces inline and never
  produces fabricated params; the plain / Linear / GitHub paths are byte-identical and
  unaffected; manual entry always works.
- `SLACK_ALLOWED_TOOLS` / `SLACK_MODEL` are pinned by a human-run smoke and recorded in
  the plan; `DEDUCE_SCHEMA_TICKET` is renamed `DEDUCE_SCHEMA_SOURCE`.
- Rust pure-logic tests green (no new TS tests; frontend unchanged); app builds and
  launches.
- As-built notes + status updated; decomposition item 3 marks all three source types
  done and points Next at sub-project 4; the MCP-vs-API split for the future tile is
  recorded.
</content>
</invoke>
