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
  The UI is **hand-built views over a CSS design-token theme** (`src/theme/tokens.css`) —
  **dockview was removed** (it fought the fixed, designed layouts; see
  `docs/superpowers/specs/2026-06-23-worktrees-view-and-theme-design.md`). Zustand for the
  live store. Vitest (frontend) + `cargo test` (Rust).
- **Three views (`src/views/`):** `Cockpit` (themed placeholder — Worktrees replaced the old
  Main view), `Worktrees` (the MVP: 3 fixed column slots, each a `WorktreeColumn` showing one
  running worktree), and `Calm` (same columns, Claude pane only). The active view + the
  per-column **slot→worktree assignment** are **session-only** store state (not persisted; on
  load the first 3 ongoing worktrees auto-fill the slots). Each `WorktreePane` reuses the
  unchanged `useTerminal` hook and adds a chevron collapse (open panes flex-fill). `+ New
  worktree` opens `NewWorktreeModal`, which hosts the unchanged `NewWorktreeForm`. Chips
  (Linear/PR/issue/preview) derive from the worktree model; the **CI chip is a styled stub**
  (live detection deferred). The **Claude "Attention" highlight is live** (see the attention note below).
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
  for existing or new branches; managed root is `~/CockpitWorktrees/<repo>/<name>`.
  Teardown is real git cleanup now (see the four-action teardown note below): `remove_worktree`
  runs `git worktree remove [--force]` (with a `git worktree prune` fallback when the dir is
  already gone), `delete_branch` runs `git branch -D` (local only — never touches the remote),
  and `worktree_status` probes `git status --porcelain` for the dirty-confirm dialog.
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
- **Linear source type (source-type iteration 1):** `detect_linear_ref` (pure, no I/O) recognises a Linear ticket ref in the prompt — either a bare canonical id (`ENG-1234`, uppercase team prefix) or a `linear.app/…/issue/…` URL. When detected, `deduce_worktree` switches to an MCP-enabled `claude` call: adds `--allowedTools "mcp__linear"` and an extended system prompt + JSON schema (`sourceUrl`, `sourceTitle`, `sourceResolved` fields) so the agent can fetch the ticket via the user's Linear MCP — no in-app Linear auth, no Rust `linear.rs` module (that is the deferred sub-project-4 swap point). The model constant `LINEAR_MODEL = "claude-haiku-4-5"` and the tool filter `LINEAR_ALLOWED_TOOLS = "mcp__linear"` are **verified** against a live Linear MCP connection — a real ticket resolves via both a headless `claude -p` smoke and in-app deduce (`--allowedTools "mcp__linear"` + haiku, no `--permission-mode` needed). Guardrails on the ticket path: `sourceResolved=false` → Rust returns `Err` before any result reaches the UI, surfaced as inline error "couldn't resolve Linear ticket … (is the Linear MCP connected?)" — never fabricated params; `ensure_ref_prefix` guarantees the ticket id appears in both `name` and `branch` (case-insensitive check, prepends if absent; `branch` receives the **lowercase** id, `name` the **original-case** id — so branch may read `eng-1234-…` while name reads `ENG-1234 …`). The plain-prompt path is byte-identical to before (no `allowed_tools`, original schema/system-prompt). On Create, `sourceLinkFrom` returns null when `sourceUrl` is empty, otherwise converts `sourceUrl`/`sourceTitle` into a `WorktreeLink` staged into the worktree's `links`; the deduce banner shows "🔗 `<title>` — link will be added." when a ticket was resolved (the banner is source-aware since the GitHub iteration). **GUI + live acceptance verified** — in-app deduce of a real ticket resolves the fetch, fills the fields, and stages the link.
- **GitHub source type (source-type iteration 2):** `detect_github_ref` (pure, in `src-tauri/src/github.rs`) recognises a GitHub PR or issue URL in the prompt. On a hit, `deduce_worktree` first resolves `owner/repo` to a known repo deterministically by matching each repo's `origin` remote URL (fail-fast inline error if the repo isn't in `knownRepos` — never a guess), then fetches the PR/issue via the already-authenticated `gh` CLI (`gh pr view --json …` / `gh issue view --json …`, no MCP, no new schema). The fetch uses your **globally-active `gh` account**; if the repo is known locally but `gh` can't see it (e.g. a private repo while a different account is active in a multi-account setup), the error is wrapped with a hint to check `gh auth status` / `gh auth switch` (GitHub returns a bare "could not resolve repository" 404 in that case). The fetched title + body are folded into the plain agent call (no `--allowedTools`, no new system prompt — a richer user prompt only). After the agent returns, `apply_github_overrides` sets the authoritative fields: `repoPath` from the match; PR → `headRefName` as `branch`, `baseRefName` as `base`, `pr-<N>` pinned in name; issue → new branch + name both contain `issue-<N>`. The source-neutral rename (`sourceUrl`/`sourceTitle`/`sourceLinkFrom`) applies across all source types; `existingBranch` in `DeducedWorktree` drives the `BranchSpec` mode; for PRs the `BranchSpec` is `Pr { number, branch }` and `create_worktree` runs `git worktree add --detach <path>` then, inside the new worktree, `gh pr checkout <N>` (primary — sets up a push-tracking branch for an open PR, handles forks). If that fails because the live head branch is gone (a **merged PR whose branch was deleted**), it falls back to the immutable `git fetch origin refs/pull/<N>/head` + `git checkout -B <headRefName> FETCH_HEAD` — so open, merged, and fork PRs all check out. PR create is **idempotent**: an existing target worktree dir (e.g. a leftover from a prior failed checkout) is reused rather than erroring, and the `-B` checkout re-points the branch to the PR head on retry. The PR number + `headRefName` are threaded `deduce_worktree` → `DeducedWorktree.pr_number`/`branch` → frontend `prNumber`/`branch` → the `pr` BranchSpec on Create. The resolved link auto-attaches on Create. Deferred per spec §G: remote-review-only mode (no local clone), filesystem auto-find, `owner/repo#N` shorthand, PR fast-path optimization. **`gh` field contract and headless tests verified; GUI + live acceptance is PENDING human eyeball** (covers: a fresh/un-fetched PR and ideally a fork PR checking out correctly).
- **Slack source type (source-type iteration 3):** `detect_slack_ref` (pure, in `src-tauri/src/deduce.rs`) recognises a `*.slack.com/archives/…` permalink anywhere in the prompt — both the plain form (`/archives/<channel>/p<ts>`) and the thread-reply form (`?thread_ts=…&cid=…`) — by scanning whitespace-delimited tokens and trimming surrounding paste punctuation (`(),.`). On a hit, `deduce_worktree` runs a `claude` CLI call MCP-enabled with `--allowedTools SLACK_ALLOWED_TOOLS` (the claude.ai Slack connector's headless name `mcp__slack`, like `mcp__linear` — **not** the in-session tool-namespace UUID) plus `--permission-mode SLACK_PERMISSION_MODE` (`bypassPermissions` — the Slack connector gates its tool calls even when allow-listed, unlike Linear; the bypass is scoped to Slack tools by the `--allowedTools` filter) and `SLACK_MODEL` (`claude-haiku-4-5`), using the shared `DEDUCE_SCHEMA_SOURCE` schema (renamed from `DEDUCE_SCHEMA_TICKET`; value unchanged) plus a `SYSTEM_PROMPT_SLACK` that instructs the agent to fetch the message and its thread via the Slack MCP — no in-app Slack auth, no `slack.rs` (the deferred Rust Slack provider + Keychain-token path is the sub-project-4 swap point, the same place the future unread-messages tile's Web-API + Socket Mode provider lands). **Guardrail:** `sourceResolved=false` → inline error "couldn't resolve Slack message (is the Slack MCP connected?)" — never fabricated params. Rust overwrites `source_url` with the pasted permalink deterministically (the agent supplies only `sourceTitle`/`sourceResolved`). No id is pinned: Slack has no meaningful short id, so `ensure_ref_prefix` is NOT called; `existingBranch=false` and `prNumber=0` — a new branch with a fully agent-proposed name. The resolved Slack link auto-attaches to the worktree's `links` on Create; the banner shows "🔗 `<title>` — link will be added." The frontend is **unchanged** — the source-neutral seam from the GitHub iteration (`sourceUrl`/`sourceTitle`/`sourceResolved`, `sourceLinkFrom`, `existingBranch=false`, `prNumber=0`, banner, link-staging) handles Slack without modification. The plain / Linear / GitHub paths are byte-identical. **`SLACK_ALLOWED_TOOLS = "mcp__slack"`, `SLACK_PERMISSION_MODE = "bypassPermissions"`, and `SLACK_MODEL = "claude-haiku-4-5"` are pinned by a live smoke (2026-06-22)** — a real DM permalink resolved end-to-end via a headless `claude -p` (also confirming private/DM access and bare-permalink resolution, no channel+ts parsing). 41 Rust tests + 22 JS tests green; Rust + Vite builds clean. GUI end-to-end acceptance in the running app PENDING human eyeball.

