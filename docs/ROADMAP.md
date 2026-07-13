# Cockpit — Roadmap & Backlog

> **Single source for "what's next."** Two tiers:
> - **Main build sub-projects** — large, sequential; each gets its own spec → plan → build cycle (brainstorming → writing-plans → subagent-driven-development).
> - **Smaller iterations** — scoped, roughly one PR each; can be picked up opportunistically.
>
> Completed work lives in `CLAUDE.md` → "Status". Keep this file current: when an item ships, move it to CLAUDE.md and delete it here; add new ideas as they surface.
>
> **On "let's continue":** present this file's items grouped as below — main sub-projects first, then smaller iterations — and help pick one. Main sub-projects start with the brainstorming skill; smaller iterations can often go straight to a plan or a direct change.

---

## Main build sub-projects (large, sequential)

The heart — terminals + worktrees — is done. The product arc from here is the **provider + panel** pattern: read-only integration tiles added one at a time (Slack first, per the product vision), each a Rust-side provider streaming events + a React panel rendering them.

> ✅ **Sub-project 4 — Auth manager + Slack unread tile — done & merged.** The pattern's first real instance:
> macOS Keychain token store (`keychain.rs`), Slack browser-OAuth + polling provider (`slack.rs`) emitting
> `slack://unread`, connections registry (`auth.rs`), Cockpit-view tile column + `SlackTile` + Settings → Connections.
> Moved to `CLAUDE.md` "Status". **Live/GUI smoke still pending human** (needs a real Slack app — pins the unread
> endpoint fields). Its deferred follow-ups are captured under "Smaller iterations → Integrations / Slack" below.

1. **Sub-project 5 — Linear tile.** Next up. Second provider+panel instance: assigned/active issues. Validates that the Nth integration is mechanical. **Reuses SP4's `keychain.rs` + `auth.rs` connections registry wholesale** (Linear is also OAuth). The deferred `linear.rs` Rust provider swap point lands here (today Linear is resolved via the Claude CLI's MCP only during deduce).

2. **Sub-project 6 — GitHub tile.** PRs awaiting your review + notifications, via the already-authenticated `gh` CLI or the API. Reuses the pattern.

3. **Sub-project 7 — Calendar tile.** Today's events / next meeting. Last of the initially-scoped panels.

4. **Live worktree & Claude signals (provider).** Substantial, mostly-backend chunk that can slot in whenever it earns priority: detect Claude "**Attention**" from PTY output (currently a styled stub), git **ahead/behind** (stub), and **CI** status (stub chip). Drives the column status dot, the ahead/behind badge, and the CI chip with real data; unlocks the DONE/PAUSED Claude pane states. Provider-flavoured enough to be its own cycle.

> ✅ **Cockpit Diff tab — done & merged.** Centre-column `Home | Diff` tabs in the Cockpit view;
> Diff shows the right-column worktree's branch-vs-base diff (`git diff --merge-base <base>`, base
> derived live from `origin/HEAD`) as a numstat stat-list with lazily-expanded colorized hunks.
> Moved to `CLAUDE.md` "Status". Spec: `docs/superpowers/specs/2026-07-03-cockpit-diff-tab-design.md`.

---

## Smaller iterations (scoped, ~1 PR each)

### Integrations / Slack (SP4 follow-ups)
- **Live/GUI smoke + pin the unread endpoint.** The one outstanding SP4 item: connect a real Slack app and verify the OAuth round-trip; confirm/adjust the `conversations.info` (`unread_count_display`/`last_read`) + `conversations.history` field paths against a live token (see the in-code NOTE in `parse_conversation`); confirm the tile renders watched unread + preview + relative time and rows link out.
- **CSRF `state` in the Slack OAuth flow.** `authorize_url` omits a `state` param. Low risk for an ephemeral loopback, but add a random `state` + callback check — SP5's Linear OAuth will copy this template, so harden it once.
- **Resolve a Slack display name.** Status shows the raw user id ("Connected as U0123ABC"); a `users.info` lookup after token exchange would show a real name.
- **Socket Mode realtime push.** Polling-only by design (see spec "Why polling, not Socket Mode"); revisit only if ~30s + focus-refresh proves too stale.
- **Slack tile polish.** Skip per-conversation `conversations.info` errors for stale watched ids (a left channel shouldn't set the snapshot error every poll); replace a few hardcoded `slack.css` values with `--radius`/`--space-*` tokens.

### Worktrees & Checkout
- **Remote-branch checkout.** Let the Checkout picker offer remote-only branches (a teammate's pushed branch you don't have locally) — needs tracking-branch logic (`git worktree add -b <name> <path> origin/<name>`). Deferred from the existing-branch iteration.
- **Persist slot assignments to disk.** Survive restarts — add one field to the Rust `CockpitConfig` serde struct (the only reason slots are session-only today).
- **"Path not found" banner.** Dedicated header banner when a worktree's dir is missing/deleted (spec §G) — today the Claude pane (and any Run/Add pane) just shows an in-pane `[failed to start]`.
- **Run button when the dev server exits.** The host pane stays after the process ends (restart re-runs it); consider auto-detecting exit and re-enabling a fresh Run affordance.
- **Branch picker quality-of-life.** Search/filter for repos with many branches; optionally show last-author alongside the relative date.

### Scratch terminals
- **Persist scratch terminals across restarts.** Currently session-only by design; make optional/persistent if it proves useful.
- **Rename a scratch terminal.** Editable title instead of the auto `Scratch <n>`.

### Polish & theme
- **Modal-scoped button theme.** Lift form-button styling to `.modal__content button` so future modal forms get themed buttons for free (needs a specificity fix so the accent `__create`/`__deduce` variants still win — that's why it wasn't done in the theme-baseline iteration).
- **Centralize the empty-host shape.** `ExistingBranchForm` inlines `{ startCmd: "", address: "" }`; extract an `EMPTY_HOST` constant in `model.ts`. Also decide whether a checkout-created worktree should get a default `startCmd` or stay blank (it stays blank today — arguably correct: don't guess a dev server).
- **`scratchSeq` read-only / atomic `addScratch`.** Minor: derive the next id inside the `set` updater to remove a theoretical double-id race on synchronous calls.

### Deferred from the source-type iterations
- **GitHub `owner/repo#N` shorthand** in the deduce prompt (today only full PR/issue URLs are detected).
- **Remote-review-only PR mode** (review a PR without a local clone) + **filesystem auto-find** of a repo by name.

### Layout (revisit only if it earns its place)
- **Per-column resize/reorder; add/remove slots.** Deliberately dropped when dockview was removed; reintroduce only as a validated need.
