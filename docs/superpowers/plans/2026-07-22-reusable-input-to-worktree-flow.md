# Reusable input→worktree flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user turn a Slack unread, a To Do item, or a PR review request into a worktree via one recognisable tree-icon button that reuses the existing deduce→create flow, with a per-source context template (configured in Settings) prepended to the worktree's initial Claude prompt.

**Architecture:** `startDeduceWorktree` gains an optional `source`; the store prepends the source's context to the persisted `Worktree.prompt` (step 2 only — the deduce/routing input stays the bare item content). A shared `<CreateWorktreeButton>` (tree glyph) is embedded in Todo/Slack/PR items. Settings gets a `worktreeContexts` config field and a pane to edit it. One new Rust command `slack_permalink` resolves an archives permalink so Slack items hit the deduce Slack-MCP path.

**Tech Stack:** Rust (Tauri v2 core), React 19 + TS (Vite), Zustand store, Vitest + cargo test.

## Global Constraints

- Top-of-file + top-of-block concise comments (role + intent), matching surrounding code.
- Smallest change that satisfies the requirement; no unrelated refactoring; follow existing patterns.
- Context is injected into the **initial Claude prompt only** (persisted `Worktree.prompt`), **never** the deduce input.
- `WorktreeSource = "manual" | "slack" | "todo" | "pr-review"`; `"manual"` (the modal) has no context → behaviour byte-identical to today.
- `DEFAULT_CONTEXTS = { "pr-review": "use the /code-review tool to review this PR", "todo": "use the /brainstorming tool to plan implementation" }` (verbatim; slack has no default).
- `effectiveContext(source, contexts) = contexts?.[source] ?? DEFAULT_CONTEXTS[source] ?? ""` — a configured empty string overrides the default (cleared field = no context).
- Tile-triggered creates use `view="cockpit"`.
- Design tokens: spacing `--space-1..6`, type `--fs-2xs..3xl`; text colours `--tx-hi/--tx-2/--tx-3`; `--accent`. Rust tests run from `src-tauri` (`cargo test`); JS tests via `npx vitest run`.
- No new frontend test dependency: the repo has only pure-function `.test.ts` tests (no component-test infra). Do NOT add `@testing-library`/`.test.tsx`; cover logic via pure helpers + store tests; the button is GUI-acceptance-covered.

---

### Task 1: Backend — `slack_permalink` command

**Files:**
- Modify: `src-tauri/src/slack.rs` (add pure `permalink_args` + `slack_permalink` command + a test)
- Modify: `src-tauri/src/lib.rs:48` (register the command)
- Modify: `src/tiles/slack/api.ts` (typed wrapper)

**Interfaces:**
- Produces (Rust): `pub fn permalink_args<'a>(channel_id: &'a str, ts: &'a str) -> [(&'a str, &'a str); 2]`; `#[tauri::command(async)] pub fn slack_permalink(manager: State<SlackManager>, channel_id: String, ts: String) -> Result<String, String>`.
- Produces (TS): `slackPermalink(channelId: string, ts: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/slack.rs`:

```rust
#[test]
fn permalink_args_names_channel_and_message_ts() {
    assert_eq!(
        permalink_args("C123", "1700000000.000100"),
        [("channel", "C123"), ("message_ts", "1700000000.000100")]
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test permalink_args`
Expected: FAIL — `cannot find function 'permalink_args'`.

- [ ] **Step 3: Implement the arg builder + command**

In `src-tauri/src/slack.rs`, near the other `api_get`-based commands (e.g. just above `slack_list_conversations`), add:

