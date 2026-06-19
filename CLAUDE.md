# Cockpit

A macOS desktop **dev cockpit**: a workspace that runs several live terminals in
organised tiles (and connected git worktrees), with side panels that pull in the
tools you'd otherwise app-switch to — Slack first, then Linear, GitHub, Calendar.

Working name: **cockpit** (easy to change).

---

## Product identity

- **Core job:** a terminal/worktree workspace for coding.
- **Secondary, but designed-for from day one:** an extensible panel system so
  integrations (Slack, Linear, GitHub, Calendar, …) can be added one at a time
  without re-architecting.
- The terminals are the heart; integrations are panels around them.

## Decisions made

| Decision | Choice | Why |
|----------|--------|-----|
| Shell / framework | **Tauri v2** | Lean & native (system webview, ~10–30 MB, low RAM, native window/menu/notifications). The Rust/web boundary is also a natural plugin seam. High transferable learning value (Rust). |
| Frontend | **React + TypeScript** | Already known → spend the learning budget on Rust/Tauri, keep the UI layer boring and productive. Largest ecosystem for the off-the-shelf pieces we need (tiling/dock layout, virtualized message lists). |
| Backend language | **Rust** | Tauri core; owns all stateful/privileged work. |
| Terminal display | **xterm.js** (canvas) in the webview | Battle-tested; offloads heavy text rendering from React. |
| PTY backend | **`portable-pty`** (Rust crate) | Spawns real PTYs in the Rust core, streams output to the webview over Tauri IPC. |
| Secrets storage | **macOS Keychain** (via Rust) | Native, secure token storage for OAuth credentials. |

### Stacks considered and rejected

- **Electron (TS/Node):** fastest to ship, biggest ecosystem, but ~100 MB+
  footprint and less native feel — contradicts the "lean & native" priority, and
  lower learning novelty.
- **Native Swift/SwiftUI:** most native, but terminal emulation is a heavier lift,
  web-flavoured integration panels fight the grain, and the learning is
  Apple-only (not transferable). Overkill for a panel/dashboard app.

### Frontend framework alternatives considered

- **Svelte 5 / Solid:** leaner output, good learning value — but a *third* new
  thing to learn alongside Rust + Tauri, and smaller ecosystems for the
  tiling/dock + message-list components we need. Revisit only if we want the
  frontend itself to be a learning axis.

## Priorities (ranked, drives tie-breaks)

1. **Lean & native** — small footprint, fast startup, native macOS feel.
2. **Learning value** — favour choices that teach transferable skills (Rust).
3. **Extensibility** — adding the Nth integration should be easy and isolated.

## Architecture (high level — in progress)

Two layers, one boundary:

- **Rust core** owns everything stateful and privileged: PTY processes, OS
  keychain, network/OAuth, background polling.
- **React webview** is a pure presentation + interaction layer, talking to the
  core only through Tauri IPC (`invoke` commands for request/response, an event
  stream for push data like terminal output or new Slack messages).

**Unifying pattern — "provider + panel":** every feature (a terminal, a Slack
panel, a GitHub panel) is the same shape — a Rust-side *provider* that emits a
stream of events and accepts commands, paired with a React-side *panel* that
renders them. Getting this one pattern right makes the Nth integration mechanical.

> Further sections (panel/layout system, terminal/PTY flow, integration model,
> state, error handling, testing) are still being designed — see
> `docs/superpowers/specs/` once the design doc is written.

## Code conventions

**This is a learning project — explain as you go.**

- At the **top of every file**, add a *concise* comment stating the file's role —
  one line unless more is genuinely needed for clarity.
- At the **top of each significant block of code** (a function, a non-obvious
  algorithm, a tricky wiring point), add a *concise* explanation of what it does
  and why — again, one line by default.
- Keep comments short and high-signal. Explain *role and intent*, not syntax.
  Don't narrate the obvious (`// loop over tiles`); do explain the non-obvious
  (`// reconcile: place tiles that exist in config but aren't yet in the layout`).

**Build the simplest thing that works — keep the codebase small.**

- Always make the *smallest* change that satisfies the requirement, as long as it
  doesn't compromise code quality.
- Especially for styling/layout: build the plainest version that functions. Don't
  polish visuals up front — we iterate to make things pretty and fluid *later*.
- Prefer fewer files, fewer dependencies, fewer abstractions until one is needed.
  A small, manageable codebase beats a feature-rich one we can't hold in our heads.

## As-built notes

- **Stack confirmed in code:** Tauri v2 + React **19** + TS (Vite), Rust core.
  dockview is **6.6.1** (themed via the `theme={themeLight}` prop, not a CSS
  class). Zustand for the live store. Vitest (frontend) + `cargo test` (Rust).