- **Slot entities + Checkout + scratch terminals (existing-branch & scratch-terminals iteration):** a Worktrees slot now holds a **slot entity = worktree | scratch** (`resolveSlotEntity` in `src/views/slots.ts` looks an id up as a worktree first, then a scratch). **Scratch terminals** are session-only entities (`scratch-<n>` ids, `{ id, title }` in the store's `scratchTerminals` list + a monotonic `scratchSeq`; `addScratch`/`removeScratch`) — a single login-shell pane reusing the unchanged `pty_ensure` with `role="shell"`, `cwd=homeDir()`, no autostart (zero new Rust); they don't persist across restarts. The old `WorktreeColumn` is split into **`SlotColumn`** (shared chrome: status dot + picker + ⚙ Hide/Delete) rendering either **`WorktreeBody`** (chips/path/3 panes/links) or **`ScratchBody`** (one shell pane); Delete dispatches by kind (3 roles vs the single `shell` pty). The `clearWorktree` slot reducer was renamed **`clearEntity`** (entity-generic). **Header create buttons** are now `Worktree · Checkout · Terminal` (in `.app__actions`): Worktree → deduce modal, Checkout → existing-branch modal mode, Terminal → instant `addScratch()`. The **modal** gained a `Deduce · Existing branch` segmented control hosting the unchanged `NewWorktreeForm` or the new `ExistingBranchForm`. **Checkout flow** reuses `BranchSpec::Existing`; the one new Rust command **`list_branches`** runs `git for-each-ref --sort=-committerdate refs/heads/` (recency-sorted, pure `parse_branch_lines`) and cross-references `git worktree list --porcelain` (pure `parse_worktree_branches` + `mark_checked_out`) so branches already checked out elsewhere are returned with `checkedOut`/`checkedOutPath` and **disabled in the picker** with a "· checked out" tag (git refuses to worktree-add those); create also surfaces a plain-English fallback if a branch is claimed after listing. **Theme:** form-control styling (`input`/`select`/`textarea` + a themed select chevron) was lifted to the **global baseline in `src/theme/tokens.css`** so every form — and any future one — inherits the dark look with no extra classes (`.wt-col__picker`'s `background:none;border:none` keeps it bespoke; xterm's helper textarea is excluded). **GUI + live acceptance verified.** Deferred: remote-branch checkout in the picker (tracking branch); persisting scratch across restarts; centralizing the empty-host shape; a modal-scoped button theme. Spec: `docs/superpowers/specs/2026-06-24-existing-branch-and-scratch-terminals-design.md`; plan: `docs/superpowers/plans/2026-06-24-existing-branch-and-scratch-terminals.md`.

- **Claude attention highlight (terminal-bell detection) — live & GUI-verified.** Detection is the **terminal bell**: `useTerminal` (`src/worktrees/useTerminal.ts`) hooks xterm's built-in `term.onBell` and, for **attention roles only** (`isAttentionRole` in `src/worktrees/ptyId.ts` → `claude` | scratch `shell`; host/git excluded), marks the pane on a live BEL. A `bellLive` flag (set true right after the scrollback replay write) gates out BEL bytes already sitting in replayed scrollback. State is a **session-only** store slice keyed by `ptyId` (`attention: Record<string, true>` + `markAttention`/`clearAttention` in `src/settings/store.ts`; not persisted). Consumers read it: `WorktreePane` applies `.wt-pane--attention` (warm-red border + glow) and renders the `wt-attention` badge; `SlotColumn` tints the column icon for the slot's claude/shell pane. **Cleared only on real input** — `term.onData` (the user typing a response) and on `restart`; deliberately **not** on focus/window-switch (that cleared it before the user noticed). **No Rust changes** — `pty.rs` already streams the raw bytes and xterm parses the bell. Theme: `--attention-warm` (#ef7a5f, warm coral-red) + `--attention-warm-rgb` in `tokens.css`; the badge + column-icon tint were unified onto it. **One-time user prerequisite:** Claude Code must emit the bell — set `preferredNotifChannel: "terminal_bell"` in `~/.claude/settings.json` (default `auto` sends no bell in the webview terminal). Claude rings after a short idle interval (not the instant a prompt appears), so the glow has an inherent brief delay — that latency is Claude's, not ours (the in-app path is synchronous: BEL → IPC → `onBell` → store → render). README "Claude Code setup" documents the prerequisite. 76 JS tests green (`ptyId.test.ts` covers `isAttentionRole` + id format); Rust + Vite builds clean.

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
Live + GUI acceptance **verified** — in-app deduce of a real ticket resolves via the Linear MCP;
`LINEAR_ALLOWED_TOOLS = "mcp__linear"` + `LINEAR_MODEL = "claude-haiku-4-5"` pinned (no `--permission-mode` needed).

✅ **Source-type iteration 2 (GitHub) — code complete & reviewed.**
`detect_github_ref`, `gh`-CLI fetch (no MCP), `match_repo` via origin-remote, `apply_github_overrides`
(PR → `BranchSpec::Pr { number }` + `pr-<N>` in name; issue → new branch with `issue-<N>`), source-neutral
rename (`sourceUrl`/`sourceTitle`/`sourceLinkFrom`), resolved link auto-staged on Create. PR checkout is
fork-safe: `git worktree add --detach` then `gh pr checkout <N>` inside the worktree; `pr_number` threaded
deduce → frontend → `BranchSpec`. 38 Rust tests + 22 JS tests green; Rust + Vite builds clean.
**GUI + live acceptance PENDING human eyeball** (fresh/un-fetched PR and ideally a fork PR).

✅ **Source-type iteration 3 (Slack) — code complete. All three source types done.**
`detect_slack_ref`, MCP-enabled message+thread fetch via `SLACK_ALLOWED_TOOLS`/`SLACK_MODEL`, `DEDUCE_SCHEMA_SOURCE`
rename, `sourceResolved` guardrail, deterministic `source_url` from the pasted permalink, no id pinning (new
agent-named branch), resolved Slack link auto-staged on Create. Frontend unchanged (source-neutral seam reused).
41 Rust tests + 22 JS tests green; Rust + Vite builds clean. **`SLACK_ALLOWED_TOOLS = "mcp__slack"`,
`SLACK_PERMISSION_MODE = "bypassPermissions"`, `SLACK_MODEL = "claude-haiku-4-5"` pinned by a live smoke
(2026-06-22)** — a real DM permalink resolved end-to-end (private/DM access + bare-permalink resolution confirmed).
The Slack connector needs the permission bypass even when allow-listed (Linear does not). GUI end-to-end
acceptance in the running app PENDING human eyeball.

✅ **Existing-branch + scratch terminals iteration — complete & merged to `main`.**
Slot entities (worktree | scratch), `SlotColumn`/`WorktreeBody`/`ScratchBody`, the Checkout flow with
`list_branches` (recency-sorted, already-checked-out branches disabled), instant scratch login-shells, the
`Worktree · Checkout · Terminal` header, and the global form-control theme baseline. 46 Rust tests + 43 JS
tests green; Rust + Vite builds clean. **GUI + live acceptance verified.**

✅ **Sub-project 4 (auth manager + Slack unread tile) — code complete & merged to `main`. First real provider+panel instance.**
The deferred `slack.rs` Rust provider swap point is now built (the deduce flow still uses the Slack MCP; this is a
separate in-app provider). **Keychain** (`src-tauri/src/keychain.rs`): generic `TokenStore` trait + `KeyringStore`
(real, `keyring` v3 `apple-native`) + a `#[cfg(test)]` `MemoryStore` fake; service `com.cockpit.app.slack`, accounts
`user_token`/`client_secret`. **Slack provider** (`src-tauri/src/slack.rs`): browser OAuth via a transient `tiny_http`
loopback server on ports 9000-9009 (`oauth.v2.access` → **`xoxp` user token**, stored in Keychain), a blocking `ureq`
Web API client, and a background poll thread (~30s + on-window-focus `slack_refresh`) emitting `slack://unread`
snapshots. **At-most-one poll thread** is guaranteed by a generation counter (`poll_gen: Arc<AtomicU64>`): each
`start_polling` takes `fetch_add(1)+1` and exits when the counter moves on; `slack_disconnect` bumps it to stop the
live thread. **Mutex discipline:** the state guard is cloned-then-dropped before every network call (verified). 9
commands (`slack_set_credentials/_set_watched/_connect/_disconnect/_status/_snapshot/_refresh/_list_conversations/_init`)
+ `auth::list_connections` (a connections registry seam SP5 reuses; the single-service UI reads `slack_status` directly).
**Secrets never touch JSON** — `cockpit.json` holds only `integrations.slack = { clientId?, watchedChannelIds }`
(`#[serde(default)]`, back-compat); the `xoxp` token + `client_secret` live in Keychain only; no third-party server
(talks directly to Slack). **Frontend** (`src/tiles/slack/`): `SlackTile` (Cockpit-view left TILES column; subscribes
to `slack://unread`, first paint from `slack_snapshot`, states: disconnected CTA / "All caught up" / rows / error;
row click → `openUrl` Slack deep link), pure `time.ts`/`rows.ts` helpers (tested), `SlackConnections` (Settings →
Connections: credentials, connect/disconnect, watched-channels picker; buttons themed via the `nw-form` idiom).
`App.tsx` hydrates the provider via `slack_init` after settings load (starts polling if a token already exists). One-time
user setup: register your own Slack app, add User Token Scopes + redirect `http://localhost:9000-9009/callback`, paste
client id/secret. 60 Rust + 53 JS tests green; builds warning-free. Spec: `docs/superpowers/specs/2026-06-27-slack-tile-and-auth-manager-design.md`;
plan: `docs/superpowers/plans/2026-06-27-slack-tile-and-auth-manager.md`.
**Unread Web API field paths PINNED (2026-07-01 live smoke + bugfix):** `conversations.info` does **NOT** return
`unread_count`/`unread_count_display` (both absent) — the original `parse_conversation` read `unread_count_display`,
so the count was always 0 and the tile never showed anything. Fixed: unread is now derived from `last_read` (returned
by `conversations.info`) vs a `conversations.history` window (`limit=50`) — `unread_count` = messages with
`ts > last_read` (fixed-width `epoch.micros`, lexicographic compare); newest message drives the preview. Verified live
against a real unread. **Still PENDING human GUI smoke:** verify the OAuth round-trip and that the tile renders watched
unread + preview + relative time and the row links out. Note: the tile only shows **watched** channels, so a channel
with unreads must be added via the watched-channels picker first. **Deferred follow-ups:** resolve a display name (status shows raw `U…` id); add a CSRF
`state` param to the OAuth flow (SP5 Linear OAuth will copy this template); Socket Mode realtime push (polling-only by
design — see spec "Why polling, not Socket Mode"); a few hardcoded CSS values; skip per-conversation `info` errors for
stale watched ids.

- **Slack tile: opt-in DMs + searchable picker + robust unread + refresh (2026-07-01, merged to `main`).** Adds
direct-message tracking, a searchable picker, a manual refresh, and fixes two Slack-provider bugs. **Supersedes** the
older "watched channels only" / 50-message-window notes above.
  - **DMs are OPT-IN, not auto-tracked — and why.** A first attempt auto-discovered every DM each poll cycle
    (`users.conversations` types=im,mpim → merge with watched → poll each). But that method returns **all historical
    DMs** (130 on the real account), and Slack exposes **no cheap per-conversation unread or recency signal** and **no
    `client.counts`-style aggregate endpoint for user tokens** (verified against docs.slack.dev). Every DM must be probed
    with `conversations.info` + `.history` (2 Tier-3 calls each), so auto-tracking fired ~260 calls/cycle in a sub-second
    burst → **Slack `429`**, and conversations were silently dropped. **Decision:** DMs are opt-in. `watched` is again the
    single source of truth (channels **and** DMs); only the user's selection is polled — small, bounded, never bursts.
    `discover_dm_ids`/`merge_poll_ids`/`MAX_POLLED_DMS` were removed. (Cheap "new-DM detection" via an im-id set-diff was
    considered and **deferred** — it's undocumented whether a new inbound DM surfaces as a new `im` id, and it wouldn't
    catch new unread in *existing* DMs anyway.)
  - **Picker now lists channels + DMs, all opt-in, searchable.** `slack_list_conversations` requests
    `public_channel,private_channel,im,mpim` again; pure tested `list_row` builds each `ConversationMeta`. DM names in the
    picker come from the **in-memory `user_names` cache** (no per-DM `users.info` at list time → no burst), falling back to
    the partner user-id. Frontend: pure `filterConversations(convs, query)` (`src/tiles/slack/watchFilter.ts`, tested)
    backs a search box above the list in `SlackConnections.tsx`; rows show `#`/`@` by kind. The orphan-prune (added when
    the picker was briefly channels-only) was removed — DM ids are valid selections again.
  - **DM name resolution (live).** `poll_once` resolves a 1:1 DM partner's display name via `resolve_user_name`
    (`users.info`, cached in `SlackState.user_names` — in-memory only); group DMs keep Slack's synthetic `mpdm-…` name.
    `parse_conversation` gained an `im_name: Option<&str>` param (pure; falls back to id).
  - **Unread bugfix (marked-unread of any age).** History is now fetched with **`oldest=last_read`** (inclusive=false)
    instead of a fixed `limit=50` window. Marking a message unread **rewinds** Slack's read cursor arbitrarily far back;
    the old window missed those. `oldest=last_read` returns *exactly* the unread set regardless of age.
  - **`429` safety net.** `api_get` now honors the `Retry-After` header on a 429 (sleep ≤30s, retry once) — a transient
    throttle becomes a brief pause, not a dropped conversation + error banner.
  - **Refresh button** on the tile (`SlackTile.tsx`): manual re-poll via the existing `slack_refresh`, with a spinning
    `RestartIcon` while in flight; disabled when disconnected/refreshing.
  - **Config note:** DMs are stored as their `D…` conversation ids in `integrations.slack.watchedChannelIds` (same field
    as channels — the id kind is opaque to storage). 72 Rust + 80 JS tests green; Rust + Vite builds clean.
  - **PENDING human GUI smoke:** confirm no `429`, the picker lists DMs (with `@`) + search finds them, and a selected
    DM's unread shows with the partner's name + preview.

✅ **To Do + Timer tiles (+ shared `<Tile>` shell) — complete & merged to `main`.** A reusable **`<Tile>`** chrome shell
(`src/tiles/Tile.tsx` — header `icon · TITLE · actions` over a bordered body; `SlackTile` was refactored onto it) now
backs all tiles. Two local, no-auth **center-column** widgets: a **Timer** (`src/tiles/timer/` — a session-only countdown,
25-min default, Start/Pause/Reset, `formatTime` tested; nothing persisted) and a **To Do** list (`src/tiles/todo/` —
3-state items `todo → in_progress → done` that **cycle on click and wrap**, sections hidden when empty, add/delete;
`nextState`/`groupByState` tested). To Do **persists** in `cockpit.json` via a new `todos: TodoItem[]` field
(`{ id, text, state }`, ids `crypto.randomUUID()`, `#[serde(default)]` back-compat); store actions `addTodo`/`cycleTodo`/`removeTodo`.
Spec/plan: `docs/superpowers/{specs,plans}/2026-06-27-todo-and-timer-tiles*`.

- **To Do tile: inline edit + drag-reorder (2026-07-03).** Todos are now **editable inline** — click the `.todo__text`
  span → it becomes an `<input>` (autoFocus, seeded); **Enter/blur saves, Escape reverts, empty save deletes**
  (the delete-on-empty rule lives in the store's `editTodo`, not the UI). Rows are **reorderable within their section**
  via **native HTML5 DnD** (no library): each row is `draggable={editingId !== t.id}`, `onDragOver` calls
  `e.preventDefault()`, dropping calls `reorderTodo(draggedId, targetId)`. The section constraint is enforced in the
  **pure tested helper `reorderWithinState`** (`todo.ts`) — a **no-op** unless both ids exist, differ, and share the
  same `state` (cross-section drags change nothing; state is still changed only by the glyph click). Insert semantics:
  insert-after on move-down, insert-at on move-up (standard DnD idiom). A `dragOverId` local state drives a
  `.todo__row--drop-target` top-border highlight; `cursor: grab` on rows. **No schema change** — order is intrinsic
  to the `todos` array. New store actions `editTodo(id,text)` / `reorderTodo(draggedId,targetId)`. 96 JS tests green
  (5 new `reorderWithinState` cases); tsc + Vite build clean. **GUI acceptance PENDING human eyeball.**
  Spec/plan: `docs/superpowers/{specs,plans}/2026-07-03-todo-inline-edit-and-reorder*`.

✅ **Cockpit worktree column — complete & merged to `main`.** The Cockpit view's **right column** is now a worktree pane,
reusing `SlotColumn` (its selection was refactored to be **prop-driven** — `value` + `onSelect` — so one component backs
the Worktrees view's session slots, the Calm view, and the Cockpit view's **persisted** slot). New persisted
`cockpitWorktreeId` field in `cockpit.json` (`#[serde(default)]`, omitted when cleared); store action `setCockpitWorktree`.
Empty until assigned (the existing `SlotColumn` empty body). **View-dependent placement** (`placeNewEntity(id, view)`, the
active `view` threaded from `App` into the Terminal button + `NewWorktreeModal`): creating on the **Cockpit** view sets the
right-column slot (replace) + fills a free Worktrees slot if any (no eviction); creating on the **Worktrees/Calm** view fills
a free slot else replaces the last *visible* slot, Cockpit untouched. New pure helper `fillFreeSlot` (no-eviction) +
`visibleCount`-aware `assignNewWorktree`; `removeWorktree`/`removeScratch` clear `cockpitWorktreeId` too; `addScratch` is
create-only (placement is `placeNewEntity`'s job). Right column is `500px` wide. GUI-approved. Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-29-cockpit-worktree-column*`.

✅ **Worktree teardown actions (Close/Pause/Delete/Wipe) — complete & merged to `main`. Fixes a major bug.** The
slot column's old `Hide`/`Delete` never ran `git worktree remove`, so git's `.git/worktrees/<ref>` registration
survived and the branch stayed checked out there — uncheckoutable anywhere else. The gear menu now has **four
cumulative actions**, each removing one more attached thing: **Close** (unassign slot) ⊂ **Pause** (+ kill the 3
PTYs; keep model/dir/branch, re-selectable) ⊂ **Delete** (+ `git worktree remove [--force]` + drop model; **branch
kept**) ⊂ **Wipe** (+ `git branch -D` — **local branch only, remote untouched**). Scratch entities get only
Close + Delete (no git). **Delete/Wipe open `TeardownConfirm`** (reuses `<Modal>`), which probes dirtiness via
`worktree_status` (`git status --porcelain`; missing dir → `{exists:false,dirty:false}`, git error on an existing
dir → `dirty:true` safe default), warns if dirty, and **force-removes only on confirm** (Confirm disabled until the
probe returns; scrim-dismiss blocked while busy). Three new Rust commands in `worktree.rs` (`worktree_status`,
`remove_worktree`, `delete_branch`) with pure tested arg-builders (`worktree_remove_args`, `delete_branch_args`);
`remove_worktree` falls back to `git worktree prune` when the dir is already gone (deregisters the stale entry — the
core fix). Frontend: typed `api.ts` wrappers (`removeWorktreeGit` named to avoid colliding with the store's
model-only `removeWorktree`), a **dependency-injected `teardownWorktree` helper** in `src/worktrees/teardown.ts`
(no React — unit-tested for ordering [PTYs killed before remove] and error handling [remove failure keeps the model
& propagates; branch-delete failure is a non-fatal warning, model still dropped]). **Icons:** new shared SVG glyphs
in `views/icons.tsx` — Close ✕ · Pause ∥ · Delete 🗑 (Bin) · Wipe 👻 (Ghost); the menu rows gained roomy clickable
padding. **`GearIcon` was an 8-ray sun, not a cog** — replaced with a true toothed gear (this was the "brightness
icon" across the top banner + slot column); the Slack tile's unicode `⚙` switched to the same shared `GearIcon` so
all three settings affordances match. **Wrap-up:** force-removed 5 pre-existing orphaned worktrees (branches
preserved) so we start clean. 67 Rust + 74 JS tests green; builds clean. **GUI-approved.** Spec:
`docs/superpowers/specs/2026-06-29-worktree-teardown-actions-design.md`.

✅ **Cockpit Diff tab — complete & merged to `main`. GUI-approved.** The Cockpit view's **centre column** now
has a `Home | Diff` tab bar (`CockpitView.tsx`; underlined-active `.cockpit-view__tab*` styling): **Home** shows
the local widgets (Todo/Timer), **Diff** shows the **right-column** worktree's (`cockpitWorktreeId`) branch-vs-base
diff, or a "Select a worktree…" message when the right column is empty/holds a scratch. Tab state is **session-only**
(defaults to Home). This realises the product spec's centre-column "🌶️ diff" override (§Centre). The worktree column
(`SlotColumn`/`WorktreeBody`/`WorktreeColumn.css`) is **untouched** — terminals only. *(First cut placed the tabs in the
worktree column; moved to the centre to match the design.)*
- **Diff scope:** `git diff --merge-base <base>` in the worktree dir — diffs the merge-base of `base..HEAD` against the
  **working tree**, so it captures both committed changes and Claude's **uncommitted** edits ("what does this branch
  contain right now"). `base` is **not** persisted: the frontend passes `base=""` and the backend derives the repo
  default branch from `origin/HEAD` (a self-contained `symbolic-ref` helper in `worktree.rs`, decoupled from
  `deduce.rs`); no `origin/HEAD` → inline error.
- **Backend (`src-tauri/src/worktree.rs`, mirrors `worktree_status`):** pure tested `diff_stat_args`
  (`diff --merge-base <base> --numstat`), `file_diff_args`, `parse_numstat` (binary files → `-`/`-` → `binary:true`,
  0 counts); structs `DiffFile`/`DiffResult` (`camelCase`); private `repo_default_branch` + `resolve_base`; commands
  `worktree_diff(worktreePath, repoPath, base)` and `worktree_file_diff(…, path)` (raw patch, fetched lazily on expand),
  both registered in `lib.rs`.
- **Frontend:** `DiffView.tsx` (fetch on mount + manual refresh with a spinning `RestartIcon` + an `as of HH:MM:SS`
  timestamp — **snapshot only, no polling**; live updates deferred to the future live-signals provider); pure tested
  `diffLines.ts` `parseHunks` (classifies `+`/`-`/`@@`/context, drops `diff --git`/`index`/`---`/`+++`/rename headers)
  colorized via `--diff-add`/`--diff-del` tokens; `api.ts` `worktreeDiff`/`worktreeFileDiff` wrappers + `DiffFile`/
  `DiffResult` types. Empty diff → "No changes vs <base>"; errors surface inline (git stderr). 30 Rust (6 new) + 85 JS
  (5 new) tests green; Rust + Vite builds clean. Spec:
  `docs/superpowers/specs/2026-07-03-cockpit-diff-tab-design.md`.

✅ **Instant, non-blocking Deduce flow (2026-07-06).** The old blocking Deduce ceremony (open modal → click
Deduce, wait 15–43s staring at it → review pre-filled fields + banner → click Create, wait on git) is **replaced**:
the **Worktree** modal is now just a **prompt textarea + Create** (no fields, no separate Deduce step, no
review/confirm). On submit the **modal closes immediately** and a **spinning pending tile** claims a slot; the
`deduce_worktree` → `create_worktree` chain runs in the **background** (non-blocking — Tauri runs each `invoke` on
its own thread, so awaiting from JS doesn't block the webview; **no Rust changes**). When create resolves, the real
worktree **swaps into the same slot in place**. On failure the tile is discarded and the modal **reopens with the
prompt pre-filled + the error**. **Checkout / existing-branch flow is untouched.**
  - **Pending entity** = a third session-only `SlotEntity` kind (`{ kind:"pending"; pending }`), mirroring the
    `scratchTerminals` slice: `PendingWorktree { id:`pending-<n>`, prompt, status:"deducing"|"creating", view }` in
    `src/views/slots.ts`; `resolveSlotEntity` gained a defaulted 4th `pending` arg (3-arg callers still compile). New
    pure `swapSlotId(slots, from, to)` (1:1 in-place replacement — keeps the tile in the SAME slot; chosen over
    re-running `placeNewEntity`, which could relocate/evict if the layout changed during the ~30s deduce).
  - **Orchestration lives in the store** (`startDeduceWorktree(prompt, view)` in `src/settings/store.ts`), not the
    form's local async — so it survives the modal closing. It places a `pending-<n>` via the existing
    `placeNewEntity`, then a fire-and-forget async: `deduceWorktree` → (guard: pending still live?) → status→creating
    → resolve host from the repo's saved default (same precedence as the old `runDeduce`) → `branchSpecFrom` →
    `createWorktree` → (guard) → `addWorktree(makeWorktree(...))` + `swapSlotId(pending→real)` + swap
    `cockpitWorktreeId` if held + drop the pending entity. **catch:** drop pending, `clearEntity` its slot, set
    session-only `worktreeError = { prompt, message }`. `isLive()` guards handle the user repicking/closing the slot
    mid-flight (abandon quietly; an orphaned git worktree in the rare post-create removal is accepted, YAGNI —
    **no cancel button**).
  - **Reopen-on-failure:** `App.tsx` watches `worktreeError` (`useEffect` → `setCreating("deduce")`); modal `onClose`
    calls `clearWorktreeError()` so a stale error can't re-trigger. The trimmed `NewWorktreeForm` seeds its prompt
    from `worktreeError?.prompt` and shows `worktreeError.message`.
  - **Rendering:** new `src/views/worktree-column/PendingBody.tsx` (CSS spinner + `deducing…`/`creating…` +
    prompt); `SlotColumn` resolves pending, renders `PendingBody`, **gates the gear menu off** for pending, and shows
    a synthetic disabled `<option>` in the picker (a pending id isn't in the worktree/scratch lists). CSS spinner
    (`.wt-col__spinner` + `@keyframes wt-spin`) in `WorktreeColumn.css`. `CockpitView` reuses `SlotColumn` so it
    renders pending tiles too.
  - `NewWorktreeForm` was gutted to a prompt-only form (filename kept); `NewWorktreeModal` deduce branch now
    `<NewWorktreeForm view onClose />` (no `onCreated` — the store owns placement). `FORM_DEFAULTS`/`branchSpecFrom`/
    `sourceLinkFrom`/`makeWorktree` still exported (reused by the store action + model tests). 104 JS (+8) + 80 Rust
    tests green; tsc + Vite + cargo builds clean. **GUI end-to-end acceptance PENDING human eyeball** (native macOS
    window can't be driven headlessly): confirm instant close + spinner, `deducing…`→`creating…`→real tile in the
    same slot, other-tile interaction while spinning, and the failure-reopen path.
  - **Unified New modal + single `+ New` nav button (same session).** The header's three buttons (`Worktree ·
    Checkout · Terminal`) collapsed into one **`+ New`** (`App.tsx`; `creating` state is now a plain boolean, no
    `initialMode`). `NewWorktreeModal` dropped its Deduce/Existing-branch segmented toggle and now **stacks one
    panel**: `NewWorktreeForm` (prompt + **Create**) → `<hr className="nw-modal__sep">` → `ExistingBranchForm`
    (repo→branch→name→Create) → separator → a **Terminal** button (`placeNewEntity(addScratch(), view)` — the old
    top-nav wiring, relocated). **All three actions close the modal on success.** `NewWorktreeForm` lost its
    redundant `cancel` button (the modal owns close/scrim). CSS: removed `.nw-modal__mode*`; added `.nw-modal__sep`
    + `.nw-modal__terminal` in `Modal.css`. Pure UI restructure — no store/Rust changes; 104 JS tests still green.
    Each section now has a **bold icon heading** (`SectionHeading` in `NewWorktreeModal`, `.nw-modal__heading`):
    **Deduce** (`wt-ico--claude`), **Checkout** (`wt-ico--branch`), **Terminal** (`wt-ico--terminal`) — reusing the
    slot columns' masked-PNG glyphs. All three Create buttons are **full-width accent** and identical (the terminal
    button copy is now "Create"; `.eb-form__create` widened; the grid-child `.nw-form__create` already stretched).
    **Cmd/Ctrl+N** opens the modal (a second global `keydown` effect in `App.tsx`, mirroring the zoom shortcuts;
    `preventDefault` claims the combo from the browser's "new window"). **Escape closes any modal** — a `keydown`
    effect in the shared `Modal` component (`views/Modal.tsx`), so it's universal (New worktree, Settings,
    TeardownConfirm); it invokes the caller's `onClose`, so a guarded no-op (TeardownConfirm while busy) is respected.

**Next / resuming work — read `docs/ROADMAP.md` first.** It is the single prioritized backlog, split into
**main build sub-projects** (the big sequential arc — sub-project 5 onward: Linear tile, then GitHub/Calendar
tiles, reusing the SP4 provider+panel + Keychain seam) and **smaller iterations** (scoped polish/enhancements). When
the user says "let's continue" (or similar), open `docs/ROADMAP.md` and present its current items grouped that
way — main sub-projects first, then smaller iterations — before proposing what to pick up.
Product vision: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`.