```rust
// Pure: the chat.getPermalink query params (target channel + message timestamp).
pub fn permalink_args<'a>(channel_id: &'a str, ts: &'a str) -> [(&'a str, &'a str); 2] {
    [("channel", channel_id), ("message_ts", ts)]
}

// slack_permalink: resolve an archives permalink for a message so the deduce Slack MCP path can
// fetch the real message + thread. Uses the existing authed Web API client.
#[tauri::command(async)]
pub fn slack_permalink(manager: State<SlackManager>, channel_id: String, ts: String) -> Result<String, String> {
    let token = manager.store.get(ACCOUNT_TOKEN)?.ok_or("not connected")?;
    let resp = api_get(&token, "chat.getPermalink", &permalink_args(&channel_id, &ts))?;
    resp.get("permalink")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "no permalink in response".to_string())
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, add `slack::slack_permalink,` to the `invoke_handler` list right after `slack::slack_init,` (line ~48).

- [ ] **Step 5: Add the frontend wrapper**

In `src/tiles/slack/api.ts`, append:

```ts
export const slackPermalink = (channelId: string, ts: string) =>
  invoke<string>("slack_permalink", { channelId, ts });
```

- [ ] **Step 6: Run tests + build**

Run: `cd src-tauri && cargo test permalink_args && cargo build`
Expected: test PASS; build succeeds, no new warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/slack.rs src-tauri/src/lib.rs src/tiles/slack/api.ts
git commit -m "feat: add slack_permalink command (chat.getPermalink)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Config field + `worktreeContext` helper + store action

**Files:**
- Create: `src/worktrees/worktreeContext.ts`
- Create: `src/worktrees/worktreeContext.test.ts`
- Modify: `src/settings/types.ts:49-58` (add `worktreeContexts?` to `CockpitConfig`)
- Modify: `src-tauri/src/settings.rs` (add `worktree_contexts` field to `CockpitConfig` struct + its `Default` impl)
- Modify: `src/settings/store.ts` (default config + `setWorktreeContext` action + interface line)

**Interfaces:**
- Produces (TS): `type WorktreeSource = "manual" | "slack" | "todo" | "pr-review"`; `const DEFAULT_CONTEXTS: Record<string, string>`; `effectiveContext(source: WorktreeSource, contexts: Record<string, string> | undefined): string`; store action `setWorktreeContext(source: WorktreeSource, text: string): void`; `CockpitConfig.worktreeContexts?: Record<string, string>`.
- Consumed by Tasks 3 (store seam), 4 (button), 5 (Settings pane).

- [ ] **Step 1: Write the failing helper tests**

Create `src/worktrees/worktreeContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveContext, DEFAULT_CONTEXTS } from "./worktreeContext";

