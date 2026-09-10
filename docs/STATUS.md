# Cockpit — status log

Completed work, newest last. Relocated out of `CLAUDE.md` (2026-09-10) to keep the
always-loaded file inside Claude Code's context limit. Read it when you need the
history of a feature: why it was built that way, what it superseded.

✅ **Sub-project 1 (layout shell + settings) — complete & merged to `main`.**
All tests green; GUI confirmed rendering. Plan:
`docs/superpowers/plans/2026-06-16-layout-shell.md`.

✅ **Sub-project 2 (worktree engine, manual) — complete.**
PTY provider, git provider, worktree composite tile, and default first-launch
instance all in place. 12 Rust tests + 14 JS tests green; Rust + Vite builds
clean.

✅ **Sub-project 3 (smart new-worktree, plain prompt) — complete.**
`deduce_worktree` IPC command, `KnownReposEditor`, prompt → deduce → pre-fill → banner
flow. 19 Rust tests + 15 JS tests green; Rust + Vite builds clean. Manual GUI acceptance

✅ **Source-type iteration 1 (Linear) — code complete & reviewed.**
`detect_linear_ref`, MCP-enabled ticket path, `sourceResolved` guardrail, `ensure_ref_prefix`,
ticket link auto-staged on Create. 28 Rust tests + 22 JS tests green; Rust + Vite builds clean.
Live + GUI acceptance **verified** — in-app deduce of a real ticket resolves via the Linear MCP;
`LINEAR_ALLOWED_TOOLS = "mcp__linear"` + `LINEAR_MODEL = "claude-haiku-4-5"` pinned (no `--permission-mode` needed).

✅ **Source-type iteration 2 (GitHub) — code complete & reviewed.**
`detect_github_ref`, `gh`-CLI fetch (no MCP), `match_repo` via origin-remote, `apply_github_overrides`
(PR → `BranchSpec::Pr { number }` + `pr-<N>` in name; issue → new branch with `issue-<N>`), source-neutral
rename (`sourceUrl`/`sourceTitle`/`sourceLinkFrom`), resolved link auto-staged on Create. PR checkout is
fork-safe: `git worktree add --detach` then `gh pr checkout <N>` inside the worktree; `pr_number` threaded
deduce → frontend → `BranchSpec`. 38 Rust tests + 22 JS tests green; Rust + Vite builds clean.

✅ **Source-type iteration 3 (Slack) — code complete. All three source types done.**
`detect_slack_ref`, MCP-enabled message+thread fetch via `SLACK_ALLOWED_TOOLS`/`SLACK_MODEL`, `DEDUCE_SCHEMA_SOURCE`
rename, `sourceResolved` guardrail, deterministic `source_url` from the pasted permalink, no id pinning (new
agent-named branch), resolved Slack link auto-staged on Create. Frontend unchanged (source-neutral seam reused).
41 Rust tests + 22 JS tests green; Rust + Vite builds clean. **`SLACK_ALLOWED_TOOLS = "mcp__slack"`,
`SLACK_PERMISSION_MODE = "bypassPermissions"`, `SLACK_MODEL = "claude-haiku-4-5"` pinned by a live smoke
(2026-06-22)** — a real DM permalink resolved end-to-end (private/DM access + bare-permalink resolution confirmed).
The Slack connector needs the permission bypass even when allow-listed (Linear does not). GUI end-to-end

✅ **Existing-branch + scratch terminals iteration — complete & merged to `main`.**
Slot entities (worktree | scratch), `SlotColumn`/`WorktreeBody`/`ScratchBody`, the Checkout flow with
`list_branches` (recency-sorted, already-checked-out branches disabled), instant scratch login-shells, the
`Worktree · Checkout · Terminal` header, and the global form-control theme baseline. 46 Rust tests + 43 JS
tests green; Rust + Vite builds clean. **GUI + live acceptance verified.**

✅ **Sub-project 4 (auth manager + Slack unread tile) — code complete & merged to `main`. First real provider+panel instance.**
The deferred `slack.rs` Rust provider swap point is now built (the deduce flow still uses the Slack MCP; this is a
separate in-app provider). **Keychain** (`src-tauri/src/keychain.rs`): generic `TokenStore` trait + `KeyringStore`
(real, `keyring` v3 `apple-native`) + a `#[cfg(test)]` `MemoryStore` fake; service `com.cockpit.app.slack`, accounts
`user_token`/`client_secret`. **Slack provider** (`src-tauri/src/slack.rs`): browser OAuth via a transient `tiny_http`
loopback server on ports 9000-9009 (`oauth.v2.access` → **`xoxp` user token**, stored in Keychain), a blocking `ureq`
Web API client, and a background poll thread (~30s + on-window-focus `slack_refresh`) emitting `slack://unread`
snapshots. **At-most-one poll thread** is guaranteed by a generation counter (`poll_gen: Arc<AtomicU64>`): each
`start_polling` takes `fetch_add(1)+1` and exits when the counter moves on; `slack_disconnect` bumps it to stop the
live thread. **Mutex discipline:** the state guard is cloned-then-dropped before every network call (verified). 9
commands (`slack_set_credentials/_set_watched/_connect/_disconnect/_status/_snapshot/_refresh/_list_conversations/_init`)
+ `auth::list_connections` (a connections registry seam SP5 reuses; the single-service UI reads `slack_status` directly).
**Secrets never touch JSON** — `cockpit.json` holds only `integrations.slack = { clientId?, watchedChannelIds }`
(`#[serde(default)]`, back-compat); the `xoxp` token + `client_secret` live in Keychain only; no third-party server
(talks directly to Slack). **Frontend** (`src/tiles/slack/`): `SlackTile` (Cockpit-view left TILES column; subscribes
to `slack://unread`, first paint from `slack_snapshot`, states: disconnected CTA / "All caught up" / rows / error;
row click → `openUrl` Slack deep link), pure `time.ts`/`rows.ts` helpers (tested), `SlackConnections` (Settings →
Connections: credentials, connect/disconnect, watched-channels picker; buttons themed via the `nw-form` idiom).
`App.tsx` hydrates the provider via `slack_init` after settings load (starts polling if a token already exists). One-time
user setup: register your own Slack app, add User Token Scopes + redirect `http://localhost:9000-9009/callback`, paste
client id/secret. 60 Rust + 53 JS tests green; builds warning-free. Spec: `docs/superpowers/specs/2026-06-27-slack-tile-and-auth-manager-design.md`;
plan: `docs/superpowers/plans/2026-06-27-slack-tile-and-auth-manager.md`.
**Unread Web API field paths PINNED (2026-07-01 live smoke + bugfix):** `conversations.info` does **NOT** return
`unread_count`/`unread_count_display` (both absent) — the original `parse_conversation` read `unread_count_display`,
so the count was always 0 and the tile never showed anything. Fixed: unread is now derived from `last_read` (returned
by `conversations.info`) vs a `conversations.history` window (`limit=50`) — `unread_count` = messages with
`ts > last_read` (fixed-width `epoch.micros`, lexicographic compare); newest message drives the preview. Verified live
against a real unread.
unread + preview + relative time and the row links out. Note: the tile only shows **watched** channels, so a channel
with unreads must be added via the watched-channels picker first. **Deferred follow-ups:** resolve a display name (status shows raw `U…` id); add a CSRF
`state` param to the OAuth flow (SP5 Linear OAuth will copy this template); Socket Mode realtime push (polling-only by
design — see spec "Why polling, not Socket Mode"); a few hardcoded CSS values; skip per-conversation `info` errors for
stale watched ids.

- **Slack tile: opt-in DMs + searchable picker + robust unread + refresh (2026-07-01, merged to `main`).** Adds
direct-message tracking, a searchable picker, a manual refresh, and fixes two Slack-provider bugs. **Supersedes** the
older "watched channels only" / 50-message-window notes above.
  - **DMs are OPT-IN, not auto-tracked — and why.** A first attempt auto-discovered every DM each poll cycle
    (`users.conversations` types=im,mpim → merge with watched → poll each). But that method returns **all historical
    DMs** (130 on the real account), and Slack exposes **no cheap per-conversation unread or recency signal** and **no
    `client.counts`-style aggregate endpoint for user tokens** (verified against docs.slack.dev). Every DM must be probed
    with `conversations.info` + `.history` (2 Tier-3 calls each), so auto-tracking fired ~260 calls/cycle in a sub-second
    burst → **Slack `429`**, and conversations were silently dropped. **Decision:** DMs are opt-in. `watched` is again the
    single source of truth (channels **and** DMs); only the user's selection is polled — small, bounded, never bursts.
    `discover_dm_ids`/`merge_poll_ids`/`MAX_POLLED_DMS` were removed. (Cheap "new-DM detection" via an im-id set-diff was
    considered and **deferred** — it's undocumented whether a new inbound DM surfaces as a new `im` id, and it wouldn't
    catch new unread in *existing* DMs anyway.)
  - **Picker now lists channels + DMs, all opt-in, searchable.** `slack_list_conversations` requests
    `public_channel,private_channel,im,mpim` again; pure tested `list_row` builds each `ConversationMeta`. DM names in the
    picker come from the **in-memory `user_names` cache** (no per-DM `users.info` at list time → no burst), falling back to
    the partner user-id. Frontend: pure `filterConversations(convs, query)` (`src/tiles/slack/watchFilter.ts`, tested)
    backs a search box above the list in `SlackConnections.tsx`; rows show `#`/`@` by kind. The orphan-prune (added when
    the picker was briefly channels-only) was removed — DM ids are valid selections again.
  - **DM name resolution (live).** `poll_once` resolves a 1:1 DM partner's display name via `resolve_user_name`
    (`users.info`, cached in `SlackState.user_names` — in-memory only); group DMs keep Slack's synthetic `mpdm-…` name.
    `parse_conversation` gained an `im_name: Option<&str>` param (pure; falls back to id).
  - **Unread bugfix (marked-unread of any age).** History is now fetched with **`oldest=last_read`** (inclusive=false)
    instead of a fixed `limit=50` window. Marking a message unread **rewinds** Slack's read cursor arbitrarily far back;
    the old window missed those. `oldest=last_read` returns *exactly* the unread set regardless of age.
  - **`429` safety net.** `api_get` now honors the `Retry-After` header on a 429 (sleep ≤30s, retry once) — a transient
    throttle becomes a brief pause, not a dropped conversation + error banner.
  - **Refresh button** on the tile (`SlackTile.tsx`): manual re-poll via the existing `slack_refresh`, with a spinning
    `RestartIcon` while in flight; disabled when disconnected/refreshing.
  - **Config note:** DMs are stored as their `D…` conversation ids in `integrations.slack.watchedChannelIds` (same field
    as channels — the id kind is opaque to storage). 72 Rust + 80 JS tests green; Rust + Vite builds clean.
    DM's unread shows with the partner's name + preview.

