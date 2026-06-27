# Slack tile + auth manager — design (sub-project 4)

> Status: design approved (brainstorming complete). This is the first real instance
> of the **provider + panel** pattern: a Rust-side provider that owns auth + a
> background poll loop and emits an event stream, paired with a React-side panel
> that renders it. Establishes the seam every later integration tile (Linear,
> GitHub, Calendar) reuses. Stack decisions live in `CLAUDE.md`; backlog in
> `docs/ROADMAP.md`.

## Goal

Build the first read-only integration tile — **Slack unread messages** — plus the
**auth manager** it needs (macOS Keychain token storage + a connections registry +
an auth UI). The tile lives in the **Cockpit view**'s left "TILES" column (top-left
in the product mockup). Read-only: the MVP surfaces unread messages and links out to
Slack; it does not send or mark-read.

## Scope

**In scope**
- Generic macOS **Keychain** token store (`keychain.rs`), reusable by all providers.
- **Slack provider** (`slack.rs`): browser OAuth (loopback redirect), Web API client,
  background poll loop, unread computation, event stream.
- **Connections registry** (`auth.rs`): list services + connected/disconnected status.
- **Cockpit view left "TILES" column** — a thin, reusable tile host — shipping **only**
  the Slack tile.
- **`SlackTile`** panel with all render states.
- **Settings "Connections" section**: connect/disconnect, one-time app credentials, and
  the **watched-channels picker**.
- `cockpit.json` config for Slack integration (non-secret fields only).

**Out of scope (deferred)**
- PR-reviews and CircleCI tiles (SP5/SP6), the center column (To Do / Timer / Tickets),
  the Diff tab — placeholders or untouched.
- Socket Mode / realtime push (polling only; see "Why polling, not Socket Mode").
- Send / reply / mark-read (read-only MVP).
- A dedicated full-page auth dashboard — the connections UI is a **section in the
  existing Settings modal** for now.

## Key decisions (from brainstorming)

| Decision | Choice | Why |
|----------|--------|-----|
| First tile | **Slack unread** | The product's headline "Slack first"; highest-value first panel. |
| Auth + fetch | **Browser OAuth + polling** | Proper browser auth (vision); user token sees DMs + private channels; no websocket risk in the first provider. |
| Realtime | **Deferred** | Socket Mode is the wrong tool here (see below). |
| Tile content | **Configured watched channels** | Matches "filter to a few important channels"; picker behind the ⚙ gear, persisted. |
| View scope | **Minimal reusable tile host**, Slack-only | Establishes the seam without overbuilding. |
| Provider shape | **Event-stream provider (mirror PTY)** | The pattern `CLAUDE.md` commits to; keeps polling/tokens in the privileged core. |
| Auth UI | **Section in existing Settings modal** | Simplest; already hosts Known Repos. |
| Click-out | **Open Slack permalink/deep link** | Read-only MVP "link out." |

### Why polling, not Socket Mode

Unread state is **per-user**, so the provider uses an `xoxp` **user token** and acts as
the user — it sees everything the user sees, **including DMs and private channels**.
Socket Mode delivers the *bot's* view, which **cannot see the user's DMs or private
channels at all**, and it still wouldn't compute "unread for me" (that needs the user's
`last_read` cursor from the Web API). So Socket Mode would sit on top of the polling
logic while only partially helping — wrong tool for a personal-unread tile. Smart
polling (every ~30s + on-window-focus, backoff when idle) is the correct long-term shape.

## Architecture

Two layers, one IPC boundary — the established Cockpit pattern.

### Rust core (`src-tauri/src/`)

- **`keychain.rs` — generic secure token store.** Thin wrapper over the `keyring` crate
  (macOS Keychain backend). API: `set(service, account, secret)`, `get(service, account)
  -> Option<String>`, `delete(service, account)`. Provider-agnostic; SP5+ reuse it
  verbatim. Wrapped behind a small trait so unit tests can use an in-memory fake.
- **`slack.rs` — the Slack provider.** Owns:
  - **OAuth**: builds the authorize URL; runs a transient loopback HTTP server on an
    ephemeral `localhost` port; exchanges the `code` at `oauth.v2.access` for the user
    token; stores it in Keychain.
  - **Web API client**: authenticated calls for conversation list, unread/last-read, and
    latest-message preview; name/avatar resolution.
  - **Background poll loop**: a `tokio` task; ~30s interval; emits `slack://unread`;
    backoff + `Retry-After` on HTTP 429; paused while disconnected.
  - **State**: cached token handle, watched conversation IDs, last snapshot, name/avatar
    cache.
- **`auth.rs` — connections registry.** `list_connections() -> [{ service, connected,
  label }]`. One entry (Slack) today; the shape later tiles extend.

### IPC surface (new commands)

- `slack_connect` — start OAuth; resolves when token stored (or errors/timeout).
- `slack_disconnect` — delete token from Keychain; stop polling; mark disconnected.
- `slack_status` — `{ connected, userName? }` (via `auth.rs`).
- `slack_list_conversations` — the user's conversations, for the watched-channels picker.
- `slack_set_watched(ids)` — update the watched set; triggers a refresh.
- `slack_set_credentials(clientId, clientSecret)` — store client_id (config) +
  client_secret (Keychain) for the one-time app setup.
- `slack_snapshot` — current unread snapshot (first paint).
- `slack_refresh` — force an immediate poll (manual + on-window-focus).

### Event

- `slack://unread` payload:
  ```
  {
    connected: bool,
    error?: string,
    conversations: [
      { id, kind: "channel"|"im"|"mpim", name, avatarUrl?, unreadCount, latestText, latestTs }
    ]
  }
  ```

### Frontend (`src/`)