describe("effectiveContext", () => {
  it("returns the configured value when the key exists", () => {
    expect(effectiveContext("todo", { todo: "custom text" })).toBe("custom text");
  });
  it("a configured empty string overrides the default (cleared field = no context)", () => {
    expect(effectiveContext("pr-review", { "pr-review": "" })).toBe("");
  });
  it("falls back to the shipped default when the key is absent", () => {
    expect(effectiveContext("pr-review", {})).toBe(DEFAULT_CONTEXTS["pr-review"]);
    expect(effectiveContext("todo", undefined)).toBe(DEFAULT_CONTEXTS["todo"]);
  });
  it("returns empty string for a source with no default and no config", () => {
    expect(effectiveContext("slack", {})).toBe("");
    expect(effectiveContext("manual", {})).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/worktrees/worktreeContext.test.ts`
Expected: FAIL — cannot resolve `./worktreeContext`.

- [ ] **Step 3: Implement the helper**

Create `src/worktrees/worktreeContext.ts`:

```ts
// worktreeContext.ts — per-source context templates prepended to a worktree's initial Claude
// prompt (step 2 only; never the deduce/routing input). Pure, no IO.

export type WorktreeSource = "manual" | "slack" | "todo" | "pr-review";

// Shipped defaults; a configured value (including "") overrides these.
export const DEFAULT_CONTEXTS: Record<string, string> = {
  "pr-review": "use the /code-review tool to review this PR",
  todo: "use the /brainstorming tool to plan implementation",
};

// The active context for a source: the configured value if the key exists (empty string included,
// so a deliberately-cleared field wins over the default), else the shipped default, else "".
export function effectiveContext(source: WorktreeSource, contexts: Record<string, string> | undefined): string {
  return contexts?.[source] ?? DEFAULT_CONTEXTS[source] ?? "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/worktrees/worktreeContext.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the TS config field**

In `src/settings/types.ts`, add to the `CockpitConfig` interface (after `todos: TodoItem[];`):

```ts
  worktreeContexts?: Record<string, string>;
```

- [ ] **Step 6: Add the Rust config field**

In `src-tauri/src/settings.rs`, in the `CockpitConfig` struct (after the `todos` field, ~line 166) add:

```rust
    #[serde(default, rename = "worktreeContexts", skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub worktree_contexts: std::collections::HashMap<String, String>,
```

Then in `impl Default for CockpitConfig` (the block starting ~line 180, which lists every field) add:

```rust
            worktree_contexts: std::collections::HashMap::new(),
```

- [ ] **Step 7: Add the store default + action**

In `src/settings/store.ts`:

1. Extend the import from `../worktrees/...` — add a new import line near the other worktree imports (line ~9):
```ts
import { effectiveContext, type WorktreeSource } from "../worktrees/worktreeContext";
```
2. In the default cockpit config (line ~113), add `worktreeContexts: {}` to the object (after `todos: []`).
3. Add the action to the `SettingsState` interface (near `setPrChannel`, line ~38):
```ts
  setWorktreeContext: (source: WorktreeSource, text: string) => void;
```
4. Add the implementation (near `setPrChannel`, line ~339):
```ts
  setWorktreeContext: (source, text) =>
    get().setCockpit((c) => ({ ...c, worktreeContexts: { ...c.worktreeContexts, [source]: text } })),
```

(Note: `effectiveContext` is imported now but consumed in Task 3 — it is used within this same file next task; leaving it imported is intentional. If your linter fails an unused import between tasks, import it in Task 3 instead. Check: `npx vitest run` must still pass here.)

- [ ] **Step 8: Run JS + Rust tests**

Run: `npx vitest run && cd src-tauri && cargo test && cd ..`
Expected: all green (4 new JS tests + existing suites; Rust unchanged behaviour). If an unused-import error appears for `effectiveContext`, move that named import into Task 3's edit and re-run — the store change here does not yet reference it.

- [ ] **Step 9: Commit**

```bash
git add src/worktrees/worktreeContext.ts src/worktrees/worktreeContext.test.ts src/settings/types.ts src-tauri/src/settings.rs src/settings/store.ts
git commit -m "feat: add worktreeContexts config + effectiveContext helper + setWorktreeContext

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extend `startDeduceWorktree` with `source` + context composition

**Files:**
- Modify: `src/settings/store.ts` (signature line ~61, impl ~220-251)
- Modify: `src/settings/store.test.ts` (add a composition test)

**Interfaces:**
- Consumes: `effectiveContext`, `WorktreeSource` (Task 2).
- Produces: `startDeduceWorktree(prompt: string, view: View, source?: WorktreeSource): void` — deduce still receives the bare `prompt`; the persisted `Worktree.prompt` becomes `context + "\n\n" + prompt` when a context exists.

- [ ] **Step 1: Write the failing test**

In `src/settings/store.test.ts`, inside the `describe("startDeduceWorktree — pending worktree flow", …)` block, add:

```ts
it("prepends the per-source context to the pane prompt; deduce still gets the bare input", async () => {
  vi.mocked(deduceWorktree).mockResolvedValue(deduced);
  vi.mocked(createWorktree).mockResolvedValue("/wt/fix-login");
  useSettings.getState().startDeduceWorktree("review https://github.com/a/b/pull/3", "cockpit", "pr-review");
  await flush();
  const st = useSettings.getState();
  expect(st.cockpit.worktrees[0].prompt).toBe(
    "use the /code-review tool to review this PR\n\nreview https://github.com/a/b/pull/3"
  );
  expect(deduceWorktree).toHaveBeenCalledWith("review https://github.com/a/b/pull/3", ["/a"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/settings/store.test.ts -t "prepends the per-source context"`
Expected: FAIL — `startDeduceWorktree` ignores the 3rd arg; `worktrees[0].prompt` equals the bare input.

- [ ] **Step 3: Implement the source arg + composition**

In `src/settings/store.ts`:

1. Update the interface (line ~61):
```ts
  startDeduceWorktree: (prompt: string, view: View, source?: WorktreeSource) => void;
```
2. Update the impl signature (line ~220):
```ts
  startDeduceWorktree: (prompt, view, source = "manual") => {
```
3. Just before the `get().addWorktree(makeWorktree({…}))` call (after `const sl = sourceLinkFrom(d);`, line ~247), add:
```ts
        // Prepend the per-source context to the pane prompt (step 2 only); deduce used the bare prompt.
        const ctx = effectiveContext(source, get().cockpit.worktreeContexts);
        const panePrompt = ctx ? `${ctx}\n\n${prompt}` : prompt;
```
4. In the `makeWorktree({…})` object, change `prompt,` to `prompt: panePrompt,`.

(If `effectiveContext`/`WorktreeSource` were not imported in Task 2, add `import { effectiveContext, type WorktreeSource } from "../worktrees/worktreeContext";` near line 9.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/settings/store.test.ts`
Expected: PASS — the new test plus all existing `startDeduceWorktree` tests (the default-`"manual"` cases still store the bare prompt, since `effectiveContext("manual", …)` is `""`).

- [ ] **Step 5: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat: startDeduceWorktree accepts a source; prepends per-source context to the pane prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Shared `<CreateWorktreeButton>` component

**Files:**
- Create: `src/views/CreateWorktreeButton.tsx`
- Create: `src/views/CreateWorktreeButton.css`

**Interfaces:**
- Consumes: `useSettings().startDeduceWorktree`, `WorktreeSource` (Task 2/3).
- Produces: `CreateWorktreeButton(props: { source: WorktreeSource; view: View; getInput: () => string | Promise<string>; title?: string })` — default export not used; named export.

- [ ] **Step 1: Create the component**

Create `src/views/CreateWorktreeButton.tsx`:

```tsx
// CreateWorktreeButton.tsx — the app-wide "turn this item into a worktree" affordance (tree glyph).
// On click it resolves the item's input (sync or async) and kicks off the shared deduce→create flow.
import { useState } from "react";
import type { MouseEvent } from "react";
import { useSettings } from "../settings/store";
import type { WorktreeSource } from "../worktrees/worktreeContext";
import "./CreateWorktreeButton.css";

type View = "cockpit" | "worktrees" | "calm";

export function CreateWorktreeButton({
  source, view, getInput, title = "Create worktree",
}: {
  source: WorktreeSource;
  view: View;
  getInput: () => string | Promise<string>;
  title?: string;
}) {
  const startDeduceWorktree = useSettings((s) => s.startDeduceWorktree);
  const [busy, setBusy] = useState(false);
  // Resolve the input (may be an async permalink fetch), then hand it to the shared flow.
  const onClick = async (e: MouseEvent) => {
    e.stopPropagation(); // don't trigger the row's own click (e.g. the Slack row opens the app)
    if (busy) return;
    setBusy(true);
    try {
      const input = (await getInput()).trim();
      if (input) startDeduceWorktree(input, view, source);
    } catch {
      /* swallow: e.g. permalink fetch failed — nothing to create from */
    }
    setBusy(false);
  };
  return (
    <button className="create-wt-btn" aria-label={title} title={title} disabled={busy} onClick={onClick}>
      <span className="create-wt-btn__ico" aria-hidden />
    </button>
  );
}
```

- [ ] **Step 2: Create the styles**

Create `src/views/CreateWorktreeButton.css`:

```css
/* CreateWorktreeButton — small icon button showing the masked tree glyph, tinted to accent on hover. */
.create-wt-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: var(--space-1); background: none; border: none; cursor: pointer;
  color: var(--tx-3); font-size: var(--fs-lg);
}
.create-wt-btn:hover { color: var(--accent); }
.create-wt-btn:disabled { opacity: 0.5; cursor: default; }
/* Alpha-only glyph tinted via background-color + mask (same idiom as .wt-col__icon). */
.create-wt-btn__ico {
  width: 1em; height: 1em; display: block; background-color: currentColor;
  -webkit-mask: url("../assets/icons/tree.svg") center / contain no-repeat;
  mask: url("../assets/icons/tree.svg") center / contain no-repeat;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests still green (no test for this component by repo convention — GUI-acceptance-covered).

- [ ] **Step 4: Commit**

```bash
git add src/views/CreateWorktreeButton.tsx src/views/CreateWorktreeButton.css
git commit -m "feat: shared CreateWorktreeButton (tree-glyph, async-safe input)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Settings pane — "Worktree contexts"

**Files:**
- Create: `src/views/WorktreeContexts.tsx`
- Modify: `src/views/SettingsModal.tsx` (import + one `PANES` entry)
- Modify: `src/views/SettingsModal.css` (field styles)

**Interfaces:**
- Consumes: `useSettings().cockpit.worktreeContexts`, `useSettings().setWorktreeContext`, `DEFAULT_CONTEXTS`, `WorktreeSource` (Task 2).

- [ ] **Step 1: Create the pane component**

Create `src/views/WorktreeContexts.tsx`:

```tsx
// WorktreeContexts.tsx — Settings pane: per-source text prepended to a worktree's initial Claude
// prompt when it is created from that part of the app.
import { useSettings } from "../settings/store";
import { DEFAULT_CONTEXTS } from "../worktrees/worktreeContext";
import type { WorktreeSource } from "../worktrees/worktreeContext";

const SOURCES: { source: WorktreeSource; label: string }[] = [
  { source: "pr-review", label: "PR reviews" },
  { source: "todo", label: "To Do items" },
  { source: "slack", label: "Slack messages" },
];

export function WorktreeContexts() {
  const contexts = useSettings((s) => s.cockpit.worktreeContexts);
  const setWorktreeContext = useSettings((s) => s.setWorktreeContext);
  return (
    <div className="wt-ctx">
      <p className="wt-ctx__hint">
        Prepended to the initial Claude prompt when you create a worktree from that part of the app.
      </p>
      {SOURCES.map(({ source, label }) => (
        <label key={source} className="wt-ctx__field">
          <span className="wt-ctx__label">{label}</span>
          <textarea
            className="wt-ctx__input"
            rows={2}
            value={contexts?.[source] ?? DEFAULT_CONTEXTS[source] ?? ""}
            onChange={(e) => setWorktreeContext(source, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Register the pane**

In `src/views/SettingsModal.tsx`:
1. Add the import (after the `KnownReposEditor` import):
```tsx
import { WorktreeContexts } from "./WorktreeContexts";
```
2. Add a `PANES` entry (after the `repos` entry):
```tsx
  { id: "worktree-contexts", label: "Worktree contexts", render: () => <WorktreeContexts /> },
```

- [ ] **Step 3: Add field styles**

Append to `src/views/SettingsModal.css`:

```css
/* Worktree-contexts pane: labelled textareas (textarea inherits the global form-control theme). */
.wt-ctx__hint { color: var(--tx-3); font-size: var(--fs-sm); margin-bottom: var(--space-4); }
.wt-ctx__field { display: block; margin-bottom: var(--space-4); }
.wt-ctx__label { display: block; font-size: var(--fs-sm); color: var(--tx-2); margin-bottom: var(--space-1); }
.wt-ctx__input { width: 100%; resize: vertical; }
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/views/WorktreeContexts.tsx src/views/SettingsModal.tsx src/views/SettingsModal.css
git commit -m "feat: Worktree contexts settings pane

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire the button into Todo, Slack, and PR tiles

**Files:**
- Modify: `src/tiles/todo/TodoTile.tsx`
- Modify: `src/tiles/slack/SlackTile.tsx`
- Modify: `src/tiles/pr/PrReviewsTile.tsx`

**Interfaces:**
- Consumes: `<CreateWorktreeButton>` (Task 4), `slackPermalink` (Task 1).

- [ ] **Step 1: Todo row**

In `src/tiles/todo/TodoTile.tsx`:
1. Add import:
```tsx
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
```
2. In the row, immediately before the existing delete button (`<button className="todo__del" …>`), add:
```tsx
                  <CreateWorktreeButton source="todo" view="cockpit" getInput={() => t.text} title="Create worktree from this to-do" />
```

- [ ] **Step 2: Slack row**

In `src/tiles/slack/SlackTile.tsx`:
1. Add imports:
```tsx
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
import { slackSnapshot, slackRefresh, slackPermalink } from "./api";
```
(replace the existing `slackSnapshot, slackRefresh` import line with this one).
2. In the row `<li>` (after the `slack-tile__meta` span, still inside the `<li>`), add:
```tsx
              <CreateWorktreeButton
                source="slack"
                view="cockpit"
                getInput={() => slackPermalink(c.id, c.latestTs)}
                title="Create worktree from this message"
              />
```
(The button already `stopPropagation`s, so the row's `openUrl` click won't also fire.)

- [ ] **Step 3: PR row — replace `+ Review`**

In `src/tiles/pr/PrReviewsTile.tsx`:
1. Add import:
```tsx
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
```
2. Delete the `review` helper line:
```ts
  const review = (item: PrReviewItem) => startDeduceWorktree(`${item.title} ${item.url}`, "cockpit");
```
3. Remove the now-unused `startDeduceWorktree` selector line if nothing else uses it:
```ts
  const startDeduceWorktree = useSettings((s) => s.startDeduceWorktree);
```
4. Replace the `+ Review` button:
```tsx
                    <button className="pr-tile__review" onClick={() => review(i)}>+ Review</button>
```
with:
```tsx
                    <CreateWorktreeButton source="pr-review" view="cockpit" getInput={() => `${i.title} ${i.url}`} title="Create worktree to review this PR" />
```

- [ ] **Step 4: Verify build + tests**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean (no unused `startDeduceWorktree`/`review`/`PrReviewItem` — remove the `PrReviewItem` type import too if it becomes unused); all tests green; Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/todo/TodoTile.tsx src/tiles/slack/SlackTile.tsx src/tiles/pr/PrReviewsTile.tsx
git commit -m "feat: add CreateWorktreeButton to Todo, Slack, and PR tiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Reusable seam with `source` + context (spec §A) → Task 2 (helper/config) + Task 3 (seam). ✓
- Shared tree-glyph button (spec §B) → Task 4. ✓
- Per-source Settings context, `worktreeContexts` field + pane, defaults (spec §C) → Task 2 (field/defaults) + Task 5 (pane). ✓
- Wiring Todo/Slack/PR, PR button replaced (spec §D) → Task 6. ✓
- `slack_permalink` / `chat.getPermalink` (spec §E) → Task 1. ✓
- Context step-2-only; deduce gets bare input → Task 3 test asserts both. ✓
- Back-compat config (`#[serde(default)]`, optional TS) → Task 2 Steps 5-6. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `WorktreeSource`, `DEFAULT_CONTEXTS`, `effectiveContext` defined in Task 2 and consumed with matching signatures in Tasks 3-5; `startDeduceWorktree(prompt, view, source?)` defined in Task 3 and called with 3 args in Tasks 4/6; `slackPermalink(channelId, ts)` defined in Task 1, called in Task 6; command arg names (`channelId`,`ts`) map to Rust `channel_id`,`ts` via Tauri's camelCase convention (matches existing `slackSetCredentials`).