✅ **To Do + Timer tiles (+ shared `<Tile>` shell) — complete & merged to `main`.** A reusable **`<Tile>`** chrome shell
(`src/tiles/Tile.tsx` — header `icon · TITLE · actions` over a bordered body; `SlackTile` was refactored onto it) now
backs all tiles. Two local, no-auth **center-column** widgets: a **Timer** (`src/tiles/timer/` — a session-only countdown,
25-min default, Start/Pause/Reset, `formatTime` tested; nothing persisted) and a **To Do** list (`src/tiles/todo/` —
3-state items `todo → in_progress → done` that **cycle on click and wrap**, sections hidden when empty, add/delete;
`nextState`/`groupByState` tested). To Do **persists** in `cockpit.json` via a new `todos: TodoItem[]` field
(`{ id, text, state }`, ids `crypto.randomUUID()`, `#[serde(default)]` back-compat); store actions `addTodo`/`cycleTodo`/`removeTodo`.
Spec/plan: `docs/superpowers/{specs,plans}/2026-06-27-todo-and-timer-tiles*`.

- **To Do tile: inline edit + drag-reorder (2026-07-03).** Todos are now **editable inline** — click the `.todo__text`
  span → it becomes an `<input>` (autoFocus, seeded); **Enter/blur saves, Escape reverts, empty save deletes**
  (the delete-on-empty rule lives in the store's `editTodo`, not the UI). Rows are **reorderable within their section**
  by a `⋮⋮` **drag handle** using **pointer events**
  (`onPointerDown` + `setPointerCapture`, then `document.elementFromPoint(...).closest("[data-todo-id]")`
  to hit-test the row under the cursor; `touch-action: none` on the handle is required or the browser
  claims the gesture and pointermove stops firing). **HTML5 DnD is unavailable app-wide** — Tauri's
  `dragDropEnabled: true` (needed for real filesystem paths on file drop) swallows DOM drop events on
  macOS, so never reach for `draggable`/`onDrop` in this app. Dropping calls `reorderTodo(draggedId, targetId)`.
  The section constraint is enforced in the
  **pure tested helper `reorderWithinState`** (`todo.ts`) — a **no-op** unless both ids exist, differ, and share the
  same `state` (cross-section drags change nothing; state is still changed only by the glyph click). Insert semantics:
  insert-after on move-down, insert-at on move-up (standard DnD idiom). A `dragOverId` local state drives a
  `.todo__row--drop-target` top-border highlight; `cursor: grab` on rows. **No schema change** — order is intrinsic
  to the `todos` array. New store actions `editTodo(id,text)` / `reorderTodo(draggedId,targetId)`. 96 JS tests green
  (5 new `reorderWithinState` cases); tsc + Vite build clean.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-07-03-todo-inline-edit-and-reorder*`.

- **To Do tile: list tabs (2026-07-30).** The tile's backlog is split into user-named **tabs**
  (`todoLists: TodoList[]` + `activeTodoList?` in `cockpit.json`; each `TodoItem` gains an optional
  `listId`). The rule is **unstarted work is per-list, touched work is global**: `TODO` shows the active
  tab only, while `IN PROGRESS` and `DONE` show items from **every** list, each row prefixed with its
  list name (`.todo__list-tag`) — so in-flight work is never hidden behind a tab. `DONE` is collapsed
  behind a `▸ DONE (n)` toggle (session-only local state, starts collapsed). **No migration write:** two
  pure resolvers in `todo.ts` do the work — `resolveLists` turns an empty `todoLists` into a synthesised
  `{ id: "default", name: "General" }`, and `listIdOf` resolves an absent *or dangling* `listId` to the
  first list, so a pre-tabs config renders as one "General" tab and an item can't be orphaned by deleting
  a list. **Gotcha:** `addTodoList`/`addTodo` must **materialise** `DEFAULT_LIST` into `todoLists` before
  appending, or every legacy list-less item would silently jump into the newly added tab (they resolve to
  `lists[0]`). Tab management: `+` adds (inline name input), clicking the **active** tab's name renames it
  (empty **reverts** — unlike `editTodo`'s delete-on-empty, since a nameless tab is meaningless), and `✕`
  deletes — rendered only when that list holds zero items in any state and isn't the last one
  (`canDeleteList`, enforced in the store too). That gate is the whole safety story: no confirm dialog, no
  path that silently drops items. **`reorderWithinState` is unchanged** — its same-state guard suffices,
  because only the active list's TODO rows are ever on screen, so a cross-list TODO drag is unreachable
  rather than merely rejected. Rust: `TodoList` + `todo_lists`/`active_todo_list`/`list_id`, all
  `#[serde(default)]`. 245 JS + 131 Rust tests green (30 new JS, 3 new Rust); tsc + Vite + cargo clean.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-07-30-todo-list-tabs*`.

- **To Do tile: reorderable tabs + per-tab DONE (2026-08-19).** Tabs drag-reorder with the rows'
  pointer-event idiom, started from the tab itself behind a **5px movement threshold** so a plain click
  still switches/renames; the pointer is captured only once the threshold is crossed, which also
  retargets the gesture's eventual `click` to the wrapper span — that retargeting is what stops the tab
  button's onClick from ALSO firing after a drag (capture on pointerdown would kill plain clicks
  outright). Pure `reorderLists` (same insert semantics + no-op guards as `reorderWithinState`) + store
  `reorderTodoList`; order IS the persisted `todoLists` array order, so no schema/Rust change. The drop
  indicator is two-sided (pure `dropEdge`): a rightward drag inserts AFTER the target so it marks the
  trailing edge, leftward the leading edge — one fixed edge reads off-by-one in one direction (the rows'
  single top-border indicator still has that quirk). **DONE is
  now per-tab like TODO** (the tabs rule is now: unstarted and finished are per-list, in-flight is
  global) — `todosInList(items, lists, listId, state)` replaces `activeTodos` and feeds both sections;
  DONE keeps its collapsed `▸ DONE (n)` toggle and drops the list-name prefix; IN PROGRESS is unchanged.
  `canDeleteList` already counted every state, so no orphaning path opened.

