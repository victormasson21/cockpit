# Cockpit — Linear Source Type (sub-project 3, iteration 2) — Design

> Status: approved (brainstorming), ready for an implementation plan.
> **Implementation is deferred** — we write the spec + plan now and build later.
> First of the deduction **source types** (Linear → GitHub → Slack, one at a
> time). A Linear ticket ref in the new-worktree prompt is resolved into ticket
> context that feeds the **same** deduction agent, and the ticket link
> auto-populates the new worktree's links. Flow stays **deduce → preview/confirm
> → create, never silent**.
>
> Builds on the plain-prompt design: `2026-06-18-smart-new-worktree-design.md`
> (this iteration plugs into the seam it left: "a future `source` is just extra
> context fed to the same agent"). Product vision:
> `2026-06-16-cockpit-product-spec.md` (Right column — worktrees; decomposition
> item 3; cross-cutting decisions 3 & 4; Authentication). Stack & conventions:
> `../../../CLAUDE.md`.

## Goal

Let the user paste a **Linear ticket** (an id like `ENG-1234` or a `linear.app`
URL) into the existing new-worktree prompt box. Cockpit detects the ref, has the
deduction agent **fetch the ticket's context** (title / description) and deduce
the worktree name + branch from it, and **auto-adds the ticket link** to the
created worktree. Everything else (repo pick from `knownRepos`, base-from-git,
saved host defaults, preview/confirm, manual editability) is unchanged.

## Keystone decision (locked during brainstorming): the app does not auth to Linear

The central question was *how the Cockpit app reads Linear*. The deduce agent
(the `claude` CLI) only **reasons**; something must **fetch** the ticket.

**Decision: delegate the fetch to Claude Code's Linear MCP — no app-side Linear
auth this iteration.** When a ticket ref is detected, the existing `claude` call
is run **MCP-enabled**, so the agent fetches the ticket itself and folds it into
the same text→JSON deduction. No `keyring`, no token UI, no OAuth, no `linear.rs`.

Why this is the right MVP and is spec-consistent:

- The product spec already sanctions **reusing the dev tool's auth** for several
  services (decision 4: *Anthropic = reuse Claude Code auth*, *GitHub = reuse
  `gh`*) and prefers reuse over bespoke API keys. "Reuse Claude Code's MCP" is
  the same philosophy.
- It **collapses the whole Linear → GitHub → Slack roadmap** into one mechanism
  (see §G): per-source work shrinks to detect-the-ref + name-the-MCP +
  capture-the-URL.
- Zero app auth code — the smallest thing that works for a single-user app where
  the developer is the user.

**Accepted trade-offs (with mitigations):**

1. It reverses the plain path's *deliberately tool-less* property. → **Mitigated:
   the no-ref path stays byte-identical** (tool-less, fast, haiku); MCP is enabled
   **only** on the ticket path.
2. Forced `--json-schema` could make the agent **fabricate** params if the fetch
   fails. → **Mitigated by the `sourceResolved` guardrail** (§B/§D): a detected
   ticket that wasn't actually fetched returns an inline error, never guessed
   params.
3. It **couples Cockpit to the user's Claude Code MCP config** and moves the
   privileged fetch into the `claude` subprocess rather than a Rust provider — a
   real divergence from provider+panel. → **Documented, not hidden:** the Rust
   `linear.rs` + macOS-Keychain-token provider is named here as the
   **sub-project-4 (auth manager) productionization swap point**. This is a
   deliberate deferral.

## Scope

**In scope**
- Pure Rust ref detection: `ENG-1234` ids and `linear.app/.../issue/<ID>-…` URLs.
- An MCP-enabled branch in `deduce_worktree` taken only when a ref is detected:
  `--allowedTools` for the Linear MCP, an extended schema + system prompt, and
  (if needed) a stronger model.
- A `sourceResolved` guardrail so an unresolved ticket errors inline instead of
  producing fabricated params.
- The resolved ticket URL/title flow back and **auto-populate the new worktree's
  `links`** on Create; a banner shows the resolved ticket.
- A small, explicit **source seam** (§G) so GitHub/Slack are drop-in later.

**Out of scope** (later iterations / sub-projects)
- GitHub and Slack source types — *next iterations, same mechanism* (§G).
- In-app Linear auth: `linear.rs`, macOS Keychain token, token UI, OAuth, the
  auth status page — *deferred to sub-project 4*.
- Post-create setup (`npm install` for the fresh empty worktree).
- Choosing an existing branch; importing labels/assignee; using Linear's
  suggested `branchName` (locked: **agent proposes** the branch).

## A. Detection — pure, in Rust

A pure helper, single source of truth, unit-tested, auth-free. It lives in Rust
because Rust decides `--allowedTools` and which schema/prompt to use.

```rust
// Some("ENG-1234") for an id token or a linear.app issue URL; None otherwise.
pub fn detect_linear_ref(prompt: &str) -> Option<String>
```

- Matches a canonical ticket id `[A-Z][A-Z0-9]*-\d+` as a whole token, and a
  `linear.app/<org>/issue/<TEAM-123>-<slug>` URL (extract the `TEAM-123`).
- Lowercase / partial / non-canonical text is **not** a ref → falls through to
  the plain path. Mixed input ("ENG-1234, backend only") detects the ref and
  keeps the full prompt as the task description.

## B. Rust `deduce_worktree` — branch on the ref

The command keeps its signature (`prompt`, `repo_paths`) and its existing tail
(repo clamp + base-from-git). It branches once, up front:

```text
detect_linear_ref(prompt):
  None  -> existing call: SYSTEM_PROMPT + DEDUCE_SCHEMA, haiku, no tools   (UNCHANGED)
  Some(id) -> ticket call: SYSTEM_PROMPT_TICKET + DEDUCE_SCHEMA_TICKET,
              --allowedTools <linear-mcp>, [stronger model?],
              user prompt notes the detected id and asks the agent to fetch it
```

- **Two schemas, two system prompts.** The plain ones are untouched (no
  regression). The ticket variants add the three fields below and instruct the
  agent to fetch the ticket via the Linear MCP, use its title/description for the
  name/branch (**including the ticket id in both**), and return its canonical URL.
- **`--allowedTools` value, `--permission-mode`, and model** for the ticket path
  are the implementation-time unknowns in §F — pin them with a smoke test before
  wiring the UI.
- After parse + `validate_repo` + base-from-git (all unchanged), apply the
  **`sourceResolved` guardrail**: if a ref was detected but `source_resolved` is
  false, return `Err("couldn't resolve Linear ticket <id> …")` — never the
  fabricated params.
- **Guarantee the ticket id is in the name + branch (deterministic).** The agent
  is *instructed* to include the id, but "always" is enforced in Rust, not hoped
  for — applied right after base-from-git, just like base is. A pure helper

  ```rust
  // Returns value unchanged if it already contains id (case-insensitive), else "{id}-{value}".
  pub fn ensure_ref_prefix(value: &str, id: &str) -> String
  ```

  is applied to `branch` (with the id lowercased, e.g. `eng-1234-fix-login`) and
  to `name` (id as-is). This keeps "agent proposes the descriptive part" while
  making the id's presence a guarantee. It's a no-op when the agent already
  included the id (the common case), so it never double-prefixes.

### `DeducedWorktree` additions

Three new fields, all `#[serde(default)]` so the **plain path's narrower JSON
still deserializes** (Rust struct + mirrored TS type):

```jsonc
{
  // …existing: repoPath, name, branch, base, startCmd, address, reason…
  "ticketUrl":      "string — canonical Linear URL (empty when no ticket)",
  "ticketTitle":    "string — ticket title for the link label (empty when none)",
  "sourceResolved": "bool   — did the agent actually fetch the detected ticket?"
}
```

The extended schema marks these required (the ticket path must answer them); the
plain schema omits them entirely.

## C. Frontend — `NewWorktreeForm` (the panel)

The form already orchestrates deduce; the changes are small and additive.

- **`src/worktrees/api.ts`** — `DeducedWorktree` gains optional `ticketUrl?`,
  `ticketTitle?`, `sourceResolved?` (mirrors the serde defaults).
- **`runDeduce`** — unchanged call. On success, if `d.ticketUrl` is non-empty,
  stage `ticketLink = { label: d.ticketTitle || <id>, url: d.ticketUrl }` in
  state and include it in the banner.
- **Banner** — when a ticket was resolved, show its title + URL ("🎫 ENG-1234 …,
  link will be added").
- **`submit`** — thread `links: ticketLink ? [ticketLink] : []` into
  `makeWorktree` (it already accepts a partial `links`), so the created worktree
  carries the Linear link.
- **Errors** — the `sourceResolved=false` case comes back as a rejected promise
  and reuses the existing inline `deduceError` display. No new error UI. A failed
  ticket deduction leaves manual entry fully working (the throughline from
  SP1/SP2/SP3).

No source picker: the single existing prompt box auto-detects the ref (matches
the product spec's "single text input accepting a Linear ticket number or link…
or a plain prompt"). The one `deduce` button is unchanged; its result is the
preview/confirm step.

## D. Error handling (additions to the SP3 table)

| Failure | Behaviour |
|---|---|
| Ref detected, Linear MCP missing / unauthenticated | `sourceResolved=false` → inline "couldn't resolve Linear ticket <id> (is the Linear MCP connected?)"; manual entry still works |
| Ref detected, ticket not found / no access | same `sourceResolved=false` path |
| No ref in the prompt | existing plain-prompt path, completely unchanged |
| Non-canonical ref-looking text | regex matches only the canonical shape; otherwise treated as a plain prompt |

## E. Testing

Mirrors SP1/SP2/SP3: unit-test the pure/risky logic; manual for the GUI + live
MCP call.

- **Rust (pure):** `detect_linear_ref` (id / URL / none / embedded-in-text /
  lowercase-reject); `ensure_ref_prefix` (already-present → unchanged, no
  double-prefix; absent → prepended; case-insensitive match); extended-envelope
  parse incl. the new fields + their defaults on the plain path; the
  `sourceResolved=false → Err` guardrail.
- **Rust (manual, paid):** a live MCP-enabled `claude -p` smoke test that resolves
  the §F unknowns and confirms a real ticket is fetched and the URL returned.
- **TS:** ticket-link staging into `makeWorktree` (and the `DeducedWorktree`→form
  mapping if extracted to a pure helper).
- **Headless (agent-runnable):** `cargo test`, `cargo build`, `npm test`,
  `npx tsc --noEmit`, `npm run build`.
- **Manual GUI (user eyeballs):** paste `ENG-1234` → deduce → ticket title in the
  banner and fields filled from the ticket → edit if needed → Create → the
  worktree tile shows the Linear link. Then: paste a ref with the MCP
  disconnected → inline error, form still usable manually.

## F. Implementation-time unknowns (smoke-test first, like the JSON envelope was)

Resolve these with a quick paid `claude -p` smoke test **before** wiring the UI;
record the answers in the plan as "verified CLI facts" (as SP3 did):

1. **Does a user-scoped Linear MCP load for `claude -p` run from a neutral
   `temp_dir` cwd, and what exact `--allowedTools` token (the configured server
   name) and/or `--permission-mode` enables it non-interactively?** If
   user-scoped MCPs don't load headlessly, point the ticket call at a cwd/config
   that has it.
2. Is **haiku** reliable for MCP tool-use + forced structured output, or does the
   ticket path need a stronger model?
3. The Linear MCP's ticket-fetch tool + return shape — enough to name the fields
   the system prompt asks for (title, description, url).

## G. Extensibility — making "ways to kick off a task" cheap to add

This is a stated product goal ("easy to add ways to kick off a task"). The design
is shaped so the next source (GitHub, then Slack) is a **drop-in branch**, not a
re-architecture — but we **do not build the abstraction now** (YAGNI; Linear is
the only source). What this iteration commits to:

- **One detection point, one branch point.** Detection is isolated in pure
  `detect_*` helpers; `deduce_worktree` branches once on "which source, if any."
  Adding GitHub/Slack later = add a `detect_github_ref` / `detect_slack_ref`, a
  per-source system-prompt snippet naming its MCP, and the matching
  `--allowedTools` — the schema (`ticketUrl`/`ticketTitle`/`sourceResolved`
  generalises to "sourceUrl/sourceTitle/sourceResolved") and the
  link-population + banner code are **reused unchanged**.
- **Anticipated naming.** When the plan lands, prefer source-neutral names for
  the shared pieces (e.g. `source_resolved`, the staged link) so the GitHub/Slack
  iterations rename nothing. Keep Linear-specific names only inside the
  Linear-only `detect`/prompt code.

> Slack note (next-next iteration): a Slack permalink in the prompt would be the
> *third* branch here — same MCP-delegation shape (the user has a Slack MCP),
> same `sourceResolved` guardrail, same link auto-population. Out of scope now,
> but the §A/§B seam is deliberately the place it slots into.

## H. File-level change surface

- **Modify:** `src-tauri/src/deduce.rs` — `detect_linear_ref` (pure + tests); the
  ticket-path system prompt + extended schema consts; the ref branch in
  `deduce_worktree`; the `sourceResolved` guardrail; `DeducedWorktree` new fields.
- **Modify:** `src/worktrees/api.ts` — `DeducedWorktree` optional fields.
- **Modify:** `src/tiles/worktree/NewWorktreeForm.tsx` — stage the ticket link,
  banner note, thread `links` into `makeWorktree`.
- **Modify:** `CLAUDE.md` + `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`
  — as-built notes + status (Linear source type complete; GitHub/Slack next).
- **No new files, no new dependencies, no IPC signature changes.**

## Definition of done

- A Linear ref (`ENG-1234` or a `linear.app` URL) typed into the prompt is
  detected; the deduce call fetches the ticket via the Linear MCP and deduces
  name/branch from its content, with repo/base/host behaviour unchanged.
- The deduced worktree **name and branch always contain the ticket id**
  (agent-proposed, Rust-enforced), e.g. `eng-1234-fix-login`.
- The resolved ticket link is auto-added to the worktree's `links` on Create; the
  banner shows the resolved ticket.
- A detected-but-unresolved ticket (`sourceResolved=false`) surfaces inline and
  never produces fabricated params; the plain-prompt path is byte-identical and
  unaffected; manual entry always works.
- The §F unknowns are pinned by a smoke test and recorded in the plan.
- Rust pure-logic tests + TS tests green; app builds and launches.
- As-built notes + status updated; decomposition item 3 notes Linear done and
  GitHub/Slack as the next source-type iterations.
