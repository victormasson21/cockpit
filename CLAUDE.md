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

## Git workflow

**Trunk commits are permitted here.** Commit straight to `main`; do not branch first.
This is a solo desktop app with no reviewers and no deploy gate, so a branch adds a
merge step and guards nothing. Use a `feature/` branch only when the work wants one —
a long spike, or a change you may abandon.

Nothing else is relaxed. The build check and the secrets scan run before every commit,
and every push is confirmed.

## As-built notes

- **Stack confirmed in code:** Tauri v2 + React **19** + TS (Vite), Rust core.
  The UI is **hand-built views over a CSS design-token theme** (`src/theme/tokens.css`) —
  **dockview was removed** (it fought the fixed, designed layouts; see
  `docs/superpowers/specs/2026-06-23-worktrees-view-and-theme-design.md`). Zustand for the
  live store. Vitest (frontend) + `cargo test` (Rust).
- **Two views (`src/views/`):** `Cockpit` (themed placeholder — Worktrees replaced the old
  Main view) and `Worktrees` (the MVP: 3 fixed column slots, each a `WorktreeColumn` showing one
  running worktree). The active view + the
  per-column **slot→worktree assignment** are **session-only** store state (not persisted; on
  load the first 3 ongoing worktrees auto-fill the slots). Each `WorktreePane` reuses the
  unchanged `useTerminal` hook and adds a chevron collapse (open panes flex-fill). Panes are
  **Claude-first + on-demand** since 2026-07-10 (see the lazy-panes note): one Claude pane, with
  host/extras added via Run/Add — the old always-on host+git panes are gone. `+ New
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
  already gone), `delete_branch` runs `git branch -D` (local only — never touches the remote; an
  already-deleted branch is a no-op success — fixed 2026-07-08: it used to surface git's "branch
  not found" as a scary warning when a Claude session had self-cleaned at wrap-up),
  and `worktree_status` probes `git status --porcelain` for the dirty-confirm dialog. The confirm
  dialog is the gate: once approved, teardown reaches its end state even when the worktree/branch is
  already gone — `remove_worktree`'s fallback (fixed 2026-07-09) also covers a dir that *exists* but
  is no longer a working tree (external cleanup, then a dev process recreating cache files like
  `.vite/`): it prunes the stale registration and deletes the leftover dir instead of surfacing
  git's "is not a working tree" error.
- **Worktree composite tile** lives in `src/tiles/worktree/`: dropdown of recent
  worktrees, collapsible create-form, xterm.js terminals (originally host / git / claude;
  since 2026-07-10 it's Claude-first with host/extras on demand — see the lazy-panes note),
  editable links, status toggle. The `worktrees` array in `cockpit.json` is the
  persistent model; `worktree-1` is now in the default config so the tile appears
  on first launch.
- **URL opener** uses `openUrl` from `@tauri-apps/plugin-opener`.
- **`newInstance`** in the tile registry is a forward-looking seam, unused until
  an "add tile" UI lands.
- **Scaffold renamed:** crate, `productName`, and window title are now `cockpit`
  (bundle id `com.cockpit.app` unchanged).
- Missing/deleted worktree path is not pre-checked: each terminal pane shows an in-pane `[failed to start]` error and the header **remove** action is available (the dedicated "path not found" banner from the design spec §G is deferred).
- **`knownRepos`** in `cockpit.json`: a persisted list of known repos, each an object `{ path, host? }` where `host` is an optional saved default `{ startCmd, address }`. Managed via the inline `KnownReposEditor` (add/remove); store dedupes on add. The deserializer also accepts legacy bare-string entries so old/hand-edited `cockpit.json` files still load. **Add is a native folder picker (2026-07-14):** the editor's `+ Browse for repo…` button uses `@tauri-apps/plugin-dialog` `open({ directory: true })` (no typed path) → the picked folder passes through the `resolve_repo_root` command (`git -C <dir> rev-parse --show-toplevel`, `worktree.rs`, pure tested `repo_root_args`) which both **validates** it's a git work tree (non-repo → inline "Not a git repository: …" error) and **normalizes** a subfolder pick to the repo root. Cancel is a silent no-op; re-picking a known repo hits the existing dedupe. Plugin registered in `lib.rs` + `dialog:default` capability. Spec/plan: `docs/superpowers/{specs,plans}/2026-07-14-repo-folder-picker*`.
- **Deduce provider** (`src-tauri/src/deduce.rs`): builds a per-repo digest (package.json name/description/scripts + truncated README snippet up to 800 chars + the package manager inferred from the lockfile + a Tauri signal: `isTauri`/`devUrl` read from `src-tauri/tauri.conf.json`, so Tauri repos deduce `<pm> run tauri dev` + the real devUrl instead of the vite default), then shells out to `claude -p --output-format json --json-schema <inline-schema> --model claude-haiku-4-5` from a neutral cwd (temp dir, avoids loading the project's CLAUDE.md; reuses Claude Code auth — no API key). Hard 120s timeout via `wait-timeout`. Parses the top-level `structured_output` from the JSON envelope (checks `is_error`). Validates the returned `repoPath` against the known-repos list; rejects any invented path. Overrides the agent's `base` with the repo's git default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`); if the remote has no HEAD pointer the agent's guess is kept.
  **The prose fed to the deduce agent is only the prompt's FIRST sentence** (`routing_hint`, pure + tested; was
  the first two until 2026-07-29) — so the name/branch stay short and on-topic when the prompt carries long task
  context. A sentence ends at a `.`/`!`/`?` **followed by whitespace or end-of-input** (so a dot inside `store.ts`,
  a URL, or `v2.1` doesn't truncate the hint mid-token) or at the first newline (title-style prompts); no boundary
  → the whole prompt, always hard-capped at 200 chars on a char boundary. Known trade-off: a mid-sentence
  abbreviation (`vs.`, `e.g.`) ends the hint early — accepted, since detecting those needs a word list and the
  consequence is only a slightly shorter hint. **Source-ref detection still scans the FULL prompt** (refs are
  passed as their own args), and the full prompt is still what's persisted on the worktree and auto-sent to the
  Claude pane.
- **Form flow (sub-project 3):** prompt textarea + **deduce** button (disabled when `knownRepos` is empty or prompt is blank) → on success: pre-fills name/repoPath/branch/base/startCmd/address and shows a "deduced" banner (prompt text + picked repo + one-line reason). The repo's saved host default overrides the agent's guess for startCmd/address; the banner notes "host loaded from this repo's saved default" when that happens. A **"save host as default for this repo"** button persists the current startCmd/address into the repo's `knownRepos` entry for future deduce calls. All fields remain editable; **Create** is unchanged and always requires explicit user action. Inline error shows deduction failures without breaking manual entry. Deduce never creates anything ("never silent" guarantee).
- **Linear source type (source-type iteration 1):** `detect_linear_ref` (pure, no I/O) recognises a Linear ticket ref in the prompt — either a bare canonical id (`ENG-1234`, uppercase team prefix) or a `linear.app/…/issue/…` URL. When detected, `deduce_worktree` switches to an MCP-enabled `claude` call: adds `--allowedTools "mcp__linear"` and an extended system prompt + JSON schema (`sourceUrl`, `sourceTitle`, `sourceResolved` fields) so the agent can fetch the ticket via the user's Linear MCP — no in-app Linear auth, no Rust `linear.rs` module (that is the deferred sub-project-4 swap point). The model constant `LINEAR_MODEL = "claude-haiku-4-5"` and the tool filter `LINEAR_ALLOWED_TOOLS = "mcp__linear"` are **verified** against a live Linear MCP connection — a real ticket resolves via both a headless `claude -p` smoke and in-app deduce (`--allowedTools "mcp__linear"` + haiku, no `--permission-mode` needed). Guardrails on the ticket path: `sourceResolved=false` → Rust returns `Err` before any result reaches the UI, surfaced as inline error "couldn't resolve Linear ticket … (is the Linear MCP connected?)" — never fabricated params; `ensure_ref_prefix` guarantees the ticket id appears in both `name` and `branch` (case-insensitive check, prepends if absent; `branch` receives the **lowercase** id, `name` the **original-case** id — so branch may read `eng-1234-…` while name reads `ENG-1234 …`). The plain-prompt path is byte-identical to before (no `allowed_tools`, original schema/system-prompt). On Create, `sourceLinkFrom` returns null when `sourceUrl` is empty, otherwise converts `sourceUrl`/`sourceTitle` into a `WorktreeLink` staged into the worktree's `links`; the deduce banner shows "🔗 `<title>` — link will be added." when a ticket was resolved (the banner is source-aware since the GitHub iteration). **GUI + live acceptance verified** — in-app deduce of a real ticket resolves the fetch, fills the fields, and stages the link.
- **GitHub source type (source-type iteration 2):** `detect_github_ref` (pure, in `src-tauri/src/github.rs`) recognises a GitHub PR or issue URL in the prompt. On a hit, `deduce_worktree` first resolves `owner/repo` to a known repo deterministically by matching each repo's `origin` remote URL (fail-fast inline error if the repo isn't in `knownRepos` — never a guess), then fetches the PR/issue via the already-authenticated `gh` CLI (`gh pr view --json …` / `gh issue view --json …`, no MCP, no new schema). The fetch uses your **globally-active `gh` account**; if the repo is known locally but `gh` can't see it (e.g. a private repo while a different account is active in a multi-account setup), the error is wrapped with a hint to check `gh auth status` / `gh auth switch` (GitHub returns a bare "could not resolve repository" 404 in that case). The fetched title + body are folded into the plain agent call (no `--allowedTools`, no new system prompt — a richer user prompt only). After the agent returns, `apply_github_overrides` sets the authoritative fields: `repoPath` from the match; PR → `headRefName` as `branch`, `baseRefName` as `base`, `pr-<N>` pinned in name; issue → new branch + name both contain `issue-<N>`. The source-neutral rename (`sourceUrl`/`sourceTitle`/`sourceLinkFrom`) applies across all source types; `existingBranch` in `DeducedWorktree` drives the `BranchSpec` mode; for PRs the `BranchSpec` is `Pr { number, branch }` and `create_worktree` runs `git worktree add --detach <path>` then, inside the new worktree, `gh pr checkout <N>` (primary — sets up a push-tracking branch for an open PR, handles forks). If that fails because the live head branch is gone (a **merged PR whose branch was deleted**), it falls back to the immutable `git fetch origin refs/pull/<N>/head` + `git checkout -B <headRefName> FETCH_HEAD` — so open, merged, and fork PRs all check out. PR create is **idempotent**: an existing target worktree dir (e.g. a leftover from a prior failed checkout) is reused rather than erroring, and the `-B` checkout re-points the branch to the PR head on retry. The PR number + `headRefName` are threaded `deduce_worktree` → `DeducedWorktree.pr_number`/`branch` → frontend `prNumber`/`branch` → the `pr` BranchSpec on Create. The resolved link auto-attaches on Create. Deferred per spec §G: remote-review-only mode (no local clone), filesystem auto-find, `owner/repo#N` shorthand, PR fast-path optimization.
- **Slack source type (source-type iteration 3):** `detect_slack_ref` (pure, in `src-tauri/src/deduce.rs`) recognises a `*.slack.com/archives/…` permalink anywhere in the prompt — both the plain form (`/archives/<channel>/p<ts>`) and the thread-reply form (`?thread_ts=…&cid=…`) — by scanning whitespace-delimited tokens and trimming surrounding paste punctuation (`(),.`). On a hit, `deduce_worktree` runs a `claude` CLI call MCP-enabled with `--allowedTools SLACK_ALLOWED_TOOLS` (the claude.ai Slack connector's headless name `mcp__slack`, like `mcp__linear` — **not** the in-session tool-namespace UUID) plus `--permission-mode SLACK_PERMISSION_MODE` (`bypassPermissions` — the Slack connector gates its tool calls even when allow-listed, unlike Linear; the bypass is scoped to Slack tools by the `--allowedTools` filter) and `SLACK_MODEL` (`claude-haiku-4-5`), using the shared `DEDUCE_SCHEMA_SOURCE` schema (renamed from `DEDUCE_SCHEMA_TICKET`; value unchanged) plus a `SYSTEM_PROMPT_SLACK` that instructs the agent to fetch the message and its thread via the Slack MCP — no in-app Slack auth, no `slack.rs` (the deferred Rust Slack provider + Keychain-token path is the sub-project-4 swap point, the same place the future unread-messages tile's Web-API + Socket Mode provider lands). **Guardrail:** `sourceResolved=false` → inline error "couldn't resolve Slack message (is the Slack MCP connected?)" — never fabricated params. Rust overwrites `source_url` with the pasted permalink deterministically (the agent supplies only `sourceTitle`/`sourceResolved`). No id is pinned: Slack has no meaningful short id, so `ensure_ref_prefix` is NOT called; `existingBranch=false` and `prNumber=0` — a new branch with a fully agent-proposed name. The resolved Slack link auto-attaches to the worktree's `links` on Create; the banner shows "🔗 `<title>` — link will be added." The frontend is **unchanged** — the source-neutral seam from the GitHub iteration (`sourceUrl`/`sourceTitle`/`sourceResolved`, `sourceLinkFrom`, `existingBranch=false`, `prNumber=0`, banner, link-staging) handles Slack without modification. The plain / Linear / GitHub paths are byte-identical. **`SLACK_ALLOWED_TOOLS = "mcp__slack"`, `SLACK_PERMISSION_MODE = "bypassPermissions"`, and `SLACK_MODEL = "claude-haiku-4-5"` are pinned by a live smoke (2026-06-22)** — a real DM permalink resolved end-to-end via a headless `claude -p` (also confirming private/DM access and bare-permalink resolution, no channel+ts parsing). 41 Rust tests + 22 JS tests green; Rust + Vite builds clean.

