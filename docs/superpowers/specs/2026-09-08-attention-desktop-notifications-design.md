# Attention desktop notifications — design

**Date:** 2026-09-08
**Status:** implemented on `feature/attention-notifications`

## Problem

A Claude pane that finishes its turn rings the terminal bell. Cockpit marks the pane
(`attention` slice), glows its border and shows a "Check me out" badge. All three signals are
on screen — and on screen only. Cockpit spends most of its life behind an editor or a browser,
so a worktree can sit waiting for minutes before you switch back and notice.

## Requirement

Carry the same signal outside the window: a macOS notification naming the worktree, plus a
Dock bounce. It must not fire while you are looking at cockpit, because the glow already says it.

## Behaviour

- A pane is **newly** marked → one notification titled "Check me out", body = the worktree or
  scratch name.
- A pane that is already marked bells repeatedly while Claude waits. Only the first bell
  notifies. Cleared then re-marked counts as new.
- Several panes belling together each get a notification, but the Dock bounces **once**.
- **Silent while cockpit is focused.** The pane is already glowing in front of you.
- Off switch in Settings › Notifications (`preferences.notifyOnAttention`, absent = on). When
  off, nothing is sent and the window is not even asked whether it is focused.
- Best-effort throughout. A refused notification costs neither the Dock bounce nor the other
  panes' banners; the in-app badge is never affected.

### Naming

`ptyId` is `{entityId}:{role}`. The body names what you recognise — the worktree name, or the
scratch terminal's title. The role is appended only when it is not the pane you expect Claude
in, so `wt-1:claude` reads "auth0-provisioning" and `wt-1:shell-2` reads
"auth0-provisioning · shell-2". An entity removed between the bell and the lookup falls back to
the raw `ptyId` rather than notifying about nothing.

## Architecture

**A store subscriber, deliberately not a call inside `markAttention`.**

`workspace.ts` is unchanged. `startAttentionNotifier` subscribes to the store and compares
`prev.attention` with `st.attention`; `newlyMarked` returns the added keys. The slice stays a
pure session flag with no OS dependency, its tests stay untouched, and the bell path in
`useTerminal.ts` keeps one job. Every other store write reaches the subscriber too and is
rejected by an identity check — `clearAttention` already returns the same object when the key
is absent, so the map's identity is a reliable signal.

**The three OS calls are injected** (`AttentionPorts`: `isFocused`, `notify`, `bounce`), so the
decision logic is unit-tested against recording stand-ins rather than a mock of the Tauri
plugin. `livePorts` is the only untested code, and it has no branches worth asserting.

**Plugin:** `tauri-plugin-notification` v2, with `notification:default`,
`core:window:allow-is-focused` and `core:window:allow-request-user-attention` in the default
capability. The Dock bounce is `requestUserAttention(Critical)` — it bounces until cockpit is
focused, where `Informational` bounces once and is easy to miss.

## macOS findings

Verified by hand against the packaged `.app`, because macOS only delivers notifications to a
real bundle. Keep these — they are expensive to rediscover.

- **The first notification after install is always lost.** macOS reports
  `isPermissionGranted() === true` before any prompt has been shown, then consumes the first
  real delivery to raise its authorisation dialog. `primeNotifications()` runs at launch so the
  dialog lands on an empty screen rather than on a real "Check me out", but it cannot recover
  that one notification. Every later one is delivered.
- **Ad-hoc signature churn is harmless.** Each `tauri build` produces a different linker-signed
  identifier (`cockpit-664bb309ee213d33` → `cockpit-07e911b6cde1666e`). macOS keys the grant on
  `CFBundleIdentifier` (`com.cockpit.app`), so a rebuild does not reset permission.
- **`tauri dev` is not a valid test.** The dev binary is not a bundle. Test the packaged app.
- **The build is fast** — about 56s for a full `tauri build`, so the packaged-app loop is
  practical rather than something to design around.
- **Two copies of the bundle confuse the settings entry.** macOS recorded
  `path = /Applications/cockpit.app` with the `target/release/bundle/macos` build listed only as
  a `src`. Whichever copy you launch, System Settings attributes notifications to the first one
  it saw. `/cockpit-release` builds into `target/`, so a copy launched from `/Applications` runs
  stale code — see the release flow, not this feature, for the fix.

## Scope of effect

| Surface | Effect |
|---------|--------|
| Worktrees view | the feature — Claude panes and extra shells |
| Cockpit view | same, via the same panes |
| `host` role (dev server) | none — `isAttentionRole` excludes it, so a noisy dev server cannot notify |

## Testing

`src/worktrees/attentionNotifier.test.ts` — 18 tests. The pure helpers (`newlyMarked`,
`attentionLabel`) and the orchestrator (`notifyAttention`) are tested directly; the wiring is
tested against the **real** store, driving `markAttention` and asserting on the injected ports.
Only the OS boundary is stubbed.

Not covered by tests, by nature: whether a banner reaches the screen. That is what the manual
check against the packaged app is for.

## Rejected alternatives

- **Dock bounce alone.** One capability, no plugin, no permission prompt, and it works in dev.
  But it cannot say *which* worktree needs you, which is most of the value with three columns
  live, and it leaves nothing in Notification Centre for a banner you missed.
- **Calling `sendNotification` from inside `markAttention`.** Shorter, but it puts an OS
  dependency in a pure store slice and forces the slice's tests to mock the plugin.
- **Notifying on every bell.** Claude bells repeatedly while waiting; without the edge check a
  single waiting pane produces a stream of identical banners.
