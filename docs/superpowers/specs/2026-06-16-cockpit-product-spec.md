# Cockpit — Product Spec (vision)

> Status: brainstorming. This captures the product vision and a *proposed*
> decomposition into buildable sub-projects. Each sub-project will get its own
> design doc + implementation plan. Stack decisions live in `CLAUDE.md`.

## Philosophy

A flexible dev cockpit to track and manage **multiple worktrees across repos** in
one place, and to surface messages, tasks, jobs, etc. in **customisable tiles**.

## Main view — three columns

- **Left** — permanent tiles: Slack unread, PR reviews to do, CircleCI jobs, …
- **Right** — the current worktree: multiple terminals (git / local host / Claude
  Code), plus useful links (designs, ticket, preview).
- **Centre** — modular space: either permanent tiles (like Left), or a second
  worktree (like Right), or an *expansion* of a Left/Right tile (e.g. the code
  diff of the current worktree, or the body of a Slack message).

## Calm view

Decluttered: only the most important tile per worktree — the terminal running
Claude Code.

---

## Left column — tiles / modules (name TBC)

Menu at top selects which tiles are featured.

- 🌶️ **Slack** — channels with unread messages; filter to a few important
  channels. MVP: link out to the Slack app. Later: read/respond in-app.
- 🌶️ **PR reviews** — list of PRs needing review. Sources: pulled from a Slack
  channel, pasted GitHub link, or pasted repo + branch.
- 🌶️ **CircleCI** — recent jobs created by the user.
- Escalations — *not MVP.*
- Sentry (+ escalations) — *not MVP.*

> ⁉️ Many of these are doable via CLI — value is making them more graphical / UI-friendly.

## Right column — worktrees (the core value)

Automates the manual parts of dev by deducing what the user needs from the
initial task prompt.

- **Top bar:** dropdown of recent worktrees with status (ongoing / completed / …);
  **New worktree** button → single text input accepting a Slack link, a Linear
  ticket number or link, a GitHub link, or a plain prompt.
- A **Claude agent** deduces worktree params from that input:
  - Name (short, clear)
  - Location: repo / branch / worktree
  - Local host (from target repo's package.json/README): start command + address
- **Rendering:** name; useful links (ticket / designs / preview, user-editable);
  **3 terminals** all targeting the right repo/branch/worktree:
  - Local host (auto-starts)
  - Git
  - Claude Code (auto-starts)

## Centre — modular space

- **Default:** To-do (Notion), Tickets (Linear), Pomodoro timer.
- **Overrides:** 🌶️ second worktree, 🌶️ diff, Slack message.
- Default view can be overridden from usage.

## Calm view

🌶️ Claude tiles for ongoing workflows.

---

## Modularity (needs dedicated exploration)

Flexibility of layout is core UX: easily resize columns, move tiles between
columns, add an extra tile (e.g. another terminal on the right). The centre is
especially critical: expand details of any Left/Right tile, or open a new tab.
Tracked through settings.

## Authentication

Platforms: Slack, Anthropic, CircleCI, GitHub (CLI), Linear, Sentry (*not MVP*).

- Prefer **browser-based auth** over API keys where possible.
- One in-app page shows each service's auth status and lets the user re-login to
  any dropped service.
- Done in one go on first open.

## Settings

Eventually per-column and per-tile settings.

- Surfaced in the centre column.
- Editable by the user without changing code.
- Stored together in a single place, easy to save and copy.
- ⁉️ Need a unified, readable way to manage/update/access these — JSON?

## Other

- **Hotkeys:** new worktree, search worktrees.
- **Notifications:** highlight tabs needing attention — esp. Claude Code & Slack.

---

## Decomposition (confirmed) + status

This vision is ~5 subsystems. Build order, each shippable/usable on its own:

0. ✅ **Core spike** — Tauri + React skeleton + IPC round-trip. *Done* (the
   terminal/PTY part deferred to sub-project 2, where terminals actually live).
1. ✅ **Layout shell + settings** — dockview workspace, tile registry,
   move/expand/tab tiles, calm-view toggle, two-file JSON settings store.
   *Done & merged* — see `layout-shell-design.md` + `../plans/2026-06-16-layout-shell.md`.
2. ✅ **Worktree engine (manual)** — right column: model (repo/branch/worktree +
   local host), 3 auto-running terminals, status, recent-worktrees dropdown.
   No AI yet — user picks repo/branch. *Done.*
3. ✅ **Smart new-worktree (plain-prompt) — complete.** `deduce_worktree` IPC, `KnownReposEditor`,
   prompt → deduce → pre-fill → banner flow; deduce never creates. GUI acceptance pending human
   sign-off. Follow-on landed on the same branch: base branch derived from git
   (`git symbolic-ref --short refs/remotes/origin/HEAD`, so `master`-default repos deduce
   correctly); per-repo saved host defaults stored as `{ path, host? }` objects in `knownRepos`
   (deserializer accepts legacy bare-string entries); form applies saved host after deduce (banner
   notes it) and offers a "save host as default for this repo" action.
   **Source-type iterations next:** Linear → GitHub → Slack (each adds a new input type
   to the same deduce → preview/confirm → create flow).
4. **Auth manager + first integration tile** — auth status page; a read-only,
   token-auth tile first (CircleCI or PR reviews) to prove the provider+panel
   pattern.
5. **More panels + polish** — Slack, centre overrides (diff/second worktree),
   hotkeys, notifications.

## Cross-cutting decisions

1. ✅ **Layout engine** — resolved: **dockview** (v6.6.1; themed via the `theme`
   prop, not a wrapper class).
2. ✅ **Settings format** — resolved: two JSON files — `cockpit.json` (portable
   user config) + `layout.json` (disposable geometry).
3. **Worktree deduction coupling** (open) — the agent depends on integrations/auth to
   read Linear/GitHub/Slack context; needs a confirm-before-create step.
4. **Auth is heterogeneous** (open) — Slack/Linear = OAuth; GitHub = reuse `gh`;
   CircleCI = API token; Anthropic = reuse Claude Code auth. The page is a
   status dashboard over different mechanisms, not one uniform OAuth wall.
