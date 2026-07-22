# Reusable input→worktree flow — design

**Date:** 2026-07-22
**Status:** design approved, pre-plan

## Goal

Make the "input → worktree" flow reusable, then surface it across the app: a user can
turn a **Slack unread**, a **To Do item**, or a **PR review request** into a worktree by
clicking a single, recognisable **tree-logo button** on the item. The click reuses the
existing deduce → create flow. Settings gains a per-source **context template** that is
prepended to the worktree's initial Claude prompt (e.g. PR reviews → "use the /code-review
tool to review this PR").

## Background (current state)

- **`startDeduceWorktree(prompt, view)`** (`src/settings/store.ts`) is already the single
  entry point for the flow: it places a pending tile, runs `deduce_worktree` → `create_worktree`
  in the background, swaps the real worktree into the slot, and persists `Worktree.prompt`,
  which the Claude pane auto-sends once. It is already called by the new-worktree modal and
  by the PR tile's `+ Review` button (`startDeduceWorktree(`${item.title} ${item.url}`, "cockpit")`).
- **Deduce input is deliberately lean** (2026-07-22 routing-hint fix): `deduce_worktree` bounds
  the prompt it sends the routing LLM to the first ~2 sentences / 200 chars. Work-instructions
  therefore must NOT go into the deduce input.
- **`SettingsModal`** (`src/views/SettingsModal.tsx`) renders a `PANES` registry — one entry per
  settings pane; adding a pane is a one-line append.
- **Tree glyph** = `src/assets/icons/tree.svg`, rendered as a CSS-masked span (existing rules
  `.wt-col__icon--tree`, `.app__logo`).
- **Slack tile rows** are per-*conversation* (`SlackConversation`: `id`, `kind`, `name`,
  `latestText`, `latestTs`, `unreadCount`) — a preview only, **no archives permalink**. The
  archives permalink is what the deduce Slack MCP path needs to fetch the full message + thread.
- **Todo item** = `{ id, text, state }`. **PR item** already carries `title` + `url`.

## Decisions

1. **Context is injected into the initial Claude prompt only (step 2), never the deduce input
   (step 1).** The examples ("/code-review", "/brainstorming") are work instructions; keeping
   them out of deduce preserves the lean routing signal from the routing-hint fix.
2. **Slack → worktree fetches a real permalink** (`chat.getPermalink` on the conversation's
   latest ts) so deduce runs its Slack MCP path and reads the real message + thread.
3. **The PR tile's `+ Review` text button is replaced by the shared tree-icon button** for a
   consistent, recognisable affordance across the app.
4. **Tile-triggered creates use `view="cockpit"`** (matches the PR tile's current behaviour;
   confirmed all tile creates happen from the Cockpit view for now).

## Architecture

### A. The reusable seam — `startDeduceWorktree` gains a `source`

```ts
type WorktreeSource = "manual" | "slack" | "todo" | "pr-review";
startDeduceWorktree(input: string, view: View, source?: WorktreeSource): void  // default "manual"
```

- **Deduce input** = `input`, unchanged (still bounded by the Rust routing-hint).
- **Pane prompt** (persisted as `Worktree.prompt`, auto-sent once) =
  `const ctx = effectiveContext(source, config); ctx ? `${ctx}\n\n${input}` : input`.
- Everything else in `startDeduceWorktree` (pending tile, swap-in-place, error reopen,
  `initialPromptPending` arming) is unchanged.

Pure, tested helper (frontend):

```ts
// effectiveContext: the per-source context template — the user's configured value if the key
// exists (empty string included, so a cleared field really means "no context"), else the
// shipped default, else "".
function effectiveContext(source: WorktreeSource, config: CockpitConfig): string {
  return config.worktreeContexts?.[source] ?? DEFAULT_CONTEXTS[source] ?? "";
}

const DEFAULT_CONTEXTS: Record<string, string> = {
  "pr-review": "use the /code-review tool to review this PR",
  "todo": "use the /brainstorming tool to plan implementation",
};
```

`"manual"` has no default and no configured key → empty context → the modal's behaviour is
byte-identical to today.

### B. Shared button component — `<CreateWorktreeButton>`

`src/views/CreateWorktreeButton.tsx`:

```ts
function CreateWorktreeButton(props: {
  source: WorktreeSource;
  view: View;
  getInput: () => string | Promise<string>;
  title?: string; // tooltip, default "Create worktree"
}): JSX.Element
```