- **Settings live in** `~/Library/Application Support/com.cockpit.app/`:
  `cockpit.json` (portable user config) + `layout.json` (disposable geometry).
- **IPC surface** includes `load_settings`, `save_settings` (sub-project 1) plus
  the worktree commands added in sub-project 2: `create_worktree`,
  `pty_ensure`, `pty_attach`, `pty_write`, `pty_resize`, `pty_kill`; and
  `deduce_worktree` added in sub-project 3.
- **PTY provider** (`src-tauri/src/pty.rs`): registry keyed by `worktreeId:role`;
  output events emitted as `pty://{id}`; ~64 KB scrollback (circular, keeps
  newest); spawns a login shell; `host` and `claude` roles autostart their
  commands on first attach.
- **Git provider** (`src-tauri/src/worktree.rs`): runs real `git worktree add`
  for existing or new branches; managed root is `~/CockpitWorktrees/<repo>/<name>`;
  remove drops the model and kills PTYs but does **not** delete the directory on
  disk (preserves in-progress work).
- **Worktree composite tile** lives in `src/tiles/worktree/`: dropdown of recent
  worktrees, collapsible create-form, 3 xterm.js terminals (host / git / claude),
  editable links, status toggle. The `worktrees` array in `cockpit.json` is the
  persistent model; `worktree-1` is now in the default config so the tile appears
  on first launch.
- **URL opener** uses `openUrl` from `@tauri-apps/plugin-opener`.
- **`newInstance`** in the tile registry is a forward-looking seam, unused until
  an "add tile" UI lands.
- **Scaffold renamed:** crate, `productName`, and window title are now `cockpit`
  (bundle id `com.cockpit.app` unchanged).
- Missing/deleted worktree path is not pre-checked: each terminal pane shows an in-pane `[failed to start]` error and the header **remove** action is available (the dedicated "path not found" banner from the design spec §G is deferred).
- **`knownRepos`** in `cockpit.json`: a persisted list of known repos, each an object `{ path, host? }` where `host` is an optional saved default `{ startCmd, address }`. Managed via the inline `KnownReposEditor` (add/remove); store dedupes on add. The deserializer also accepts legacy bare-string entries so old/hand-edited `cockpit.json` files still load.
- **Deduce provider** (`src-tauri/src/deduce.rs`): builds a per-repo digest (package.json name/description/scripts + truncated README snippet up to 800 chars + the package manager inferred from the lockfile + a Tauri signal: `isTauri`/`devUrl` read from `src-tauri/tauri.conf.json`, so Tauri repos deduce `<pm> run tauri dev` + the real devUrl instead of the vite default), then shells out to `claude -p --output-format json --json-schema <inline-schema> --model claude-haiku-4-5` from a neutral cwd (temp dir, avoids loading the project's CLAUDE.md; reuses Claude Code auth — no API key). Hard 120s timeout via `wait-timeout`. Parses the top-level `structured_output` from the JSON envelope (checks `is_error`). Validates the returned `repoPath` against the known-repos list; rejects any invented path. Overrides the agent's `base` with the repo's git default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`); if the remote has no HEAD pointer the agent's guess is kept.
- **Form flow (sub-project 3):** prompt textarea + **deduce** button (disabled when `knownRepos` is empty or prompt is blank) → on success: pre-fills name/repoPath/branch/base/startCmd/address and shows a "deduced" banner (prompt text + picked repo + one-line reason). The repo's saved host default overrides the agent's guess for startCmd/address; the banner notes "host loaded from this repo's saved default" when that happens. A **"save host as default for this repo"** button persists the current startCmd/address into the repo's `knownRepos` entry for future deduce calls. All fields remain editable; **Create** is unchanged and always requires explicit user action. Inline error shows deduction failures without breaking manual entry. Deduce never creates anything ("never silent" guarantee).
- **Linear source type (source-type iteration 1):** `detect_linear_ref` (pure, no I/O) recognises a Linear ticket ref in the prompt — either a bare canonical id (`ENG-1234`, uppercase team prefix) or a `linear.app/…/issue/…` URL. When detected, `deduce_worktree` switches to an MCP-enabled `claude` call: adds `--allowedTools "mcp__linear"` and an extended system prompt + JSON schema (`sourceUrl`, `sourceTitle`, `sourceResolved` fields) so the agent can fetch the ticket via the user's Linear MCP — no in-app Linear auth, no Rust `linear.rs` module (that is the deferred sub-project-4 swap point). The model constant `LINEAR_MODEL = "claude-haiku-4-5"` and the tool filter `LINEAR_ALLOWED_TOOLS = "mcp__linear"` are **provisional starting guesses — not yet verified against a live Linear MCP connection** (Task 1's paid smoke test was deferred to the human). Guardrails on the ticket path: `sourceResolved=false` → Rust returns `Err` before any result reaches the UI, surfaced as inline error "couldn't resolve Linear ticket … (is the Linear MCP connected?)" — never fabricated params; `ensure_ref_prefix` guarantees the ticket id appears in both `name` and `branch` (case-insensitive check, prepends if absent; `branch` receives the **lowercase** id, `name` the **original-case** id — so branch may read `eng-1234-…` while name reads `ENG-1234 …`). The plain-prompt path is byte-identical to before (no `allowed_tools`, original schema/system-prompt). On Create, `sourceLinkFrom` returns null when `sourceUrl` is empty, otherwise converts `sourceUrl`/`sourceTitle` into a `WorktreeLink` staged into the worktree's `links`; the deduce banner shows "🎫 `<title>` — link will be added." when a ticket was resolved. **GUI + live acceptance is PENDING human eyeball** (the Linear MCP must be authenticated first).
- **GitHub source type (source-type iteration 2):** `detect_github_ref` (pure, in `src-tauri/src/github.rs`) recognises a GitHub PR or issue URL in the prompt. On a hit, `deduce_worktree` fetches the PR/issue via the already-authenticated `gh` CLI (`gh pr view --json …` / `gh issue view --json …`, no MCP, no new schema) and resolves `owner/repo` to a known repo deterministically by matching each repo's `origin` remote URL (inline error if the repo isn't in `knownRepos` — never a guess). The fetched title + body are folded into the plain agent call (no `--allowedTools`, no new system prompt — a richer user prompt only). After the agent returns, `apply_github_overrides` sets the authoritative fields: `repoPath` from the match; PR → `headRefName` as `branch`, `baseRefName` as `base`, `pr-<N>` pinned in name; issue → new branch + name both contain `issue-<N>`. The source-neutral rename (`sourceUrl`/`sourceTitle`/`sourceLinkFrom`) applies across all source types; `existingBranch` in `DeducedWorktree` drives the `BranchSpec` mode so the worktree checkout uses an existing branch for PRs. The resolved link auto-attaches on Create. Deferred per spec §G: remote-review-only mode (no local clone), filesystem auto-find, `owner/repo#N` shorthand, PR fast-path optimization. **`gh` field contract and headless tests verified; GUI + live acceptance is PENDING human eyeball.**

