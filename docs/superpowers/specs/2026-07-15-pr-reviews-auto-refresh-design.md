# PR Reviews tile — auto-refresh (design)

Date: 2026-07-15

## Problem

The PR Reviews tile (`src/tiles/pr/PrReviewsTile.tsx`) is manual-refresh only: the
one-shot `pr_reviews_fetch` command runs solely when the user clicks the refresh
button. New PR review requests posted to the watched Slack channel don't appear
until the user remembers to click. The Slack tile already feels live (Rust
background poll + refresh-on-focus); the PR tile should feel similar.

## Non-goals

- No Rust changes, no new command, no background thread, no push events. The fetch
  is cheap once caught up (a poll with nothing new is just a `conversations.history`
  call since the cursor — usually empty), so a frontend-driven refresh is enough.
- No store changes. Reuses `pr_reviews_fetch` + `applyPrFetch` unchanged.

## Design

Single-file change to `PrReviewsTile.tsx`. Refactor the current `refresh` into one
function parameterised by a `silent` flag, and add two automatic triggers.

### `doRefresh({ silent })`

```
guard: no channelId            → return
guard: a fetch is in flight    → return   // useRef, prevents interval/focus overlap
if !silent: setRefreshing(true); setError(null)
try:
  res = prReviewsFetch(channelId, lastSeenTs)
  if channel still current: applyPrFetch(res.items, res.newestTs); setRefreshedAt(now)
catch e:
  if !silent: setError(e)      // silent-run failures swallowed (console only)
finally: clear in-flight ref; if !silent: setRefreshing(false)
```

- **Manual button** → `doRefresh({ silent: false })` — unchanged: spinner + error banner.
- **Auto (interval + focus)** → `doRefresh({ silent: true })` — no spinner, no error
  banner. New items and the "Refreshed just now" timestamp still update, so liveness
  is visible without flicker.

The existing mid-fetch channel-switch guard ("only apply if the picked channel is
still the one we fetched") is preserved.

### Triggers (added to the tile's `useEffect`)

- `setInterval(() => doRefresh({ silent: true }), 120_000)` — **2 min**.
- `window.addEventListener("focus", () => doRefresh({ silent: true }))` — mirrors the
  Slack tile's on-focus refresh.
- Cleanup clears the interval and removes the focus listener on unmount.

### In-flight guard

A `useRef<boolean>` (not the `refreshing` state, which is async and now reflects only
manual runs) so a slow fetch can't overlap the next interval tick or a focus event.

## Timing rationale

PR review requests arrive over minutes/hours, not seconds. A 2-minute interval keeps
the tile live cheaply, and focus-refresh covers the "I just came back to the app"
case for immediacy. Slower than the Slack tile's ~30s because PR requests are lower
frequency and lower urgency.

## Testing

The change is React effect wiring over already-tested pure helpers (`mergePrItems`,
cursor advance) — no new pure logic to unit-test. Verify: `npm run build` + existing
Vitest suite green. GUI smoke pending human eyeball: confirm the tile picks up a new
PR request within ~2 min without clicking, refreshes on window focus, and that a
silent auto-refresh failure shows no error banner (manual still does).