- **`src/tiles/slack/SlackTile.tsx`** — the panel (matches the `src/tiles/worktree/`
  convention). Subscribes to `slack://unread`, seeds first paint from `slack_snapshot`.
- **`src/views/CockpitView.tsx`** — gains a left **`TileColumn`** that maps over a list of
  tile entries and renders each; ships with only `SlackTile`. Center remains the existing
  placeholder; the right worktree column is out of scope for SP4.
- **`SettingsModal.tsx`** — new **"Connections"** section (see UI below).

## Data flow

1. On Cockpit view mount, `SlackTile` calls `slack_snapshot` for first paint and
   subscribes to `slack://unread`.
2. The Rust poll loop wakes every ~30s (or on `slack_refresh`): for each **watched**
   conversation it computes unread count + latest-message preview + timestamp, resolving
   channel/DM names + avatars from a cache (filled via `conversations.info` / `users.info`).
3. It emits `slack://unread`; the tile re-renders.
4. Row click → `openUrl(<slack permalink or deep link>)`.

### Unread computation — endpoint to pin by live smoke

The exact Web API mix is the one implementation unknown, to be **pinned with a live smoke
test during implementation** (the same approach the deduce work used to pin MCP tool
names). Two candidates, recorded so the implementer doesn't re-derive them:

- **Official mix:** `conversations.info` (user token) for `last_read` / `unread_count_display`
  per watched conversation, plus `conversations.history` (limit 1) for the latest-message
  preview.
- **Fast path:** the desktop client's `client.counts` endpoint, which returns per-conversation
  unread counts + latest in one call (unofficial / undocumented — use only if the official
  mix proves too chatty against rate limits).

Either way the provider only polls the **watched** set, so call volume is bounded.

## OAuth flow (browser, loopback)

One-time setup: the user registers **their own** Slack app and enters its **client_id**
(stored in `cockpit.json`) and **client_secret** (stored in Keychain) in the Connections
section. Slack's `oauth.v2.access` requires the secret and Slack does not support PKCE, so
this credential step is unavoidable; it is a one-time action.

Connect:
1. `slack_connect` binds a transient loopback server on an ephemeral `localhost` port and
   opens the system browser to Slack's authorize URL with `redirect_uri=
   http://localhost:PORT/callback` and the user scopes:
   `channels:read`, `channels:history`, `groups:read`, `groups:history`, `im:read`,
   `im:history`, `mpim:read`, `mpim:history`, `users:read`.
2. The user authorizes; Slack redirects to the loopback with `code`.
3. Rust exchanges the code at `oauth.v2.access` → receives `authed_user.access_token`
   (`xoxp`) → stores it in Keychain → shuts down the loopback server.
4. Emits a connection-status update; the poll loop starts.

Timeout ~2 minutes with no callback; user-cancel handled gracefully (server torn down,
inline error in Settings).

## UI

### SlackTile

- **Header:** Slack icon · "SLACK" · ⚙ gear (opens the Connections section / watched picker).
- **Body rows:** channel `#` icon or DM avatar · name · latest-text preview (truncated) ·
  relative time · unread-count badge.
- **States:**
  - *Connected, rows* — watched conversations with unread, most-recent first.
  - *Empty* — connected, nothing unread → "All caught up."
  - *Disconnected* — CTA: "Connect Slack in Settings."
  - *Error* — keeps the last good snapshot + a subtle error indicator.

### Settings → Connections

- Slack status: "Connected as @you" / "Not connected."
- **Connect** / **Disconnect** buttons.
- One-time **client_id / client_secret** fields (shown when credentials are unset).
- **Watched-channels picker:** multi-select over `slack_list_conversations`; selection
  persisted to `watchedChannelIds`.

## Config / persistence

`cockpit.json` gains:

```
integrations: {
  slack: {
    clientId?: string,          // non-secret app id
    connected: boolean,
    userName?: string,          // "@you", for display
    watchedChannelIds: string[] // the watched set
  }
}
```

**Secrets — the user token and client_secret — live in Keychain only, never in JSON.**
The serde struct treats `integrations` as optional/defaulted so existing `cockpit.json`
files load unchanged (same back-compat discipline as the `knownRepos` legacy-string path).

## Error handling

| Condition | Behaviour |
|-----------|-----------|
| Not connected | Tile shows "Connect Slack in Settings" CTA; poll loop idle. |
| OAuth failure / cancel / timeout | Loopback torn down; inline error in Settings; remains disconnected. |
| Poll error / HTTP 429 | Keep last good snapshot; subtle error indicator; backoff (respect `Retry-After`). |
| Token revoked / invalid | Mark disconnected; prompt reconnect. |
| Missing client credentials | Connect button gated; prompt to enter client_id/secret first. |

## Testing

- **Rust units** (pure functions): unread computation from mocked API payloads,
  authorize-URL construction, watched-list filtering, snapshot serialization. Keychain
  exercised through its trait with an in-memory fake.
- **JS units**: `SlackTile` render states (rows / empty / disconnected / error),
  relative-time formatting, watched-picker selection logic.
- **Live smoke + GUI acceptance** (project convention): pin the unread endpoint with a
  real token; manually verify the OAuth round-trip end-to-end in the running app, and that
  a real watched channel's unread count + preview render and the row links out correctly.

## Reuse / forward seam

- `keychain.rs` and the `auth.rs` connections registry are provider-agnostic — SP5's Linear
  provider (also OAuth) reuses both wholesale.
- The `TileColumn` host renders any tile entry; SP5/SP6 add `LinearTile` / `PrTile` by
  dropping a component into the list.
- The provider shape (commands + a `*://*` event stream + background poll loop) is the
  template every later provider copies — this is the deferred `slack.rs` swap point noted
  in `CLAUDE.md` now made real.
