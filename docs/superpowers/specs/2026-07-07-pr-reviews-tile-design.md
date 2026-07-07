# PR Reviews tile — design

**Date:** 2026-07-07 · **Status:** approved (brainstormed with user)

## Problem

PR review requests arrive in a Slack channel (`#product-fenders-pr`), each message carrying a GitHub
PR link (and usually a `SHIP` / `SHOW` / `ASK` marker). Today: app-switch to Slack, open the link,
manually set up a review. We want a tile that lists new requests and can spin up a review worktree in
one click.

## What we're building

A **PR REVIEWS tile** below the Slack tile in the Cockpit view's TILES column:

- **Refresh button** (manual only — no polling, no events) fetches messages posted to the configured
  channel since the last refresh.
- Each message with a GitHub PR link becomes a list item: `repo · #number · author` on line one, the
  **exact PR title** (from `gh pr view`) on line two, prefixed with a **SHIP/SHOW/ASK badge** when the
  message carried one. Non-PR messages are skipped silently.
- Per item: **Remove** (drop from the list, durable) and **+ Review** (fire the existing background
  deduce→create worktree flow with the PR URL — instant pending tile; the GitHub source path checks
  the PR out and stages the link chip).
- Header shows "Refreshed Xm ago" (session-only timestamp).

## Decisions (user-confirmed)

| Question | Decision |
|---|---|
| Persistence | Items + fetch cursor persist in `cockpit.json` (todos pattern) |
| Review action | `startDeduceWorktree(url, "cockpit")` — no modal, reuse the whole GitHub path |
| Channel choice | Single-select picker in Settings → Connections (channels only) |
| Non-PR messages | Skipped silently |
| Title source | `gh pr view --json title` (exact); Slack-text fallback when `gh` fails |
| First refresh | Starts empty — only sets the cursor to the newest channel message ts |
| Architecture | One one-shot Rust command; list state lives frontend-side |

## Architecture

**One new Rust command** (`pr_reviews.rs`): `pr_reviews_fetch(channelId, oldest?) → { items, newestTs }`.

- Reuses the Slack provider's plumbing: keychain token, `api_get` (429 Retry-After retry),
  `conversations.history` with `oldest=<cursor>` (exclusive — exactly the new messages, any age),
  `resolve_user_name` + the in-memory `user_names` cache.
- No cursor yet → `limit=1` history call, returns no items + the newest ts ("start empty").
- Per message: `extract_pr_ref` (pure) finds a `github.com/<owner>/<repo>/pull/<N>` URL — plain or
  Slack mrkdwn `<url|label>` / `<url>` forms; `extract_mode` (pure) finds a standalone
  SHIP/SHOW/ASK token (any case → uppercase); author = message `user` resolved via `users.info`
  (fallback: bot `username`, else "unknown"); title = `gh pr view <N> --repo <owner>/<repo> --json
  title` (fallback: mrkdwn label → text minus URL → `repo#N`; the item is created regardless).
- `newestTs` = max ts over **all** fetched messages (chatter included) so the cursor always advances.
- `gh` calls are sequential, one per new PR message, bounded by `limit=200`; the invoke runs on its own
  thread so the UI never blocks.

**Persistence** (`integrations.prReviews` in `cockpit.json`, all `#[serde(default)]`, non-secret):
`{ channelId?, lastSeenTs?, items: PrReviewItem[] }` where an item is
`{ id (msg ts), url, repo, number, title, author, ts, mode? }`.

**Frontend** (`src/tiles/pr/`): `PrReviewsTile` on the shared `<Tile>` shell, mirroring `SlackTile`'s
states (no channel → CTA to Settings; error inline; empty → "No PR requests"). Store actions:
`setPrChannel(id)` (clears the cursor — it belongs to a channel), `applyPrFetch(items, newestTs?)`
(dedupe incoming by `url` against the list, prepend, advance cursor), `removePrItem(id)`. Merge logic
is a pure tested `mergePrItems`. Review failures reuse the global `worktreeError` → New modal reopens
prefilled (zero new error machinery).

**Settings picker**: a "PR reviews channel" single-select section in `SlackConnections`, reusing the
loaded conversations list + `filterConversations`, channels only.

## Rejected alternatives

- **Full provider mirror** (Rust-owned state, `pr://` events, poll thread): the brief is manual-refresh
  and the list is user-curated data — a Rust copy adds sync for nothing.
- **Frontend-heavy** (generic `slack_history` command, parse in TS): `gh` title enrichment needs a
  shell-out anyway, splitting the logic across the IPC boundary.
- **Auto-tracking Slack's `last_read`** as the cursor: that's the user's Slack read state, not the
  tile's; a persisted per-tile `lastSeenTs` is independent and predictable.

## Deferred

- PR author/state from `gh` (richer than the Slack poster) · live updates via a future signals
  provider · auto-launching the worktree's Claude pane with a review prompt (the `claude` autostart is
  hardcoded today) · multiple PR links per message (first wins).