- **Slot entities + Checkout + scratch terminals (existing-branch & scratch-terminals iteration):** a Worktrees slot now holds a **slot entity = worktree | scratch** (`resolveSlotEntity` in `src/views/slots.ts` looks an id up as a worktree first, then a scratch). **Scratch terminals** are session-only entities (`scratch-<n>` ids, `{ id, title }` in the store's `scratchTerminals` list + a monotonic `scratchSeq`; `addScratch`/`removeScratch`) — a single login-shell pane reusing the unchanged `pty_ensure` with `role="shell"`, `cwd=homeDir()`, no autostart (zero new Rust); they don't persist across restarts. The old `WorktreeColumn` is split into **`SlotColumn`** (shared chrome: status dot + picker + ⚙ Hide/Delete) rendering either **`WorktreeBody`** (chips/path/3 panes/links) or **`ScratchBody`** (one shell pane); Delete dispatches by kind (3 roles vs the single `shell` pty). The `clearWorktree` slot reducer was renamed **`clearEntity`** (entity-generic). **Header create buttons** are now `Worktree · Checkout · Terminal` (in `.app__actions`): Worktree → deduce modal, Checkout → existing-branch modal mode, Terminal → instant `addScratch()`. The **modal** gained a `Deduce · Existing branch` segmented control hosting the unchanged `NewWorktreeForm` or the new `ExistingBranchForm`. **Checkout flow** reuses `BranchSpec::Existing`; the one new Rust command **`list_branches`** runs `git for-each-ref --sort=-committerdate refs/heads/` (recency-sorted, pure `parse_branch_lines`) and cross-references `git worktree list --porcelain` (pure `parse_worktree_branches` + `mark_checked_out`) so branches already checked out elsewhere are returned with `checkedOut` and **disabled in the picker** with a "· checked out" tag (git refuses to worktree-add those) — **except the repo's own**, which since the primary-tree iteration carries a `primaryTree` flag (set from the first `git worktree list --porcelain` block, never a path comparison) and sits pickable under a "Checked out in the repo" heading ("· open in place"); create also surfaces a plain-English fallback if a branch is claimed after listing. **Theme:** form-control styling (`input`/`select`/`textarea` + a themed select chevron) was lifted to the **global baseline in `src/theme/tokens.css`** so every form — and any future one — inherits the dark look with no extra classes (`.wt-col__picker`'s `background:none;border:none` keeps it bespoke; xterm's helper textarea is excluded). **GUI + live acceptance verified.** Deferred: remote-branch checkout in the picker (tracking branch); persisting scratch across restarts; centralizing the empty-host shape; a modal-scoped button theme. Spec: `docs/superpowers/specs/2026-06-24-existing-branch-and-scratch-terminals-design.md`; plan: `docs/superpowers/plans/2026-06-24-existing-branch-and-scratch-terminals.md`.

- **Claude attention highlight (terminal-bell detection) — live & GUI-verified.** Detection is the **terminal bell**: `useTerminal` (`src/worktrees/useTerminal.ts`) hooks xterm's built-in `term.onBell` and, for **attention roles only** (`isAttentionRole` in `src/worktrees/ptyId.ts` → `claude` | scratch `shell`; host/git excluded), marks the pane on a live BEL. A `bellLive` flag (set true right after the scrollback replay write) gates out BEL bytes already sitting in replayed scrollback. State is a **session-only** store slice keyed by `ptyId` (`attention: Record<string, true>` + `markAttention`/`clearAttention` in `src/settings/store.ts`; not persisted). Consumers read it: `WorktreePane` applies `.wt-pane--attention` (warm-red border + glow) and renders the `wt-attention` badge; `SlotColumn` tints the column icon for the slot's claude/shell pane. **Cleared only on real input** — `term.onData` (the user typing a response) and on `restart`; deliberately **not** on focus/window-switch (that cleared it before the user noticed). **No Rust changes** — `pty.rs` already streams the raw bytes and xterm parses the bell. Theme: `--attention-warm` (#ef7a5f, warm coral-red) + `--attention-warm-rgb` in `tokens.css`; the badge + column-icon tint were unified onto it. **One-time user prerequisite:** Claude Code must emit the bell — set `preferredNotifChannel: "terminal_bell"` in `~/.claude/settings.json` (default `auto` sends no bell in the webview terminal). Claude rings after a short idle interval (not the instant a prompt appears), so the glow has an inherent brief delay — that latency is Claude's, not ours (the in-app path is synchronous: BEL → IPC → `onBell` → store → render). README "Claude Code setup" documents the prerequisite. 76 JS tests green (`ptyId.test.ts` covers `isAttentionRole` + id format); Rust + Vite builds clean. A second, quieter `.wt-pane--focused` border state (steel-blue `--accent`) shows keyboard focus inside a pane's terminal body — session-only local component state with no store slice — and is guaranteed to lose to attention via the `:not(.wt-pane--attention)` selector rather than rule order.

- **Deep Slate theme (2026-07-08, merged to `main`, GUI-approved).** The app-wide dark theme is now the
  spec'd **"Deep Slate" (2b)** token contract: `src/theme/deepSlate.css` holds ALL colour/type/shape tokens
  verbatim under `:root[data-theme="deep-slate"]` (plus two flagged additions: `--overlay`, `--bad-rgb`);
  `src/theme/tokens.css` is the theme-AGNOSTIC baseline (spacing, `--fs-*` type scale, element defaults) —
  the old token names (`--bg`, `--surface-raised`, `--text-*`, `--attention*`, `--danger`, `--radius*`,
  `--font-ui/mono`…) are **deleted**, components use the new vocabulary (`--bg-0..3`, `--surface`, `--tx-hi..4`,
  `--bdr/--bdr-2/--divider`, `--accent/--on-accent`, `--r/--r-sm`, `--ui/--mono`, status trios `--ok/--warn/
  --bad/--review-*`, chip trio `--info-*`, `--hover` state layer at 200ms ease-out). `ThemeProvider`
  (`src/theme/ThemeProvider.tsx`, wraps `<App>` in `main.tsx`) sets `data-theme` on `<html>` and imports the
  theme CSS + fonts — **Inter + JetBrains Mono bundled locally via `@fontsource/*`** (no CDN). Role rules:
  the active view tab is the ONE red fill (`--nav-active`), the header `+ New` is the ONE green button
  (`--btn-new`), everything else primary is `--accent` steel blue. **Terminal bodies + the diff hunk area are
  ALWAYS-DARK (`--term`) with FIXED literals** (spec §3): xterm gets the hardcoded `TERM_THEME` palette +
  JetBrains Mono in `useTerminal.ts` — deliberately not chrome tokens, so a future light theme won't touch
  terminals. Allowed literal-colour sites (everything else must use tokens): `deepSlate.css`, `TERM_THEME`,
  the diff hunk/ctx colours in `CockpitView.css`, the two data-URI SVG strokes in `tokens.css` (chevron/tick —
  data-URIs can't `var()`), the active-tab shadow. **Tauri:** overlay titlebar (`titleBarStyle: "Overlay"`,
  `hiddenTitle`, forced `"theme": "Dark"`); the header is a `data-tauri-drag-region` with 84px left padding for
  the traffic lights. **Flex gotcha (fixed):** any fixed-width column holding terminals needs `min-width: 0` —
  a freshly-mounted xterm is 80 cols (~588px) before FitAddon runs, and `min-width: auto` lets that first paint
  inflate the column, which then visibly shrinks as fit converges (`.cockpit-view__worktree` was the case).
  Plan: `docs/superpowers/plans/2026-07-07-deep-slate-theme.md`.

- **Terminal pane expand + close buttons (2026-07-08, GUI-verified).** Each worktree pane header is now
  `restart · close · expand · chevron`. **Expand** (new `ExpandIcon`, two opposed chevrons) opens the clicked
  pane and collapses its two siblings: the full variant's open-state lives on the worktree model as the
  **persisted optional `paneOpen: {host,git,claude}`** (`cockpit.json`; Rust `PaneOpen` + `#[serde(default,
  skip_serializing_if)]` back-compat — absent = all open), so each worktree's arrangement survives view
  switches AND app restarts; `WorktreeBody` writes it via the existing `updateWorktree` and passes it to
  `WorktreePane` as optional controlled props `open`/`onToggle`/`onExpand`. When those props are omitted the
  pane self-manages session-only as before, so scratch single panes are unchanged and get no expand
  button — expanding a lone pane is meaningless. **Close** cuts off whatever is running (autostart cmd AND its
  shell) and lands on a fresh bare prompt: `pty_kill` → `pty_ensure` with NO autostart (the shared `respawn`
  helper in `useTerminal.ts`; restart = same path re-running the autostart). **Gotcha:** a kill without respawn
  leaves a dead xterm that still blinks a cursor and silently eats keystrokes (`pty_write` fails on the missing
  id with no `.catch`) — the pane looks stuck. Close also clears the attention highlight. No Rust changes
  (`pty_kill` is idempotent — Ok on a missing id). **Superseded 2026-07-10 (worktree lazy panes):** the
  persisted `paneOpen` field is DELETED — pane existence + collapse/expand state are session-only via the
  `worktreePanes` store slice; Close on host/extra panes now REMOVES the pane instead of respawning it bare
  (only the Claude pane keeps the respawn-bare Close). The expand/collapse coordination is otherwise unchanged.

- **Themed Dropdown (custom select) (2026-07-08, merged to `main`).** All 3 native `<select>`s (slot-column
  picker + Checkout's repo/branch) are replaced by one shared **`Dropdown`** component — macOS renders the
  native popup list and CSS can't style it at all, so theme colours/padding/radius on the open list required
  a custom trigger-button + popover listbox (same pattern as the gear menu; no library, no portal).
  **Files:** `src/views/dropdownModel.ts` (pure types + tested `selectedLabel(groups, value, placeholder)`
  trigger-label resolution) — named `dropdownModel`, NOT `dropdown`: on macOS's case-insensitive FS,
  importing `../Dropdown` resolves `dropdown.ts` first (`.ts` beats `.tsx`) and tsc errors with a casing
  clash against `Dropdown.tsx`; `src/views/Dropdown.tsx` (component: outside-click close via a
  while-open document listener; Escape closes with `stopPropagation` so a host modal's own Escape handler
  doesn't also fire — first Escape closes the popover, second closes the modal); `src/views/Dropdown.css`.
  **API:** `value: string|null`, `onChange(value)`, `groups: {label?, options:{value,label,suffix?,hint?,disabled?}[]}[]`,
  `placeholder`, `variant: "heading"|"form"` — `heading` = the slot column's bold title-as-picker look,
  `form` = the input-baseline box so closed state blends into forms. **Styling:** popover on `--surface`,
  radius `--r`, new **`--menu-shadow`** token (deepSlate.css additions block); rows `--fs-lg` at `8px 14px`
  with `--hover` pills; selected = `--tx-hi` + accent `TickIcon`; disabled `--tx-3`; group headers =
  uppercase `--fs-2xs` themed optgroups; `hint` renders dim after the label (branch rows: recency +
  "· checked out"); **`suffix`** (2026-07-29) renders as `· <suffix>` at `font-weight: 400` inside the label
  span — secondary identity that truncates with the title but reads as distinct from it. The slot picker's repo
  basename moved from a composed `"<name> · <repo>"` label into `suffix` for exactly that reason; `selectedSuffix`
  (pure, tested) feeds the trigger. **CSS gotcha:** rows/trigger are `<button>`s — the `.dd button.dd__*` selector shape
  (0,2,1) is deliberate, out-specifying both the global button baseline and `.eb-form button`. The gear-menu
  popover was aligned to the same family (radius `--r`, `--menu-shadow`, hover pills). The slot picker's
  "Select…" row (value `""`) keeps its clear-the-slot role; Checkout's placeholder rows are no longer
  selectable (no reset row — repick instead). Native-select baseline in `tokens.css` kept for future forms.
  130 JS tests green (4 new); tsc + Vite clean; no Rust changes.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-07-08-themed-dropdown*`.

- **Desktop notifications for the attention signal (2026-09-08):** a bell in a Claude/scratch pane
  already sets the session-only `attention` flag (glow + "Check me out" badge). It now also raises a
  macOS notification naming the worktree and bounces the Dock, but **only while cockpit is unfocused** —
  the on-screen glow covers the focused case. `src/worktrees/attentionNotifier.ts` **subscribes** to the
  store rather than being called from `markAttention`, so `workspace.ts` is untouched and the slice stays
  OS-free; `newlyMarked` makes it edge-triggered (Claude bells repeatedly while waiting, and only the
  first deserves a banner). The three OS calls are injected (`AttentionPorts`), so 18 tests cover the
  logic against the real store with only the boundary stubbed. Toggle in Settings › Notifications
  (`preferences.notifyOnAttention`, absent = on). `tauri-plugin-notification` v2 + `notification:default`,
  `core:window:allow-is-focused`, `core:window:allow-request-user-attention`.
  **macOS gotchas worth keeping:** the first notification after install is always eaten by the OS
  authorisation prompt (macOS reports permission granted *before* prompting), `tauri dev` cannot deliver
  notifications at all (not a bundle — test the packaged `.app`), and ad-hoc signature churn between
  builds does not reset the grant.
  Spec: `docs/superpowers/specs/2026-09-08-attention-desktop-notifications-design.md`.

## Status

Completed work lives in [`docs/STATUS.md`](docs/STATUS.md) — the running log of what
shipped and why, newest last. Read it for a feature's history; append a short entry
there (not here) when work completes.

**Next / resuming work — read `docs/ROADMAP.md` first.** It is the single prioritized backlog, split into
**main build sub-projects** (the big sequential arc — sub-project 5 onward: Linear tile, then GitHub/Calendar
tiles, reusing the SP4 provider+panel + Keychain seam) and **smaller iterations** (scoped polish/enhancements). When
the user says "let's continue" (or similar), open `docs/ROADMAP.md` and present its current items grouped that
way — main sub-projects first, then smaller iterations — before proposing what to pick up.
Product vision: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`.