✅ **Cockpit worktree column — complete & merged to `main`.** The Cockpit view's **right column** is now a worktree pane,
reusing `SlotColumn` (its selection was refactored to be **prop-driven** — `value` + `onSelect` — so one component backs
the Worktrees view's session slots and the Cockpit view's **persisted** slot). New persisted
`cockpitWorktreeId` field in `cockpit.json` (`#[serde(default)]`, omitted when cleared); store action `setCockpitWorktree`.
Empty until assigned (the existing `SlotColumn` empty body). **View-dependent placement** (`placeNewEntity(id, view)`, the
active `view` threaded from `App` into the Terminal button + `NewWorktreeModal`): creating on the **Cockpit** view sets the
right-column slot (replace) + fills a free Worktrees slot if any (no eviction); creating on the **Worktrees** view fills
a free slot else replaces the last *visible* slot, Cockpit untouched. New pure helper `fillFreeSlot` (no-eviction) +
`visibleCount`-aware `assignNewWorktree`; `removeWorktree`/`removeScratch` clear `cockpitWorktreeId` too; `addScratch` is
create-only (placement is `placeNewEntity`'s job). Right column is `500px` wide. GUI-approved. Spec/plan:
`docs/superpowers/{specs,plans}/2026-06-29-cockpit-worktree-column*`.

✅ **Worktree teardown actions (Close/Pause/Delete/Wipe) — complete & merged to `main`. Fixes a major bug.** The
slot column's old `Hide`/`Delete` never ran `git worktree remove`, so git's `.git/worktrees/<ref>` registration
survived and the branch stayed checked out there — uncheckoutable anywhere else. The gear menu now has **four
cumulative actions**, each removing one more attached thing: **Close** (unassign slot) ⊂ **Pause** (+ kill the
worktree's live PTYs — since 2026-07-10 the live pane set, not a fixed 3; keep model/dir/branch, re-selectable) ⊂
**Delete** (+ `git worktree remove [--force]` + drop model; **branch
kept**) ⊂ **Wipe** (+ `git branch -D` — **local branch only, remote untouched**). Scratch entities get only
Close + Delete (no git). **Delete/Wipe open `TeardownConfirm`** (reuses `<Modal>`), which probes dirtiness via
`worktree_status` (`git status --porcelain`; missing dir → `{exists:false,dirty:false}`, git error on an existing
dir → `dirty:true` safe default), warns if dirty, and **force-removes only on confirm** (Confirm disabled until the
probe returns; scrim-dismiss blocked while busy). Three new Rust commands in `worktree.rs` (`worktree_status`,
`remove_worktree`, `delete_branch`) with pure tested arg-builders (`worktree_remove_args`, `delete_branch_args`);
`remove_worktree` falls back to `git worktree prune` when the dir is already gone (deregisters the stale entry — the
core fix). Frontend: typed `api.ts` wrappers (`removeWorktreeGit` named to avoid colliding with the store's
model-only `removeWorktree`), a **dependency-injected `teardownWorktree` helper** in `src/worktrees/teardown.ts`
(no React — unit-tested for ordering [PTYs killed before remove] and error handling [remove failure keeps the model
& propagates; branch-delete failure is a non-fatal warning, model still dropped]). **Icons:** new shared SVG glyphs
in `views/icons.tsx` — Close ✕ · Pause ∥ · Delete 🗑 (Bin) · Wipe 👻 (Ghost); the menu rows gained roomy clickable
padding. **`GearIcon` was an 8-ray sun, not a cog** — replaced with a true toothed gear (this was the "brightness
icon" across the top banner + slot column); the Slack tile's unicode `⚙` switched to the same shared `GearIcon` so
all three settings affordances match. **Wrap-up:** force-removed 5 pre-existing orphaned worktrees (branches
preserved) so we start clean. 67 Rust + 74 JS tests green; builds clean. **GUI-approved.** Spec:
`docs/superpowers/specs/2026-06-29-worktree-teardown-actions-design.md`.

✅ **Cockpit Diff tab — complete & merged to `main`. GUI-approved.** The Cockpit view's **centre column** now
has a `Home | Diff` tab bar (`CockpitView.tsx`; underlined-active `.cockpit-view__tab*` styling): **Home** shows
the local widgets (Todo/Timer), **Diff** shows the **right-column** worktree's (`cockpitWorktreeId`) branch-vs-base
diff, or a "Select a worktree…" message when the right column is empty/holds a scratch. Tab state is **session-only**
(defaults to Home). This realises the product spec's centre-column "🌶️ diff" override (§Centre). The worktree column
(`SlotColumn`/`WorktreeBody`/`WorktreeColumn.css`) is **untouched** — terminals only. *(First cut placed the tabs in the
worktree column; moved to the centre to match the design.)*
- **Diff scope:** `git diff --merge-base <base>` in the worktree dir — diffs the merge-base of `base..HEAD` against the
  **working tree**, so it captures both committed changes and Claude's **uncommitted** edits ("what does this branch
  contain right now"). `base` is **not** persisted: the frontend passes `base=""` and the backend derives the repo
  default branch from `origin/HEAD` (a self-contained `symbolic-ref` helper in `worktree.rs`, decoupled from
  `deduce.rs`). When that symref is absent — locally-init-ed repos never get one, only `git clone` creates it; the
  cockpit repo itself was the case (fixed 2026-07-09, plus a one-off `git remote set-head origin -a` there) — it
  falls back to `refs/remotes/origin/main` then `origin/master` if the remote-tracking ref exists (same convention
  as `is_default_branch`); neither → inline error.
- **Backend (`src-tauri/src/worktree.rs`, mirrors `worktree_status`):** pure tested `diff_stat_args`
  (`diff --merge-base <base> --numstat`), `file_diff_args`, `parse_numstat` (binary files → `-`/`-` → `binary:true`,
  0 counts); structs `DiffFile`/`DiffResult` (`camelCase`); private `repo_default_branch` + `resolve_base`; commands
  `worktree_diff(worktreePath, repoPath, base)` and `worktree_file_diff(…, path)` (raw patch, fetched lazily on expand),
  both registered in `lib.rs`.
- **Frontend:** `DiffView.tsx` (fetch on mount + manual refresh with a spinning `RestartIcon` + an `as of HH:MM:SS`
  timestamp — **snapshot only, no polling**; live updates deferred to the future live-signals provider); pure tested
  `diffLines.ts` `parseHunks` (classifies `+`/`-`/`@@`/context, drops `diff --git`/`index`/`---`/`+++`/rename headers)
  colorized via `--diff-add`/`--diff-del` tokens; `api.ts` `worktreeDiff`/`worktreeFileDiff` wrappers + `DiffFile`/
  `DiffResult` types. Empty diff → "No changes vs <base>"; errors surface inline (git stderr). 30 Rust (6 new) + 85 JS
  (5 new) tests green; Rust + Vite builds clean. Spec:
  `docs/superpowers/specs/2026-07-03-cockpit-diff-tab-design.md`.

✅ **Instant, non-blocking Deduce flow (2026-07-06).** The old blocking Deduce ceremony (open modal → click
Deduce, wait 15–43s staring at it → review pre-filled fields + banner → click Create, wait on git) is **replaced**:
the **Worktree** modal is now just a **prompt textarea + Create** (no fields, no separate Deduce step, no
review/confirm). On submit the **modal closes immediately** and a **spinning pending tile** claims a slot; the
`deduce_worktree` → `create_worktree` chain runs in the **background** (non-blocking *since the 2026-07-10
`(async)` fix below* — plain sync commands actually run on the macOS main thread; these are now
`#[tauri::command(async)]`). When create resolves, the real
worktree **swaps into the same slot in place**. On failure the tile is discarded and the modal **reopens with the
prompt pre-filled + the error**. **Checkout / existing-branch flow is untouched.**
  - **Pending entity** = a third session-only `SlotEntity` kind (`{ kind:"pending"; pending }`), mirroring the
    `scratchTerminals` slice: `PendingWorktree { id:`pending-<n>`, prompt, status:"deducing"|"creating", view }` in
    `src/views/slots.ts`; `resolveSlotEntity` gained a defaulted 4th `pending` arg (3-arg callers still compile). New
    pure `swapSlotId(slots, from, to)` (1:1 in-place replacement — keeps the tile in the SAME slot; chosen over
    re-running `placeNewEntity`, which could relocate/evict if the layout changed during the ~30s deduce).
  - **Orchestration lives in the store** (`startDeduceWorktree(prompt, view)` in `src/settings/store.ts`), not the
    form's local async — so it survives the modal closing. It places a `pending-<n>` via the existing
    `placeNewEntity`, then a fire-and-forget async: `deduceWorktree` → (guard: pending still live?) → status→creating
    → resolve host from the repo's saved default (same precedence as the old `runDeduce`) → `branchSpecFrom` →
    `createWorktree` → (guard) → `addWorktree(makeWorktree(...))` + `swapSlotId(pending→real)` + swap
    `cockpitWorktreeId` if held + drop the pending entity. **catch:** drop pending, `clearEntity` its slot, set
    session-only `worktreeError = { prompt, message }`. `isLive()` guards handle the user repicking/closing the slot
    mid-flight (abandon quietly; an orphaned git worktree in the rare post-create removal is accepted, YAGNI —
    **no cancel button**).
  - **Reopen-on-failure:** `App.tsx` watches `worktreeError` (`useEffect` → `setCreating("deduce")`); modal `onClose`
    calls `clearWorktreeError()` so a stale error can't re-trigger. The trimmed `NewWorktreeForm` seeds its prompt
    from `worktreeError?.prompt` and shows `worktreeError.message`.
  - **Rendering:** new `src/views/worktree-column/PendingBody.tsx` (CSS spinner + `deducing…`/`creating…` +
    prompt); `SlotColumn` resolves pending, renders `PendingBody`, **gates the gear menu off** for pending, and shows
    a synthetic disabled `<option>` in the picker (a pending id isn't in the worktree/scratch lists). CSS spinner
    (`.wt-col__spinner` + `@keyframes wt-spin`) in `WorktreeColumn.css`. `CockpitView` reuses `SlotColumn` so it
    renders pending tiles too.
  - `NewWorktreeForm` was gutted to a prompt-only form (filename kept); `NewWorktreeModal` deduce branch now
    `<NewWorktreeForm view onClose />` (no `onCreated` — the store owns placement). `FORM_DEFAULTS`/`branchSpecFrom`/
    `sourceLinkFrom`/`makeWorktree` still exported (reused by the store action + model tests). 104 JS (+8) + 80 Rust
    tests green; tsc + Vite + cargo builds clean.
    window can't be driven headlessly): confirm instant close + spinner, `deducing…`→`creating…`→real tile in the
    same slot, other-tile interaction while spinning, and the failure-reopen path.
  - **Unified New modal + single `+ New` nav button (same session).** The header's three buttons (`Worktree ·
    Checkout · Terminal`) collapsed into one **`+ New`** (`App.tsx`; `creating` state is now a plain boolean, no
    `initialMode`). `NewWorktreeModal` dropped its Deduce/Existing-branch segmented toggle and now **stacks one
    panel**: `NewWorktreeForm` (prompt + **Create**) → `<hr className="nw-modal__sep">` → `ExistingBranchForm`
    (repo→branch→name→Create) → separator → a **Terminal** button (`placeNewEntity(addScratch(), view)` — the old
    top-nav wiring, relocated). **All three actions close the modal on success.** `NewWorktreeForm` lost its
    redundant `cancel` button (the modal owns close/scrim). CSS: removed `.nw-modal__mode*`; added `.nw-modal__sep`
    + `.nw-modal__terminal` in `Modal.css`. Pure UI restructure — no store/Rust changes; 104 JS tests still green.
    Each section now has a **bold icon heading** (`SectionHeading` in `NewWorktreeModal`, `.nw-modal__heading`):
    **Deduce** (`wt-ico--claude`), **Checkout** (`wt-ico--branch`), **Terminal** (`wt-ico--terminal`) — reusing the
    slot columns' masked-PNG glyphs. All three Create buttons are **full-width accent** and identical (the terminal
    button copy is now "Create"; `.eb-form__create` widened; the grid-child `.nw-form__create` already stretched).
    **Cmd/Ctrl+N** opens the modal (a second global `keydown` effect in `App.tsx`, mirroring the zoom shortcuts;
    `preventDefault` claims the combo from the browser's "new window"). **Escape closes any modal** — a `keydown`
    effect in the shared `Modal` component (`views/Modal.tsx`), so it's universal (New worktree, Settings,
    TeardownConfirm); it invokes the caller's `onClose`, so a guarded no-op (TeardownConfirm while busy) is respected.

- **Deduce prompt → Claude pane (2026-07-08).** A deduce-created worktree persists the raw user prompt
  (`Worktree.prompt?`, `#[serde(default)]` + omitted-when-none — back-compat). The claude pane **auto-sends it
  once**: session-only `initialPromptPending[worktreeId]` (set by `startDeduceWorktree`) switches the autostart to
  `claude '<escaped prompt>'` (pure `claudeAutostart`/`claudePaneAutostart` in `src/worktrees/claudeCmd.ts`, POSIX
  `'\''` escaping); the flag clears via `useTerminal`'s new `onEnsured` hook after the first `pty_ensure`, so the
  restart button and app relaunches run plain `claude` (no re-send into a live session). `useTerminal` now holds
  `autostartCmd` in a **ref** (dropped from the mount deps) — clearing the flag doesn't recreate the xterm and can't
  race a plain-command spawn. Backup: a **copy-prompt button** (`CopyIcon`, new `action` header slot on
  `WorktreePane`) on the claude pane whenever `worktree.prompt` exists. Auto-send is a CLI arg, so Claude queues it
  behind the trust-folder dialog — no PTY typing race. Checkout/manual/scratch unchanged; **no Rust PTY changes**.
Spec: `docs/superpowers/specs/2026-07-08-deduce-prompt-to-claude-design.md`.

- **Worktree lazy panes (2026-07-10).** A worktree column now starts as ONE full-height Claude pane; the
  **git pane is gone** and the localhost pane is no longer spawned at creation. A bottom action bar
  (`.wt-col__actions`, `WorktreeBody`) has **▶ Run** (`PlayIcon` — spawns the `host` pane running
  `host.startCmd`; disabled while running or when startCmd is blank, with a title hint) and **+ Add**
  (`PlusIcon` — up to `MAX_EXTRAS = 2` plain shells, roles `shell-<n>` with a **monotonic per-worktree seq**
  so a closed pane's PTY scrollback is never reattached; cwd = the worktree, no autostart), each ~50% width.
  State is the **session-only** `worktreePanes` store slice over pure helpers in `src/worktrees/paneSet.ts`
  (`paneRoles`/`runHost`/`addExtra`/`removePane`/`isPaneOpen`/`togglePane`/`expandPane`; `EMPTY_PANE_SET` =
  Claude-only, all open). The persisted **`paneOpen` field was deleted** (TS `PaneOpenState` + Rust `PaneOpen`
  / `pane_open`; legacy `cockpit.json` still loads — serde ignores unknown fields, proven by
  `worktree_ignores_legacy_pane_open`), so pane existence AND collapse/expand are session-only now: on
  restart every worktree is Claude-only again. **Superseded 2026-07-29 (session restore):** pane sets are
  now restored from the persisted `workspace` block's `panes` map — see that note below; the underlying
  PTY processes are still session-only (a restored pane starts bare). **Close on host/extras REMOVES the pane** (`WorktreePane`'s new
  optional `onClose`: `pty_kill` + `removeWorktreePane` + clear attention); Close on the Claude pane keeps the
  built-in respawn-bare behavior (it can't be removed). Extra shells arm the attention highlight
  (`isAttentionRole` now matches `shell-<n>`). **Teardown/Pause kill the LIVE pane set** —
  `killWorktreePtys(id, roles)` + `teardownWorktree(…, roles)` derive roles from
  `paneRoles(worktreePanes[id] ?? EMPTY_PANE_SET)` (the fixed `WORKTREE_ROLES` list is deleted); **Pause also
  resets the pane set** so a paused worktree returns Claude-only instead of silently re-running the dev server.
  A **pin button** (`PinIcon`, end of the chips row, `pinnable` prop threaded only from `WorktreesView`;
  Cockpit doesn't pass it) toggles `cockpitWorktreeId`. **No new Rust surface** (only the `pane_open` field deletion).
  Spec: `docs/superpowers/specs/2026-07-10-worktree-lazy-panes-design.md`;
  plan: `docs/superpowers/plans/2026-07-10-worktree-lazy-panes.md`.

✅ **PR Reviews tile (2026-07-07) — code complete.** A manual-refresh tile below the Slack tile (Cockpit TILES
column) listing PR review requests posted to one configured Slack channel; each item = `repo · #number · Slack
author` + the **exact PR title** (via `gh pr view --json title`, 10s timeout, Slack-text fallback) + an optional
**SHIP/SHOW/ASK badge** (standalone **uppercase-only** token — prose like "can you show me" must not badge), with **Remove** (durable) and
**+ Review** (fires the existing `startDeduceWorktree(prompt, "cockpit")` background flow — the GitHub source
path checks the PR out; failures reuse the `worktreeError` modal-reopen). **Backend:** one one-shot command
`pr_reviews_fetch(channelId, oldest?)` in `src-tauri/src/pr_reviews.rs` (no polling/events — the refresh button
drives everything); reuses the Slack provider's keychain token, `api_get` (429 retry), `conversations.history`
with `oldest=<cursor>` (exclusive), and `resolve_user_name` + the `user_names` cache (bot posts fall back to
`username`, else "unknown"). PR links parse from plain URLs **and** Slack mrkdwn `<url|label>` segments (label
kept as fallback title; issues links don't qualify); `newestTs` = max ts over ALL fetched messages so the cursor
advances past chatter; history is **paginated** via `response_metadata.next_cursor` (bounded 5×200) so a big
backlog isn't silently dropped; first refresh (`oldest=None`) is a `limit=1` cursor-seed only ("start empty" — items appear
from the next message onward; an empty channel seeds `"0"` so its first message counts); the `user_names`
write-back uses `extend` so concurrent poll-thread additions survive. Pure tested fns: `extract_pr_ref`, `extract_mode`, `newest_ts`, `fallback_title`,
`parse_title`, `pr_title_args`, and the DI'd `build_item`; `github.rs::run_gh`/`parse_github_url` made
`pub(crate)` for reuse. **Persistence:** `integrations.prReviews = { channelId?, lastSeenTs?, items[] }` in
`cockpit.json` (`#[serde(default)]`, back-compat tested; items carry `mode?`). **Frontend:** `src/tiles/pr/`
(`PrReviewsTile` on the `<Tile>` shell; `merge.ts` `mergePrItems` dedupes incoming by PR `url` and prepends
newest-first), store actions `setPrChannel` (clears the cursor — it belongs to a channel — keeps items) /
`applyPrFetch` / `removePrItem`; a single-select **"PR reviews channel"** radio picker (channels only, searchable)
added to `SlackConnections`. "Refreshed Xm ago" is session-only; a mid-fetch channel switch drops the stale
result (guard in the tile's refresh). 94 Rust + 113 JS tests green; builds clean. Code-reviewed (subagent);
both Important findings fixed (in-batch dedupe, history pagination).

- **Main-thread beachball fix (2026-07-10): I/O-bound commands are `#[tauri::command(async)]`.** Root cause of
  the "spinning wheel blocks the app on refocus" bug: **plain sync `#[tauri::command]` fns run INLINE ON THE
  MACOS MAIN THREAD** (verified through tauri 2.11.2 + wry 0.55.1 source: JS `invoke` → `ipc://` custom
  protocol → WKURLSchemeHandler on the main thread → command body). `SlackTile` fires `slack_refresh` on every
  window focus; it did 2+ blocking HTTP calls per watched conversation (+ Keychain read + `users.info` misses)
  with **no ureq timeout** and an up-to-30s 429 `thread::sleep` — after wake-from-sleep a stalled socket froze
  the whole app. The earlier belief "Tauri runs each invoke on its own thread" is true only for `(async)`/
  `async fn` commands (those go to the tokio pool). Fix: every command touching network/Keychain/subprocess/git
  is now `#[tauri::command(async)]` (slack ×8, `pr_reviews_fetch`, `deduce_worktree`, worktree ×7); memory-only
  ones (`slack_snapshot`, `list_connections`, `pty_*`, settings) stay sync — `pty_write` deliberately so for
  keystroke latency. Plus a shared `http_agent()` (ureq, **15s hard timeout**) in `slack.rs` replaces the
  timeout-less `ureq::get/post` so no refresh can hang indefinitely even off the main thread. No frontend
  changes (`invoke` was already promise-based). Threading isn't unit-testable headlessly — GUI smoke:
  beachball gone on refocus + app stays interactive during a deduce.

- **Terminal UX batch (2026-07-13, branch `worktree-terminal-ux`).** `useTerminal.ts` now loads three
  xterm v6 addons — **Unicode 11** width tables (`term.unicode.activeVersion="11"`, fixes emoji/box-drawing
  misalignment in Claude's UI), **WebGL** renderer (best-effort; `onContextLoss` → dispose falls back to the
  DOM renderer), and **web-links** (Cmd+click → `openUrl`) — plus `scrollback: 10000` and a
  `attachCustomKeyEventHandler` that turns **Shift+Enter** into Claude's backslash-newline escape
  (`[0x5c,0x0d]`) instead of submitting (pure `shouldInsertNewline`/`NEWLINE_ESCAPE` in
  `src/worktrees/keys.ts`, tested). `pty.rs` sets `TERM=xterm-256color`, `COLORTERM=truecolor`, and
  `CLAUDE_CODE_NO_FLICKER=1` on the child shell (pure `terminal_env()`, tested) — truecolor + Claude's
  **fullscreen alternate-screen TUI**; Claude keeps its own default theme ("look like Claude", not
  `dark-ansi`). Each change is one line and independently revertible — see the **Revert Map** in
  `docs/superpowers/plans/2026-07-13-terminal-ux-improvements.md`. 149 JS + 109 Rust tests green; Rust +
  Vite builds clean.
  fullscreen TUI, truecolor, Shift+Enter, Cmd+click links, WebGL smoothness).

- **Drop files from Finder into a terminal pane (2026-07-28).** A webview strips real filesystem paths
  from DOM drop events, so Tauri's native drag-drop is the only source of them — `dragDropEnabled` is now
  `true` (`src-tauri/tauri.conf.json`), safe now that the To Do tile's reorder no longer depends on HTML5
  DnD (see the corrected note above). One window-level listener (`App.tsx`, `getCurrentWebview().onDragDropEvent`)
  hit-tests the cursor against panes carrying `data-pty-id` (`WorktreePane.tsx`) via
  `document.elementFromPoint(...).closest("[data-pty-id]")`, and `pty_write`s the resolved pane the
  backslash-escaped dropped paths with a trailing space and no newline — matching what Finder → Terminal.app
  produces (the form Claude Code is tested against), landing at the cursor without submitting anything.
  All routing logic is pure and unit-tested in `src/worktrees/drop.ts` (`escapeDroppedPath`,
  `formatDroppedPaths`, `logicalPoint` for the physical→CSS pixel conversion needed because drag-drop
  positions arrive in physical pixels, `dropCommand` with an injected DOM hit-test so jsdom's lack of a
  layout engine doesn't block testing the four ways routing can fail). No Rust changes — `pty_write` was
  already exposed. 182 JS tests green (16 new). Deferred: a drop-target highlight, dropping onto
  non-terminal targets, clipboard image paste. Spec: `docs/superpowers/sdd/2026-07-28-terminal-file-drop/`.

- **Session restore + clean shutdown (2026-07-29).** Quitting now stops what the app started and
  reopening restores the previous arrangement. **Shutdown:** `PtyManager::kill_all()` (`pty.rs`) drains the
  registry, kills each child AND drops each master — `child.kill()` (portable-pty's unix `ChildKiller` for
  `std::process::Child`) is what actually does the work: it sends `SIGHUP` to the shell's pid, and the
  shell (a session leader) forwards that HUP to its job-control children, killing grandchildren (`claude`,
  `npm run dev`) too; dropping the master is incidental (the fd is dup'd three times, so one drop doesn't
  hang up the line), and killing the login shell with `SIGKILL` instead would orphan them, since a killed
  shell never gets to relay anything. Hooked on `RunEvent::Exit` in `lib.rs` (covers Cmd+Q and last-window close),
  which required switching `.run(generate_context!())` → `.build(…)` + `.run(|handle, event| …)`.
  **Restore:** a new **`Option<Workspace>`** block in `cockpit.json` — `slots` (entity ids in column
  order, `null` = shown-but-empty), `scratch` (+ `scratchSeq`), and `panes` (the per-worktree
  `WorktreePaneSet`, collapse state included — this brings back the `paneOpen`-style persistence the
  lazy-panes iteration deleted, now covering pane *existence* too). It's an `Option` field, **not**
  a defaulted bare `Workspace` struct, deliberately: **absent** = pre-feature file → fall back to the old
  `initSlots` (first 3 ongoing), **`Some` with empty slots** = the user really closed every column.
  **No duplicated state:** session state stays the source of truth and the block is composed at *write*
  time — `scheduleSave` calls `withWorkspace(cockpit, state)` (pure, in the new `src/settings/workspace.ts`
  with `workspaceSnapshot`/`restoreWorkspace`), so the in-memory `cockpit` never holds a drifting copy.
  Session-mutating actions call a new `setSession()` wrapper (`set` + `scheduleSave`) to trigger the same
  debounced write; a missed call site therefore only delays persistence rather than writing stale data.
  Restore rules: fresh slot keys (keys are React identity, meaningless on disk); an unresolvable id becomes
  an **empty column** (count preserved, picker already rendered); `scratchSeq` lifts to
  `max(persisted, highest scratch-<n>)`; pane sets for vanished worktrees are pruned. **Processes:**
  a restored `host: true` re-runs `startCmd` via the existing autostart, and the claude pane runs
  **`claude --continue || claude`** (the `||` covers `--continue` exiting non-zero when there's no
  conversation to resume; the rejected alternative was probing `~/.claude/projects/<mangled-cwd>/`).
  That's driven by the session-only `restoredWorktrees` flag, seeded from **slots ∪ pane keys ∪
  `cockpitWorktreeId`** (NOT the pane map alone — a Claude-only worktree has no pane entry) and cleared on
  the pane's first `onEnsured`, so restart still runs plain `claude`. The active view now persists into
  `preferences.defaultView` on every switch. Known accepted cost: a change made in the last 500 ms before
  quitting is lost to the debounce (a `CloseRequested` flush handshake was rejected — it can hang quit).
  Spec: `docs/superpowers/specs/2026-07-29-session-restore-and-clean-shutdown-design.md`.

- **Worktree info popup (2026-07-29).** The permanent `.wt-col__path` details row is gone, replaced by a
  circled ⓘ at the head of `.wt-col__chips` (`WorktreeInfo.tsx`) whose hover popup shows repo (folder glyph),
  branch (`.wt-ico--branch`), and worktree dir (new `.wt-ico--tree`) on three rows, in the same mono `--fs-xs`
  `--tx-3` type the deleted row used. The reveal is **CSS-only** (`.wt-info:hover`/`:focus-within` in
  `WorktreeColumn.css`) — deliberately not React state, unlike the click-toggled gear menu in the same file
  which needs state plus a document listener. `.icon-btn` is deliberately NOT reused for the trigger: its
  `padding: 6px 12px` would shove the whole chips row right, so `.wt-info__btn` resets the global `button`
  baseline itself. **Gotcha worth recording:** a hover popover offset with `margin-top` needs a `::before`
  bridge across the gap, because the gap belongs to the wrapper's ancestors and plain `:hover` drops there —
  the 4px offset was inherited from the click-toggled `.wt-col__menu-pop`/`Dropdown` popovers, where it is
  harmless since those toggle on click, not hover. Full variant only (scratch/pending never had the
  row); new `InfoIcon`/`FolderIcon` in `views/icons.tsx`; no Rust changes; no new tests (the suite is
  pure-logic only). Spec:
  `docs/superpowers/specs/2026-07-29-worktree-info-button-design.md`.

- **Chip logos + short PR labels (2026-07-29, same branch).** Every chip's leading marker is now a
  **per-source logo** instead of the old dot/square: pure tested **`linkGlyph(url)`** (`chips.ts`) returns
  `linear` | `pr` | `figma` | `link`, and those names ARE the CSS modifiers, so one vocabulary drives both the
  derived chips (which already carried `.wt-chip--linear`/`--pr`) and the user links (`LinksList` applies
  `wt-chip--${linkGlyph(l.url)}`; the hardcoded `.wt-chip--link` modifier is gone). `.wt-chip::before` is a
  13px alpha-masked glyph — **chainlink is the default** (new hand-drawn `src/assets/icons/link.svg`; Vite
  inlines it as a data URI), overridden per source to `linear.png` (previously an unused asset), `branch.png`
  for PRs, `figma.png` (user-supplied), and `chrome.png` for localhost — which **keeps** its Chrome glyph, since
  a browser logo for a browser address is exactly the per-type rule. Derived `issue` chips fall back to the
  chainlink. GitHub PR links no longer inherit the long PR title: `sourceLinkFrom` labels them exactly
  **`Github: PR`** via the shared **`isGithubPrUrl`** (`model.ts`, also backing `linkGlyph`'s `pr` case —
  `views → worktrees` is the established import direction). Linear/Slack sources and GitHub *issues* keep their
  fetched title; the `+ PR` button's `prLinkToAdd` keeps `PR #<n>` (already short, and the number is useful).

- **Deduce flow module (2026-08-03) — pure refactor, no behaviour change.** The deduce→create chain moved out
  of the store into **`src/worktrees/deduceFlow.ts`**: `startDeduceFlow({ prompt, view, source }, { session,
  deduce, create })`. It keeps EVERY decision (both liveness guards, host precedence, the context prepend,
  `branchSpecFrom`, the two-surface swap, the rollback); `store.ts`'s `startDeduceWorktree` is now a one-line
  delegation. It returns a promise (`void startDeduceFlow(...)` at the call site), so tests `await` it instead of
  the old `setTimeout(0)` flush. Only the deduce path — **`ExistingBranchForm` (checkout) is untouched**; its
  shape differs (synchronous, inline busy/error, no pending tile) and the apparent shared tail is 3 lines with a
  *different* host rule (deduce falls back per field over the agent's guess, checkout takes the whole saved object
  or blank). **The port is 14 granular single-step ops on purpose — do NOT coarsen it:** a semantic
  `commit(pendingId, worktree)` reads better but absorbs the swap/repin/rollback into the port's implementation,
  i.e. back out of the test surface (moving complexity instead of concentrating it). **The port impl is a private
  `deduceSession` closure inside `store.ts`'s `create()`, NOT new store actions** — 7 of the 14 ops were inline
  `set` calls, and exposing them would push `SettingsState` from 72 members to ~79, worsening the store's width to
  fix the saga's depth; the public store interface grows by zero. Reads (`knownRepos`, `contexts`, `cockpitPin`,
  `isLive`) are **getters, not a start-time snapshot** — they're read 15-43s later, after `deduce` resolves, so a
  repo host default saved mid-deduce must still land (the same bug `resolveHost` fixed on 2026-07-31); two tests
  pin it. IPC is **injected** (diverging from `teardown.ts`, which imports its IPC and mocks the module — fine
  there, since it branches on neither call). Tests were **replaced, not layered**: 16 sequence tests in
  `deduceFlow.test.ts` against a plain fake session (no store, no `vi.mock`), the 6 old saga tests + the mid-flight
  one deleted from `store.test.ts`, and **one** new wiring test there driving the real store so the private port
  impl is proven — the last remaining `vi.mock("../worktrees/api")`. 264 JS tests (was 254); tsc + Vite clean; no
  Rust changes. Deferred (with the review's four sibling candidates) in
  `docs/superpowers/plans/2026-08-03-deduce-flow-module.md`.

- **Settings store slices + the timer's own store (2026-08-03) — pure refactor, no behaviour change.**
  `store.ts` (was 474 lines / 64 members over 8 concerns) is now a **54-line assembly point**: it composes slice
  creators and owns `init`, the one action that hydrates every slice at once. New layout: `settings/storeState.ts`
  (the combined `SettingsState` type), `settings/slices/persist.ts` (**THE single writer to disk** — debounce +
  `withWorkspace` composition live only here), and `slices/{config,zoom,todos,integrations,workspace}.ts`. The
  deduce port (`deduceSession`) moved into `slices/workspace.ts`. **The countdown left the settings store
  entirely** → `tiles/timer/timerStore.ts` (`useTimer`, fields renamed `minutes`/`remaining`/`running`/`start`/
  `pause`/`reset`/`setMinutes`/`tick`): it was writing once a second, and every bare `useSettings()` re-rendered on
  each tick — including `SlotColumn`, which holds the terminals. **All 10 bare `useSettings()` subscriptions are now
  selectors**; none remain (`TodoTile` and `SlotColumn` were the ones that mattered). **It is still ONE store on
  purpose — do NOT split it into several:** the persisted `workspace` block is composed from session state at save
  time, and `removeWorktree`/`placeNewEntity`/`setFontScale`/`init` genuinely span concerns, so separate stores would
  only turn that coupling into cross-store reads. Slices are typed over the whole `SettingsState` so those actions
  keep working via `get()`. Honest scope: this buys **implementation locality**, not a narrower interface — with
  zustand's slices pattern `useSettings` still exposes everything. Consumers are unchanged (they only ever imported
  `useSettings`). Test file split to match (`slices/*.test.ts` over a shared `slices/fixtures.ts`), which exposed
  gaps now covered: `updateWorktree`, the `removeWorktree` flag/pane sweep, Slack writers' sibling preservation, the
  todo item lifecycle, `swapSlots`, the attention map, pane sets, an unresolvable restored slot id, cross-slice save
  coalescing. 288 JS tests (was 264); tsc + Vite clean; no Rust changes. Deferred (incl. a selector-discipline lint
  rule — there's no ESLint config in the repo yet): `docs/superpowers/plans/2026-08-03-settings-store-slices.md`.

- **`git.rs` runner module (2026-08-03) — refactor + ONE behaviour change.** All 17 hand-rolled
  `Command::new("git")` blocks (worktree.rs ×15, deduce.rs ×1, github.rs ×1) now go through
  **`src-tauri/src/git.rs`**, the sibling of `github.rs::run_gh` / `deduce.rs::run_claude` / `slack.rs::api_get`
  that git was missing. Interface is **two functions**: `run<I,S>(dir, args) -> Result<String,String>` and
  `default_branch(repo_path) -> Option<String>` (+ `strip_origin_prefix`, moved here from deduce.rs).
  **`run`'s contract matters:** stdout is returned **UNTRIMMED** (so `worktree_file_diff`'s raw patch survives
  byte-for-byte — a trimming runner would silently alter it); `Err` carries git's **trimmed stderr**, shown to the
  user verbatim; a non-zero exit is an `Err`, and the **seven sites that treat failure as data** (the dirty-default
  in `worktree_status`, `remove_worktree`'s prune fallback, the main/master probes, `branch_exists`,
  `origin_owner_repo`, the non-fatal `worktree list`) use `.ok()` and branch on the Option; args are generic like
  `Command::args`, so `["a","b"]` and a `Vec<String>` arg-builder both pass unconverted. **One function, not
  three** — `run(...).ok()` covers every probe, so the sketched `try_run`/`probe` were pure surface; don't re-add
  them. `current_dir` won over `-C` (21 vs 4 uses; byte-identical output), so **`repo_root_args` lost its embedded
  `-C <path>`** — the dir is `run`'s first arg. **⚠️ Behaviour change: `deduce.rs` GAINED the origin/main→master
  fallback.** The two `repo_default_branch` copies were NOT equivalent (only worktree.rs had the fallback), so
  deduce can now resolve a base in a locally-init-ed repo with no `origin/HEAD` instead of keeping the agent's
  guess — same gap the Diff-tab fix closed (e94f72c). Worth a smoke. **One raw subprocess stays** in worktree.rs:
  the `gh pr checkout` in `create_worktree` — it's `gh`, not git, and github.rs's runner would impose
  `GH_TIMEOUT` (30s) on a PR fetch that can legitimately take longer, silently diverting to the
  `refs/pull/<N>/head` fallback. 137 Rust tests (was 132: +10 in git.rs, −5 moved with their functions);
  `worktree.rs` 819→667 lines; 239 deletions vs 54 insertions. **No frontend changes, no IPC signatures moved.**
  Deferred (a timeout on git calls — now a one-line change in one place; routing `gh pr checkout`):
  `docs/superpowers/plans/2026-08-03-git-runner-module.md`.

- **Pane-session module (2026-08-03) — refactor + ONE behaviour change.** PTY was the only IPC family
  without a typed module; **eleven** raw `invoke("pty_*")` calls across `useTerminal.ts`,
  `WorktreeBody.tsx`, `SlotColumn.tsx`, `teardown.ts` and `App.tsx` carried the invariants with them.
  Now **two layers**: **`src/worktrees/ptyPane.ts`** — `ptyPane(worktreeId, role)` returns one pane's
  handle (`id · ensure · attach · onOutput · write · resize · kill · respawn`), **store-free** so it
  stays substitutable; and **`src/worktrees/paneLifecycle.ts`** — `liveRoles` / `killPanes` /
  `closePane`, the sequences where IPC meets the store, with deps injected over a real default
  (`teardown.ts`'s idiom) so the orderings are unit-tested against a plain fake. `killWorktreePtys` is
  gone; `teardown.ts` calls `killPanes`. **`write` takes TEXT, not bytes** — `NEWLINE_ESCAPE` is now the
  string `"\\\r"`, so the module owns UTF-8 conversion outright and the encoder is **hoisted to module
  scope**: the keystroke path (`pty_write`, the one Rust command deliberately left sync for latency)
  allocates *less* than before, and `keys.test.ts` pins the `[92, 13]` bytes it must still produce.
  **`writePty(ptyId, text)` is the only id-keyed export**, for the file drop — its DOM hit-test yields
  an opaque `data-pty-id` with no pair to key on. **`respawn` names the kill-before-ensure ordering**
  (`pty_ensure` reattaches a still-alive entry, so a lagging kill would remove the pane it just
  restored). **`liveRoles` reads the store internally** — NOT a store member (`SettingsState` stays as
  wide as it was) and NOT a `paneSet` helper (callers would still hand it the map, so `EMPTY_PANE_SET`
  would still leak into the views). **Don't undo these:** `roles` stays a *required* arg to `killPanes`
  — defaulting it to `liveRoles` would delete three arguments and silently kill the wrong pty for a
  **scratch** (no `worktreePanes` entry → the default computes `["claude"]`); and the lifecycle layer
  needs **two** functions, not one, because `killPanes` must *propagate* a kill failure (teardown can't
  reach `git worktree remove` with a process holding the dir) while `closePane` must *swallow* it (a
  pane on screen with no process blinks a cursor and eats keystrokes) — opposite error policies for the
  same kill. `makePtyId`/`isAttentionRole` stay in `ptyId.ts` (the id is also a store key + a DOM
  attribute, not just IPC); the mount effect's `[worktreeId, role, cwd]` deps and the refs are
  unchanged — the pane handle joined them as `paneRef`, where `ptyIdRef` used to sit. **⚠️ Behaviour
  change: clearing the attention mark now belongs to the kill**, so **Pause, scratch Delete and
  teardown clear it too** — before, only restart/close did, so pausing a belled worktree left a live
  mark that glowed again on re-select. **`teardown.ts` was realigned to injected deps in the same
  branch** (the realignment the deduceFlow plan deferred): its tail is now a **deps object**
  `{ killPtys, removeModel }`, so the signature got *shorter* rather than gaining a fifth positional
  arg, and it is store-free again. **`killPtys` is a THUNK, not `(id, roles)`** — which panes are live
  is a pane concern, so binding it at the call site (`() => killPanes(id, liveRoles(id))`) deleted the
  `roles` param the lazy-panes iteration threaded through; roles are read on teardown's first statement,
  before any await, so it's equivalent to reading them at the call. The git IPC stays imported +
  module-mocked (the test branches on it fine via `mockRejectedValueOnce`; the store was the problem,
  not the mock), and its two per-role ordering tests collapsed into one — asserting *which* roles die
  belongs to `paneLifecycle.test.ts`. **No Rust changes** (137 tests unchanged); 306 JS tests (was
  288). Deferred (the preserved unhandled-rejection on writes; `data-pty-id` still composed by
  `makePtyId`): `docs/superpowers/plans/2026-08-03-pane-session-module.md`.

- **London map background (2026-08-06).** A second variant in the background seam (`src/background/`,
  where `registry.tsx` catalogues variants and `BackgroundLayer` renders the chosen one into a fixed
  `z-index:-1` layer): a lines-only **geographic** map of London — OSM roads, all Underground lines, and
  the rivers — white strokes with a slight glow over the ground, plus a very slow drift. **All geometry
  is baked offline and committed**, so at runtime there is no network call, no API key and no Rust: the
  variant is a static import, which is why it has no error state at all — a background has nowhere to
  show one.
  - **Two scripts, split I/O from pure logic.** `scripts/mapGeometry.mjs` is pure and unit-tested
    (`mergeChains`/`simplify`/`projectionFor`/`project`/`toPathD`/`bakeLayer`/`toAreaD`/`bakeArea`/
    `splineD`); `scripts/bake-london-map.mjs` fetches and writes `src/background/londonMap.data.ts`.
    Run it **by hand** (`node scripts/bake-london-map.mjs`, ~12 min of deliberately-paced calls) — it is
    not a build step. Because OSM moves upstream, a re-bake's diff can't be reviewed against the previous
    one, so re-run it only when the geometry must change.
  - **ONE `<path>` per layer is load-bearing.** A single `d` string holds many *disconnected* subpaths,
    so a whole road class is one element — without it the primary tier alone would be ~13,600 nodes.
    It also makes the tube layer's overlapping trunk sections safe: the bake dedupes whole station
    *sequences*, so branches redraw their shared trunk (~10 deep on the Northern line's core), and only
    a single element's opacity compositing once hides that. **Split tube per line and every trunk jumps
    to ~10× brightness** — the warning is beside that path in `londonMap.tsx`.
  - **Four bake gotchas, each of which cost real time.** (1) Overpass needs **exact tag matches, never a
    regex** — `way["highway"~"^(a|b)$"]` bypasses the tag index and 504s reliably. (2) A bbox query
    returns each matching way's **full unclipped geometry**, so strip-splitting double-counts every
    boundary-crossing way and `mergeChains` then folds it onto itself into a degenerate there-and-back
    chain; dedupe by OSM way id first. (3) **Merge before projecting** — junction nodes are bit-identical
    in lat/lon and stop matching once rounded, and merging first is worth 10× rather than 2×. (4) OSM's
    **riverbank polygons are UNNAMED** — the name lives on the `waterway=river` centreline, so searching
    `name="River Thames"` finds thirty streets and no river; filter on `water=river` (which is why the
    layer is `water`, not `thames`, and picks up the Lea and the docks too).
  - **The projection's cos(latitude) correction DIVIDES** (`scaleY = scaleX / cos(lat₀)`): pixels per
    degree of *latitude* is the larger number. Multiplying squashes London vertically, it is easy to get
    backwards, and a test pins the resulting ~1.6:1 aspect. Station coordinates are baked **in pixel
    space** keyed by NaptanId, so a future live-trains step interpolates between them with no runtime
    projection at all.
  - **Glow is a duplicated, genuinely WIDER stroke group, blurred, painted underneath** — not
    `box-shadow`/`drop-shadow` (which leave the core opaque and soften only outwards). Re-blurring a
    stroke at its own width just dims it: blur conserves alpha, so ~6× spread costs ~6× peak. The blur is
    an **SVG `<filter>` with a pinned `userSpaceOnUse` region**, deliberately not `filter: blur()`,
    because a CSS filter derives its region from the *object bounding box* and the glow group's bbox is
    ~7× the frame (the full tube network is baked and only clipped at render) — enough for WebKit to
    clamp or drop it. `clip-path` does NOT help: clipping happens after filtering. It also carries
    `color-interpolation-filters="sRGB"`, since SVG filters default to linearRGB and would otherwise
    brighten every halo.
  - **`layers.motorway` is legitimately empty** — zero motorway-tagged ways inside the bbox (the M4 and
    M1 both start outside), so there are two road tiers on screen, not three. It stays wired for a wider
    box; don't tune `.lm__line--motorway` expecting to see anything.
  - Stroke widths are device pixels (`vector-effect: non-scaling-stroke`) but the blur radius is in user
    units, so their ratio is only exact at the window size it was tuned at. Attribution is a licence
    condition of both sources: it sits in `README.md`, in the generated file's header, and in Settings
    via an optional `attribution` field on `BackgroundVariant`.
  Spec: `docs/superpowers/specs/2026-08-05-london-map-background-design.md`; plan:
  `docs/superpowers/plans/2026-08-05-london-map-background.md`.

- **London map · live trains (2026-08-17).** A third variant: the same map with real Underground trains
  on it, as line-coloured dots gliding between stations from TfL's arrival predictions. Five new files
  (`londonTrainsModel.ts` pure + `londonTrains.tsx` layer + `londonTrains.css` + the generated
  `londonTrainSegments.data.css` + `scripts/bake-train-segments.mjs`, with its pure half in
  `scripts/trainSegments.mjs`); two touched (`registry.tsx` gains one entry, `londonMap.tsx` gains an
  optional `children` rendered inside the tube `<g>`). **`londonMap.data.ts` is untouched and the map's
  bake is NOT re-run** — deleting the trains is deleting those files plus one registry entry.
  - **Trains follow the SPLINED line via pre-baked per-segment `@keyframes`**, not `offset-path` (not
    compositor-accelerated in WebKit — ~280 elements would land on the main thread) and not linear
    interpolation (measured up to 32px off the drawn curve). `bake-train-segments.mjs` reads the
    **committed** map data — no network, no key — and emits one rule per station PAIR named
    `lt-<loNaptan>-<hiNaptan>`, running lo → hi; the other direction is `animation-direction: reverse`.
    Placement is `animation-name` + a **negative `animation-delay`** (nightSky's star-ageing idiom).
    Stops are spaced evenly by **arc length**, not by the Bézier parameter t, or the train would speed up
    and slow down within one segment. 314 rules, 1,597 stops, **78.6 KB** at a 0.8px chord tolerance
    (0.4px costs 102 KB and is invisible: 0.8 user units ≈ 0.6 device px).
  - **⚠️ The bake and the runtime build the animation name independently** — a .mjs script and a TS
    module with no shared import. The only thing connecting them is the contract test at the foot of
    `scripts/trainSegments.test.mjs`, which reads the real generated stylesheet and asserts the two sets
    are equal both ways. It lives THERE, not in the TS test, for two reasons: the app has **no
    `@types/node`** so `node:fs` doesn't type-check under `include: ["src"]`, and a **`?raw` import of a
    `.css` yields an empty string** under Vite (the CSS plugin intercepts it), which would pass the
    assertion vacuously. The .mjs → .ts import direction is the only one that works.
  - **`londonTrainsModel.ts`, not `londonTrains.ts`** — same trap as `dropdownModel.ts` beside
    `Dropdown.tsx`: on a case-insensitive FS an extensionless `./londonTrains` resolves the `.ts` before
    the `.tsx`, so the component would never be found. Caught by `tsc`, not by the tests.
  - **The API gives the line but not the branch**, and `destinationNaptanId` doesn't close the gap
    (Northern *Edgware via Bank* and *via CX* share a destination). Resolved **structurally**:
    `resolvePrevious` finds the branch sequence where next and station-**after**-next are adjacent, and
    the previous station is next's neighbour on the opposite side. `towards` is deliberately not parsed
    (free text: "via CX", "Check Front of Train", "Special"). Fallback ladder: ambiguous branch → glide
    from the last sighting; no sighting → `reflectBehind` (step back from next, away from after-next, by
    the fraction of the run still to go); unknown NaptanId → drop.
  - **A vehicle arrives with its whole onward journey (~15 predictions)**, which is what makes slow
    polling viable: the tick re-derives every placement from the STORED feed with elapsed time
    subtracted, so a train advances station to station between fetches. Polling is **one line per ~11s**
    (the full 11-line payload is 3.9 MB and a big main-thread parse) and runs **only while
    `document.visibilityState === "visible"`** — a hidden window freezes CSS animations but not timers.
  - **Reduced motion PAUSES the animations** (`animation-play-state: paused`) rather than repositioning:
    a paused animation with a negative delay renders the exact point on the CURVE a train has reached,
    which a static transform could only match by evaluating the spline at runtime. Polling stops after
    one pass round the rota. (`placementPosition` deliberately measures a segment along its **chord** —
    it only seeds an already-approximate fallback glide.)
  - **The glow is a radial-gradient FILL, one `<circle>` per train**, not an SVG filter (280 filter
    regions) and not `box-shadow` (opaque core, hard rim). Per-line colour comes from CSS —
    `#lt-g-<line> stop { stop-color }` plus `.lt__train--<line> { fill: url(...) }` — because `.lm` sets
    `fill: none` on the whole `<svg>` and **a CSS rule beats a `fill=` attribute**. Two of TfL's eleven
    hexes are deliberately lifted: Northern's `#000000` and Piccadilly's `#003688` are invisible on the
    dark ground, and an invisible line reads as a missing one.
  - **The tube network is drawn ONLY by the live variant** (`<LondonMap underground>`; 2026-08-18). Plain
    "London map" is roads + river, so the two entries are meaningfully different and the Underground sits
    with the trains that ride it. `underground` is a separate prop from `children` rather than derived from
    it, and the tube `<g>` renders either way, so children can never be silently swallowed. The picker
    label is **"London Underground"** while the persisted id stays `london-map-live` — renaming an id would
    reset everyone's stored background. Trains also dim the map's white tube halo to 0.22 via
    `.lm:has(.lt__train)` in **londonTrains.css**: the `:has()` guard is load-bearing, because Vite bundles
    all CSS into one sheet, so an unguarded rule there would apply app-wide rather than only where trains
    are. Line colours were being drowned by that white halo — the trains' inner halo was raised to 0.55 in
    the same pass.
  - **⚠️ FOUR BUGS FOUND BY GUI SMOKE, all in the derivation, all fixed 2026-08-18** — trains floated far
    off the lines and the whole map twitched every 11s. Each was diagnosed by simulating the real tick
    loop against the live feed and MEASURING, not by reading the code; the numbers are in the plan.
    1. **`vehicleId` IS NOT UNIQUE ACROSS LINES** — it is the train-set number ("065", "205"), and live,
       105 of them were in use by two or more lines at once (one by four). Keying the feed on it alone
       **destroyed 161 of 375 trains in service (43%)**, and survivors inherited a stranger's route and
       teleported across London on refresh. Everything is now keyed by **`vehicleKey(lineId, vehicleId)`**
       — the feed, the sightings, and the React key. This also explains the "232 vehicles" a first live
       probe reported against the spec's measured 436: it was this bug, not evening service.
    2. **The spec's glide/reflect fallbacks left the network** and are DELETED. A glide ran a straight
       line to `next`, which can be most of London away (measured 34-208px off-track, up to 1,859px
       between ticks); `reflectBehind` extrapolated a whole segment vector past `next`. The invariant is
       now **a train is only ever drawn on a real segment or still at a real station** — where the branch
       is ambiguous, `choosePrevious` picks the candidate nearest its last position, since both are real
       track. Off-network dots went to zero.
    3. **The segment duration used the wrong segment.** The gap between the two soonest predictions is the
       duration of the segment AFTER this one (p10 27s), so **43% of trains had eta > it** and clamped to
       progress 0: parked at a station, then racing. Duration now comes from the segment's own LENGTH
       (`NOMINAL_PX_PER_SECOND`), which is both better calibrated and — crucially — **stable between
       ticks**.
    4. **Every re-derive rewrote every animation.** ~170 `animation-delay`/`-duration` values changed each
       tick, re-setting all animations in unison — the visible "everything jumps at once". `keepRunning`
       now returns the PREVIOUS placement object when the re-derive agrees within `PROGRESS_TOLERANCE`, so
       the emitted style is byte-identical, React writes nothing, and the animation is never interrupted.
       Its sighting MUST keep its original `atMs` or the implied position drifts a tick per tick.
    Also: a vehicle whose aged predictions have all expired is now **dropped, not parked at its last known
    station** — parking invented a position that the next refetch corrected with a visible teleport.
    **Instrument warning:** the first "after" measurement showed fake 1,000px jumps because the harness
    rendered a kept placement from the previous tick instead of from its own start time. An isolation
    experiment (aged vs fresh prediction for the same train at the same instant: median 23px, p90 52px)
    is what exposed the bad instrument.
  - **Returning to a hidden window needs BOTH halves (code review, 2026-08-18).** Hiding freezes the CSS
    animations but not the clock the derivation runs on, and `keepRunning` cannot see that: its implied
    position and the fresh one come from that same clock, so they still agree and it keeps a placement
    whose animation is behind by however long you were away. `resyncSightings` (called at the top of the
    effect, i.e. on becoming visible) demotes every sighting to a **`still` at wherever it had got to** —
    the literal truth after a freeze — which forces a re-emit, since `keepRunning` only ever keeps a
    *segment*, while `choosePrevious` keeps the position it needs to pick a branch. The other half is the
    map being nearly EMPTY on return: past `STALE_SECONDS` every prediction is dropped, and the one-line
    rota then takes ~2min to refill. Fixed by a **catch-up cadence** (`CATCH_UP_MS` 1.5s while any line is
    missing or stale, `TICK_MS` 11s once all 11 are fresh), which also fills the map ~8× faster on a cold
    start. Deliberately NOT fixed by raising `STALE_SECONDS`: past ~5 minutes the aged predictions are
    fiction, so the answer is to fetch real data fast, not to draw old data longer. Three guards are
    load-bearing — the hurry is gated on the fetch having SUCCEEDED (a down API would otherwise be polled
    every 1.5s for as long as the app is open); it is **capped at one pass per return-to-visible** (a
    SINGLE persistently-erroring line would otherwise keep `missingLine` true for ever while the other ten
    succeeded, sustaining ~25 req/min to no purpose); and `lineFetchedAt` is its own ref rather than
    derived from the feed (a line running no trains has no vehicle to carry a `fetchedAt`, so it would
    read as never fetched and hold the fast cadence open for ever). With the cap the request rate is
    provably bounded: ~5.5/min idle, ≤16 in any minute containing a full catch-up, against TfL's free
    unmetered API (spec §3: no key, no account, no cost). Same pass: the tick self-schedules with
    `setTimeout` instead of `setInterval` (a fetch slower than the tick can no longer overlap the one
    behind it) and carries an `AbortController`; and the map's white tube halo is dimmed under
    `.lm:has(.lt)` — the LAYER — not `.lt__train`, which tied the map's brightness to the data (a visible
    pop when the first response landed, and no dimming at all offline). Trains also **fade in over 600ms on
    mount**, which the catch-up rota made worth having (a line at a time arriving, ~270 at once on a cold
    start). It is a `transition` out of **`@starting-style`**, deliberately NOT a second entry in the
    inline `animation-*` lists: a transition fires on a value changing and opacity never changes again,
    whereas an appended `animation-name` would replay on every re-emit — a blink whenever a train changed
    segment, and the whole map twinkling after a resync.
  Spec: `docs/superpowers/specs/2026-08-17-london-map-live-trains-design.md`; plan:
  `docs/superpowers/plans/2026-08-17-london-map-live-trains.md`.

- **London map · train ids, smooth re-places, rota marker (2026-08-18).** Four changes to the live
  variant, no new files and no re-bake. **(1) Vehicle id beside each dot.** A train is now a `<g>`
  (`.lt__vehicle`) holding the circle plus a `<text>`, and the segment animation moved from the circle to
  the GROUP — the alternative, two siblings each playing the same `@keyframes`, is two animations to keep
  in step for ever. All the animation rules (`timing-function`, `iteration-count`, `fill-mode`, the
  opacity transition, `@starting-style`, the reduced-motion pause) moved with it. `stroke: none` on the
  label is load-bearing: `.lm` strokes everything white and would outline every glyph. The 11 line hexes
  became custom properties on `.lt`, each stated ONCE and consumed by the gradient stop and the label
  fill, so "the label is the same colour as the dot" is a fact about the stylesheet rather than a pair of
  literals that can drift. **(2) Bounded correction on a re-place.** A re-placed train slides onto its new
  position instead of jumping. `transition: transform` is INERT here — a running animation outranks a
  transition on the same property, and swapping `animation-name` changes the animation's output, not
  `transform`'s declared value — so the offset rides the separate **`translate` property**, which
  COMPOSES with `transform`. The dot therefore follows the new segment's real spline throughout, merely
  displaced by a vanishing offset; it is never tweened along a straight line, which is what would take it
  off its line. WAAPI (`el.animate`) not a CSS transition, because a transition needs two RENDERED values
  — a second React render per corrected train per tick; `useLayoutEffect` so the offset lands before the
  new `transform` paints. `correctionFor` is pure and gated: **`CORRECTION_LIMIT = 50` user units**, from
  measuring a full 121s refresh of all 11 lines (same-segment corrections p50 17 / p90 43 / max 62;
  still<->segment p50 106 / max 367 — sliding THOSE is §5's deleted glide in a shorter coat). Live
  validation with the real model: 52% of re-places slide, max 46.7 of the 50 cap. It also declines on a
  **`resynced`** sighting (new optional field on `Sighting`, set by `resyncSightings`): after a freeze the
  position was INFERRED from a stopped animation, and a slide from a wrong start is a jump followed by a
  slide — worse than a snap. `PROGRESS_TOLERANCE` deliberately left at 0.08; lowering it toward 0.02 is
  the deferred payoff, now that corrections absorb the extra re-places. **(3) Rota marker.** A 5px dot
  showing which line refreshes next, at a fixed geographic point — new pure **`project(lat, lon)`** in the
  model, using the baked `LONDON_MAP.projection`, verified to reproduce King's Cross and Oxford Circus to
  0.05px. First built as an HTML dot in the window corner, which forced a lifted-state wrapper component;
  placing it geographically let ALL of that be deleted (it is a `<circle>` inside the trains' own `<g>`,
  so `registry.tsx` is untouched and it inherits the map's drift, as a ground-pinned marker should).
  Colour is inline `var(--lt-<line>)` rather than a twelfth per-line rule. **⚠️ Note a corner marker CANNOT
  live in the SVG**: the viewBox is fitted with `slice`, so on any window wider than its own 1.605:1 the
  frame's bottom corners are cropped off screen. **(4) ⚠️ THE FADE BUG — `mergeLineFeed` ORDER IS
  LOAD-BEARING.** Its map's insertion order is the trains array's order is the `<g>` elements' order.
  Delete-then-set moved every SURVIVING train on the refreshed line to the END (a Map appends a key it
  just deleted), React reconciled that with `insertBefore`, and **a re-inserted element re-runs
  `@starting-style`** — so the whole line replayed its 600ms fade-in every 11s. Survivors are now
  overwritten IN PLACE (`Map.set` on an existing key does not move it) and only genuinely new trains are
  appended. MEASURED on identical live data, counted as React counts it (nodes outside the longest
  increasing subsequence, so a departing train is not miscounted as a move): **27 DOM moves per refresh ->
  0**. Diagnosed by measuring element churn over 13 real ticks — at steady state only 3-5 dots of ~256
  mount per tick, which is what ruled out "re-placed dots are remounting" and pointed at ordering.
  491 JS tests (was 479); tsc + Vite clean; no Rust changes.

- **London map · placement precision (2026-08-18).** Three derivation fixes, each MEASURED against the
  live feed before merging (434 trains: 314 on segment, 120 still, 0 dropped). **(1) A journey's LAST
  prediction no longer snaps the dot forward.** With one prediction left `resolvePlacement` demotes to
  "still at the destination" — but eta > 0 says the train is not there. `keepRunning` now keeps the
  running segment while its implied progress < 1 and the still sits at that segment's own `to`; it parks
  only once the animation has arrived. 65 of 431 live trains (15%) were in this state. **(2) Skip-stop
  services resolve.** `resolvePrevious` required (next, after-next) to be IMMEDIATELY adjacent, so the
  Metropolitan's fast/semi-fast trains — which predict only their calling points — resolved nothing and
  parked at `next` for minutes. It now searches `RESOLVE_WINDOW = 5` stations along each branch
  (5 covers the Met's longest real non-stopping run, Harrow-on-the-Hill→Moor Park skipping four
  stations — a live train sat unresolved at exactly that depth when 4 was tried); the drawn segment is
  still from the IMMEDIATE neighbour, which is the same approach track either way. Of 58 live
  unresolved pairs, the window fixes the fixable ones — 50 of the rest have an after-next that is on no
  baked branch of the line at any distance (termini, feed quirks) and correctly hold still. **(3) Segment
  durations use the spline's ARC LENGTH, not the chord.** The animation runs along the curve, so the
  chord undercut every bowed segment (live: p50 0.7s, p90 3.6s, max 12.4s per segment).
  `bake-train-segments.mjs` now also emits **`londonTrainSegments.lengths.ts`** (`SEGMENT_ARC_LENGTHS`,
  keyed by animation name, ~12 KB) from the arc tables it already built; `segmentSeconds` takes an
  optional arc length and `resolvePlacement` looks it up by name — a miss falls back to the chord, which
  is what keeps the hand-built test fixtures honest, so the contract test in `trainSegments.test.mjs`
  gained "every baked rule has a length, and no more" (the only thing that would notice the two
  generated files drifting). The re-run bake left the CSS byte-identical. 503 JS tests (was 491); tsc +
  Vite clean; no Rust changes.

- **Picker activity markers (2026-08-20).** Each worktree/scratch row in the slot picker carries a
  runtime marker: **play** = displayed, **play at 0.5 opacity** = running off screen, **pause at 0.5** =
  nothing running. It answers "what's still burning CPU behind my back", which was invisible before —
  because gear→**Close** unassigns the slot but leaves the PTYs alive (`claude`, the dev server), while
  **Pause** kills them, and the two looked identical.
  - **This is `activity`, NOT `status` — the naming is load-bearing.** A ticket-shaped worktree lifecycle
    (in progress / on hold / PR'd / awaiting release) is a separate, deliberately deferred thread, and
    the vestigial persisted `Worktree.status: "ongoing" | "completed"` is ITS seed — a field with no
    writer since dockview went (its only readers are the picker's `ongoing` filter and `initSlots`). So
    activity is a different word, wholly **derived**, session-only, and touches no persisted field: no
    `Worktree` change, no Rust struct change, no `cockpit.json` change, no migration for thread 2 to undo.
  - **Pure `activityOf(id, { displayedIds, livePtyIds })`** in `src/worktrees/activity.ts`: displayed if
    the id is in `slots` or is `cockpitWorktreeId`; else running if a live pty id starts with `<id>:`
    (the separator is required — `wt-1` must not match `wt-10:claude`); else paused. **displayed wins over
    running** on purpose, and paused therefore also covers never-opened-this-session — both mean nothing
    of yours is running.
  - **⚠️ `pty_live_ids` must use `child.try_wait()`, not `table.keys()`.** A registry key is removed ONLY
    by `pty_kill`/`kill_all`, so a shell the user `exit`ed leaves its entry behind (which is also why
    `pty_ensure`'s "already alive → reattach" early return can't respawn it, and why `respawn` kills
    first). Keys alone would report a dead shell as running. The command is read-only — it deliberately
    does NOT prune dead entries, since that would change that early-return contract. Memory-only, so it
    stays a **sync** command per the main-thread rule. Split as tested `live_ids(&PtyManager)` + a thin
    `#[tauri::command]` wrapper, because `State<PtyManager>` isn't constructible in a unit test.
  - **Queried on popover open, not polled.** `Dropdown` gained `onOpen?: () => void`; `SlotColumn` holds
    the result in local state. The answer only has to be true while the list is on screen, so there's no
    store slice, no poll thread, no event stream — and only the column you actually opened fires.
    The notify sits OUTSIDE the `setOpen` updater: StrictMode invokes updaters twice and would
    double-fire it. Accepted cost: the first frame after opening renders from an empty snapshot (so
    off-screen rows flash "paused") — one frame, since the invoke is a HashMap scan.
  - **`DropdownOption.icon?: ReactNode`** is a *generic* leading slot (`.dd__opt-icon`, sized by
    `font-size` since the glyphs are `1em`/`currentColor`) — the caller decides what a row's glyph means,
    so `Dropdown` never learns the word "activity". The marker is **not** on the trigger: the selected row
    is displayed by definition, so a permanent play icon there is noise. Scratch rows get it too (same
    computation on `<id>:shell`) — marking worktrees but not scratch would read as a bug.
  - Worth an eyeball: displayed vs running differ only in opacity, so they may be hard to tell apart in
    practice; swapping running to a distinct glyph is a one-line change in `ACTIVITY_ICON`.
  138 Rust (+1) + 522 JS (+8) tests green; tsc + Vite + cargo clean, warning-free.

✅ **Third view removed (2026-09-10).** The view set is now `Cockpit` + `Worktrees` only. Gone with it: the
nav entry, `SlotColumn`'s `variant` prop, `WorktreeBody`'s `switcher`, `WorktreePane`'s `lead` header slot
(the pane header is a plain icon+title again), and the CSS density overrides — including the two rules that
existed only to out-specify `.wt-pane--closed`. `View` is now `"cockpit" | "worktrees"`; an unrecognised
persisted `defaultView` falls through `normalizeView`'s catch-all to Worktrees, so no migration is needed.
The "one mounted tree at two densities" xterm constraint is retired — Worktrees is a plain single mount.
541 JS + 137 Rust tests green; tsc + Vite + cargo clean.

✅ **Open the repo's own working tree (2026-09-10).** Checkout can now open the primary clone as a column
instead of only adding worktrees. The branch the repo itself holds is hoisted to the top of the picker and
stays pickable ("· open in place") — every other checked-out branch stays disabled, since git still refuses
to worktree-add a claimed branch. Picking it runs **no git at all**: the entity is a plain `Worktree` with
`worktreePath === repoPath`, which is also the marker — `isPrimaryTree`, derived rather than persisted,
because `git worktree add` can never place a worktree at the repo root, so there is no flag to migrate.
Everything in `WorktreeBody` (Claude pane, Run, extra shells, chips, links, Cockpit pin, rename) works
unchanged; a second Open of the same repo reveals the existing column rather than minting a rival entity.
Two consequences handled: the model's branch snapshot goes stale because the user switches branches in that
clone outside cockpit, so the new `current_branch` command re-reads HEAD on mount and on window focus and
writes it back (the ⓘ row and the branch-derived chips follow); and git teardown is off the table — `git
worktree remove` refuses a main working tree and Wipe's `git branch -D` would aim at their trunk, so the gear
menu swaps **Delete + Wipe** for **Forget**, which kills the panes and drops cockpit's model row only.
`TeardownConfirm` is unreachable for these entities. Review caught the reveal-the-existing-column path
duplicating instead of deduping — `placeEntity`/`fillEntity` never checked whether the id was already in a
slot, so one worktree could own two columns and bind two xterms to one PTY; both reducers are now
idempotent, which closes the same hole for the picker. Known and accepted: the Diff tab on a primary tree
sitting on the default branch compares main to main and shows nothing; a detached primary tree reports its
branch as the literal "HEAD"; and `checkedOutPath === repoPath` is a string match, so a trailing slash or a
symlinked repo path in `knownRepos` makes the primary row silently absent (the robust fix is backend-side —
`git worktree list --porcelain` always lists the main working tree first).
**GUI verified.** 552 JS (+11) + 138 Rust (+1) tests green; tsc + Vite + cargo clean.
