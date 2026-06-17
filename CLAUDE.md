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
  `pty_ensure`, `pty_attach`, `pty_write`, `pty_resize`, `pty_kill`.
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

## Status

✅ **Sub-project 1 (layout shell + settings) — complete & merged to `main`.**
All tests green; GUI confirmed rendering. Plan:
`docs/superpowers/plans/2026-06-16-layout-shell.md`.

✅ **Sub-project 2 (worktree engine, manual) — complete.**
PTY provider, git provider, worktree composite tile, and default first-launch
instance all in place. 12 Rust tests + 14 JS tests green; Rust + Vite builds
clean. GUI acceptance pending human sign-off.

**Next:** sub-project 3 — **smart new-worktree**: Claude deduction agent; start
with plain-prompt input, add source types (Linear → GitHub → Slack) one at a
time; always deduce → preview/confirm → create, never silent.
See `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`.
