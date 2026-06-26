# Cockpit

A macOS desktop **dev cockpit**: a workspace that runs several live terminals in
organised tiles (connected to git worktrees), with side panels that pull in the
tools you'd otherwise app-switch to — Slack, Linear, GitHub, Calendar.

The terminals are the heart; integrations are panels around them.

## What it does

- **Worktrees view** — three column slots, each running one git worktree with its
  own terminals (host / git / claude). Create a new worktree from a natural-language
  prompt, or check out an existing branch. Scratch login-shell terminals too.
- **Smart new-worktree** — describe what you want to work on; Cockpit deduces the
  repo, branch, start command and dev URL. Paste a **Linear ticket**, **GitHub
  PR/issue**, or **Slack permalink** and it resolves the source and stages a link.
- **Panel system** — an extensible provider/panel pattern so integrations can be
  added one at a time without re-architecting.

## Stack

| Layer | Choice |
|-------|--------|
| Shell | [Tauri v2](https://tauri.app) (native macOS, ~10–30 MB) |
| Frontend | React 19 + TypeScript (Vite), Zustand store |
| Backend | Rust core — owns PTYs, OS keychain, OAuth, polling |
| Terminal | [xterm.js](https://xtermjs.org) + [`portable-pty`](https://crates.io/crates/portable-pty) |
| Secrets | macOS Keychain |

The Rust core owns everything stateful/privileged; the React webview is pure
presentation, talking to the core over Tauri IPC.

## Development

```bash
npm install
npm run tauri dev      # run the app
npm run build          # type-check + build frontend
npm test               # frontend tests (vitest)
cd src-tauri && cargo test   # Rust tests
```

App config lives in `~/Library/Application Support/com.cockpit.app/`
(`cockpit.json` user config + `layout.json` geometry); worktrees are created
under `~/CockpitWorktrees/<repo>/<name>`.

## Docs

- Product spec — `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`
- Backlog / next work — `docs/ROADMAP.md`
- Architecture & conventions — `CLAUDE.md`

> Learning project: code favours small, readable changes over polish, and files
> carry concise role comments. See `CLAUDE.md` for conventions.

## Current state

![Cockpit — current state](docs/assets/current-state.png)