## Status

✅ **Sub-project 1 (layout shell + settings) — complete & merged to `main`.**
All tests green; GUI confirmed rendering. Plan:
`docs/superpowers/plans/2026-06-16-layout-shell.md`.

✅ **Sub-project 2 (worktree engine, manual) — complete.**
PTY provider, git provider, worktree composite tile, and default first-launch
instance all in place. 12 Rust tests + 14 JS tests green; Rust + Vite builds
clean. GUI acceptance pending human sign-off.

✅ **Sub-project 3 (smart new-worktree, plain prompt) — complete.**
`deduce_worktree` IPC command, `KnownReposEditor`, prompt → deduce → pre-fill → banner
flow. 19 Rust tests + 15 JS tests green; Rust + Vite builds clean. Manual GUI acceptance
pending human sign-off.

✅ **Source-type iteration 1 (Linear) — code complete & reviewed.**
`detect_linear_ref`, MCP-enabled ticket path, `sourceResolved` guardrail, `ensure_ref_prefix`,
ticket link auto-staged on Create. 28 Rust tests + 22 JS tests green; Rust + Vite builds clean.
Live + GUI acceptance **PENDING human eyeball** — the Linear MCP must be authenticated first;
`LINEAR_ALLOWED_TOOLS` + `LINEAR_MODEL` are provisional pending the live smoke test.

✅ **Source-type iteration 2 (GitHub) — code complete & reviewed.**
`detect_github_ref`, `gh`-CLI fetch (no MCP), `match_repo` via origin-remote, `apply_github_overrides`
(PR → existing branch + `pr-<N>` in name; issue → new branch with `issue-<N>`), source-neutral rename
(`sourceUrl`/`sourceTitle`/`sourceLinkFrom`), resolved link auto-staged on Create. 37 Rust tests + 22 JS
tests green; Rust + Vite builds clean. **GUI + live acceptance PENDING human eyeball.**

**Next:** source-type iteration 3 (Slack).
See `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`.