- Renders a small icon button showing the tree glyph (masked `tree.svg`; new one-line
  `.wt-ico--tree` mask rule reusing the existing `.wt-ico` sizing/tint pattern), tinted
  `--accent`, with hover state and an `aria-label`/tooltip.
- On click: `const input = await getInput(); if (input) startDeduceWorktree(input, view, source)`.
  The `getInput` thunk unifies sync callers (todo text, PR `title+url`) with the async Slack
  permalink fetch. A thrown/empty input is a no-op (defensive; e.g. permalink fetch fails).

### C. Settings — per-source context pane

- New persisted field on `CockpitConfig`: `worktreeContexts: Record<string, string>`
  (`#[serde(default)]` on the Rust side, back-compat: absent → empty map). Store action
  `setWorktreeContext(source, text)` writes one key.
- New `SettingsModal` pane **"Worktree contexts"** (one-line append to `PANES`): a component
  `WorktreeContexts` rendering one labelled `<textarea>` per source in
  `["pr-review", "todo", "slack"]`, each pre-filled with
  `config.worktreeContexts?.[key] ?? DEFAULT_CONTEXTS[key] ?? ""`. `onChange`/blur calls
  `setWorktreeContext(key, value)`. A short helper line explains the context is prepended to
  the Claude prompt when a worktree is created from that source.

### D. Wiring the three callers

- **Todo row** (`TodoTile.tsx`): add `<CreateWorktreeButton source="todo" view="cockpit"
  getInput={() => t.text} />` next to the `✕` delete button. (The todo is left unchanged —
  not auto-completed.)
- **Slack row** (`SlackTile.tsx`): add the button inside the `<li>`, wrapped so its click
  `stopPropagation`s (the row's own click still opens Slack). `getInput = async () =>
  slackPermalink(c.id, c.latestTs)`, `source="slack"`.
- **PR row** (`PrReviewsTile.tsx`): replace the `+ Review` button with
  `<CreateWorktreeButton source="pr-review" view="cockpit" getInput={() => `${i.title} ${i.url}`} />`.
  The existing `review()` helper is removed.

### E. Backend — one new command

`src-tauri/src/slack.rs`:

```rust
// slack_permalink: resolve an archives permalink for a message, so the deduce Slack MCP path
// can fetch the real message + thread. Uses the existing authed Web API client.
#[tauri::command(async)]
pub fn slack_permalink(channel_id: String, ts: String, state: State<…>) -> Result<String, String>
```

- Calls `chat.getPermalink?channel=<channel_id>&message_ts=<ts>` via the existing `api_get`
  (15s timeout, 429 retry), returns the `permalink` string field. Errors surface as `Err`.
- Frontend `src/tiles/slack/api.ts` wrapper `slackPermalink(channelId, ts): Promise<string>`.
- Registered in `lib.rs` alongside the other slack commands.

## Data flow (Slack example)

1. User clicks the tree button on a Slack unread row.
2. `getInput` → `slackPermalink(c.id, c.latestTs)` → `https://…slack.com/archives/…/p…`.
3. `startDeduceWorktree(permalink, "cockpit", "slack")`.
4. Store: deduce input = permalink (deduce detects the Slack ref → MCP path fetches the thread);
   pane prompt = `effectiveContext("slack", config)` (empty by default) + permalink.
5. Existing pending-tile → deduce → create → swap flow runs unchanged; the Claude pane
   auto-sends the pane prompt once.

## Testing

- **`effectiveContext`** (pure): configured value wins; empty configured string overrides the
  default (cleared field = no context); absent key falls back to the default; unknown source → "".
- **Prompt composition** in the store: `pane prompt = ctx + "\n\n" + input` when ctx non-empty;
  `= input` when empty; deduce input is always the bare `input` (source does not alter it).
- **`slack_permalink`** (Rust): pure arg/URL builder for `chat.getPermalink` params, and the
  response-parsing (extract `permalink`, error on `ok:false`) mirrored on the existing
  `parse_conversation` test style.
- **`CreateWorktreeButton`**: click calls `startDeduceWorktree` with the resolved input +
  source + view; empty/failed `getInput` is a no-op.
- Existing store / slack / tile tests stay green; the PR tile's `review()` removal updates any
  test referencing it.

## Out of scope / deferred

- **`linear` source** — the Linear tile is SP5; `WorktreeSource` and `DEFAULT_CONTEXTS` will
  gain a `linear` key (sharing or extending the todo default) when that tile lands.
- Auto-completing / advancing a todo when it becomes a worktree.
- Per-item (rather than per-source) context overrides.
- Turning arbitrary text selections into worktrees.
