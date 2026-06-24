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

1. **Sub-project 4 — Auth manager + first read-only integration tile.** The pattern's first real instance and the highest-leverage next step. Build: macOS **Keychain** token storage (Rust), an auth/connection manager, and the **first read-only panel** (Slack unread messages — the product's "Slack first"). This is where the deferred `slack.rs` / `linear.rs` Rust provider swap points land (today those sources are resolved via the Claude CLI's MCP during deduce; this gives them a real in-app provider). Establishes the provider+panel seam every later tile reuses. Spec stub: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`.

2. **Sub-project 5 — Linear tile.** Second provider+panel instance: assigned/active issues. Validates that the Nth integration is mechanical. Reuses the auth manager from SP4.

3. **Sub-project 6 — GitHub tile.** PRs awaiting your review + notifications, via the already-authenticated `gh` CLI or the API. Reuses the pattern.

4. **Sub-project 7 — Calendar tile.** Today's events / next meeting. Last of the initially-scoped panels.

5. **Live worktree & Claude signals (provider).** Substantial, mostly-backend chunk that can slot in whenever it earns priority: detect Claude "**Attention**" from PTY output (currently a styled stub), git **ahead/behind** (stub), and **CI** status (stub chip). Drives the column status dot, the ahead/behind badge, and the CI chip with real data; unlocks the DONE/PAUSED Claude pane states. Provider-flavoured enough to be its own cycle.

---

## Smaller iterations (scoped, ~1 PR each)

### Worktrees & Checkout
- **Remote-branch checkout.** Let the Checkout picker offer remote-only branches (a teammate's pushed branch you don't have locally) — needs tracking-branch logic (`git worktree add -b <name> <path> origin/<name>`). Deferred from the existing-branch iteration.
- **Persist slot assignments to disk.** Survive restarts — add one field to the Rust `CockpitConfig` serde struct (the only reason slots are session-only today).
- **"Path not found" banner.** Dedicated header banner when a worktree's dir is missing/deleted (spec §G) — today each pane just shows an in-pane `[failed to start]`.
- **Branch picker quality-of-life.** Search/filter for repos with many branches; optionally show last-author alongside the relative date.

### Scratch terminals
- **Persist scratch terminals across restarts.** Currently session-only by design; make optional/persistent if it proves useful.
- **Rename a scratch terminal.** Editable title instead of the auto `Scratch <n>`.

### Polish & theme
- **Modal-scoped button theme.** Lift form-button styling to `.modal__content button` so future modal forms get themed buttons for free (needs a specificity fix so the accent `__create`/`__deduce` variants still win — that's why it wasn't done in the theme-baseline iteration).
- **Centralize the empty-host shape.** `ExistingBranchForm` inlines `{ startCmd: "", address: "" }`; extract an `EMPTY_HOST` constant in `model.ts`. Also decide whether a checkout-created worktree should get a default `startCmd` or stay blank (it stays blank today — arguably correct: don't guess a dev server).
- **`scratchSeq` read-only / atomic `addScratch`.** Minor: derive the next id inside the `set` updater to remove a theoretical double-id race on synchronous calls.

### Cockpit view
- **Give the Cockpit view a job.** It's an empty themed placeholder. Candidate: a utility/scratch space or an at-a-glance dashboard once integration tiles exist.

### Deferred from the source-type iterations
- **GitHub `owner/repo#N` shorthand** in the deduce prompt (today only full PR/issue URLs are detected).
- **Remote-review-only PR mode** (review a PR without a local clone) + **filesystem auto-find** of a repo by name.

### Layout (revisit only if it earns its place)
- **Per-column resize/reorder; add/remove slots.** Deliberately dropped when dockview was removed; reintroduce only as a validated need.
