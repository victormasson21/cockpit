# Calm View Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three defects that make Cockpit's Calm view feel broken — terminals not reflowing on view switch, and the focus + attention pane highlights never showing — by making Calm a second *density* of the Worktrees view rather than a second *mount* of it.

**Architecture:** Worktrees and Calm already render the same `slots` from the store, but `App.tsx` swaps component trees between them, which disposes and rebuilds every xterm on each switch. We render one tree and toggle a class instead, so the width change flows through xterm's own `ResizeObserver → fit() → onResize → pty_resize → SIGWINCH` path and Claude Code repaints itself. A one-line PTY resize on attach fixes the same defect on the paths that still legitimately remount. Calm's suppressions move from `variant` props threaded through three components into CSS under `.wt-col--calm`, and the two highlight cues get a border to colour via a component-local custom property.

**Tech Stack:** React 19 + TypeScript (Vite), zustand, xterm.js v6 + FitAddon, Tauri v2 IPC, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-04-calm-view-decoupling-design.md`. Read it before Task 1.
- **No Rust changes.** The whole plan is frontend. `pty_resize` and `pty_ensure` already exist.
- **No new dependencies.**
- **British English** in prose and comments — *behaviour*, *colour*, *centred*.
- **Comments explain why, not what** (project CLAUDE.md). One line by default, only where something is genuinely surprising.
- **Colour literals are banned outside the allowed sites.** Use theme tokens (`--accent`, `--bad`, `--bdr`). `transparent` is a keyword, not a literal, and is fine.
- **Terminal bodies stay always-dark** (`--term` + the fixed `TERM_THEME` in `useTerminal.ts`). Nothing in this plan touches either.
- **Baseline to preserve:** 306 JS tests in 33 files pass (`npx vitest run`). `npm run build` (= `tsc && vite build`) is clean.
- **`npm install` has been run** in this worktree. If `node_modules` is missing, run it first.
- **Do not touch** the store, `slots.ts`, `paneSet.ts`, `paneLifecycle.ts`, or anything persisted. This plan changes no state and no `cockpit.json` field.

---

### Task 1: Zero-size fit guard

A hidden pane measures 0. `FitAddon.proposeDimensions()` clamps with `Math.max(2, …)` / `Math.max(1, …)`, so if a hidden container ever reports a real `0px` (rather than the `auto` that currently yields `NaN` and makes the addon bail), `fit()` would resize the terminal to 2×1 and push that geometry onto the PTY — wrecking the very layout this plan fixes. Task 4 deliberately hides panes with CSS, so guard it ourselves rather than depending on the addon's internals.

**Files:**
- Create: `src/worktrees/fit.ts`
- Create: `src/worktrees/fit.test.ts`
- Modify: `src/worktrees/useTerminal.ts:150-151` (the `ResizeObserver`)

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldFit(width: number, height: number): boolean` from `src/worktrees/fit.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/worktrees/fit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldFit } from "./fit";

describe("shouldFit", () => {
  it("is true for a pane with real dimensions", () => {
    expect(shouldFit(720, 400)).toBe(true);
  });
  it("is false at zero height (a collapsed pane)", () => {
    expect(shouldFit(720, 0)).toBe(false);
  });
  it("is false at zero width (a density that hides this pane)", () => {
    expect(shouldFit(0, 400)).toBe(false);
  });
  // A display:none ancestor makes the computed height "auto", which parses to NaN rather than 0.
  it("is false when the measurement is not a number", () => {
    expect(shouldFit(NaN, NaN)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/worktrees/fit.test.ts`
Expected: FAIL — `Failed to resolve import "./fit"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/worktrees/fit.ts`:

```ts
// fit.ts — the guard for a terminal's ResizeObserver. FitAddon clamps its proposal to a 2x1 floor, so
// fitting a hidden pane would push that bogus geometry onto the PTY and wreck the TUI's layout.
// A NaN measurement (a display:none ancestor computes height "auto") fails the comparison too.
export function shouldFit(width: number, height: number): boolean {
  return width > 0 && height > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worktrees/fit.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Wire the guard into `useTerminal`**

In `src/worktrees/useTerminal.ts`, add to the imports beside the other local ones (after the `./keys` import on line 13):

```ts
import { shouldFit } from "./fit";
```

Then replace line 150:

```ts
    const ro = new ResizeObserver(() => fit.fit());
```

with:

```ts
    // Skip while the pane is off screen (collapsed, or a density that hides it): fitting at zero size
    // would push a 2x1 geometry onto the PTY. It re-fits as soon as it has real dimensions again.
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (shouldFit(width, height)) fit.fit();
    });
```

- [ ] **Step 6: Verify the full suite and the build**

Run: `npx vitest run && npm run build`
Expected: 310 tests passed (33 files → 34), and a clean `tsc && vite build`.

- [ ] **Step 7: Commit**

```bash
git add src/worktrees/fit.ts src/worktrees/fit.test.ts src/worktrees/useTerminal.ts
git commit -m "fix(terminal): skip fit while a pane measures zero"
```

---

### Task 2: Resize the PTY on attach

`pty_ensure` returns early on a live PTY (`src-tauri/src/pty.rs:83`) and never applies the size it was passed, and `term.onResize` is registered *after* the mount-time `fit.fit()`, so its resize event has no listener. Net: a PTY keeps the geometry it was spawned with forever. Any pane that remounts at a different width therefore has stale geometry, and its replayed scrollback was drawn for the old one. This task fixes that for every remounting path (Cockpit ↔ Worktrees for a pinned worktree, changing a slot's worktree in the picker, app restart); Task 3 removes the Worktrees ↔ Calm remount entirely.

**Files:**
- Modify: `src/worktrees/useTerminal.ts:129-141` (the async ensure/attach block)

**Interfaces:**
- Consumes: `PtyPane.resize(cols: number, rows: number): Promise<void>` from `src/worktrees/ptyPane.ts` (already exists; `pane` is already in scope).
- Produces: nothing new.

- [ ] **Step 1: Add the resize after the output subscription**

In `src/worktrees/useTerminal.ts`, inside the `(async () => { … })()` block, the `try` currently ends:

```ts
        term.write(scrollback);
        bellLive = true; // replay done — bells from here on are live and meaningful.
        unlisten = await pane.onOutput((bytes) => term.write(bytes));
```

Append one statement, so it reads:

```ts
        term.write(scrollback);
        bellLive = true; // replay done — bells from here on are live and meaningful.
        unlisten = await pane.onOutput((bytes) => term.write(bytes));
        // pty_ensure is a no-op on a live PTY, so this pane may have remounted at a width the PTY knows
        // nothing about — and the bytes just replayed were drawn for the old one. Resizing raises SIGWINCH
        // and the TUI repaints itself. It MUST come after onOutput: the repaint is output, and without a
        // subscriber it would land in the Rust scrollback buffer instead of on screen.
        await pane.resize(term.cols, term.rows);
```

- [ ] **Step 2: Verify the suite and the build still pass**

Run: `npx vitest run && npm run build`
Expected: 310 tests passed; clean build. (No test covers this — it lives in a React effect around a real
xterm. It is verified by the GUI smoke in Task 6, item 7.)

- [ ] **Step 3: Commit**

```bash
git add src/worktrees/useTerminal.ts
git commit -m "fix(terminal): resize the pty on attach so a remounted pane repaints"
```

---

### Task 3: One mount, two densities

Delete `CalmView` and render the Worktrees tree for both views, distinguished by a `calm` flag. React keeps the same element identity at the same position, so no xterm is disposed on the switch. **This is the task that fixes the reflow.**

**Files:**
- Modify: `src/views/WorktreesView.tsx` (add the `calm` prop)
- Modify: `src/views/WorktreesView.css` (hide the rail + swap buttons in the calm density)
- Modify: `src/App.tsx:14` (drop the import), `src/App.tsx:175-177` (render one view for both)
- Delete: `src/views/CalmView.tsx`

**Interfaces:**
- Consumes: `SlotColumn`'s existing `variant?: "full" | "calm"` prop (unchanged in this task).
- Produces: `WorktreesView({ onPin, calm }: { onPin: (id: string) => void; calm?: boolean })`.

- [ ] **Step 1: Give `WorktreesView` a `calm` prop**

In `src/views/WorktreesView.tsx`, change the signature:

```tsx
export function WorktreesView({ onPin }: { onPin: (id: string) => void }) {
```

to:

```tsx
export function WorktreesView({ onPin, calm = false }: { onPin: (id: string) => void; calm?: boolean }) {
```

Change the outer element from:

```tsx
    <div className="wt-view">
```

to:

```tsx
    <div className={`wt-view${calm ? " wt-view--calm" : ""}`}>
```

And pass the density down to each column — add `variant` to the existing `SlotColumn` element so it reads:

```tsx
          <SlotColumn
            key={slot.key}
            value={slot.id}
            onSelect={(id) => setSlot(slot.key, id)}
            onClose={() => removeSlot(slot.key)}
            onPin={onPin}
            variant={calm ? "calm" : "full"}
          />
```

Leave the `+` rail and the swap buttons rendering unconditionally — they come off in CSS in Step 2, which keeps this JSX identical in both densities.

Update the file's top comment to say it serves both densities:

```tsx
// WorktreesView.tsx — responsive Worktrees view: 1 (centered) / 2 / 3 columns by slots.length, plus a
// slim `+` rail (hidden at the 3-column cap) that appends an empty slot to fill. Also renders the Calm
// view: same mounted columns at a decluttered density (`calm`), never a second mount — switching trees
// would dispose every xterm and replay scrollback drawn at the old width.
```

- [ ] **Step 2: Hide the rail and the swap buttons in the calm density**

Append to `src/views/WorktreesView.css`:

```css
/* Calm density: the same mounted columns, decluttered. Only the view-level affordances come off here;
   the per-column suppressions live in WorktreeColumn.css / WorktreePane.css under .wt-col--calm. */
.wt-view--calm .wt-view__add,
.wt-view--calm .wt-view__swap { display: none; }
```

- [ ] **Step 3: Render one tree for both views in `App.tsx`**

In `src/App.tsx`, delete line 14:

```tsx
import { CalmView } from "./views/CalmView";
```

Then replace the three render lines (175-177):

```tsx
        {view === "cockpit" && <CockpitView onOpenSettings={() => setSettingsOpen(true)} />}
        {view === "worktrees" && <WorktreesView onPin={pinToCockpit} />}
        {view === "calm" && <CalmView />}
```

with:

```tsx
        {view === "cockpit" && <CockpitView onOpenSettings={() => setSettingsOpen(true)} />}
        {/* Worktrees and Calm are ONE mounted tree at two densities, deliberately: they render the same
            slots, and swapping trees would dispose every xterm — the replayed scrollback was drawn at
            the old width, so the TUI came back with broken linebreaks. */}
        {view !== "cockpit" && <WorktreesView onPin={pinToCockpit} calm={view === "calm"} />}
```

- [ ] **Step 4: Delete `CalmView`**

```bash
git rm src/views/CalmView.tsx
```

- [ ] **Step 5: Verify nothing still references it**

Run: `grep -rn "CalmView" src/`
Expected: no output.

- [ ] **Step 6: Verify the suite and the build**

Run: `npx vitest run && npm run build`
Expected: 310 tests passed; clean build. A `tsc` error mentioning `CalmView` means Step 3 or 4 was missed.

- [ ] **Step 7: Commit**

```bash
git add -A src/App.tsx src/views/WorktreesView.tsx src/views/WorktreesView.css src/views/CalmView.tsx
git commit -m "fix(calm): render Worktrees and Calm as one mounted tree

Switching views disposed every xterm and replayed scrollback drawn at the
old width, so Claude's TUI came back with broken linebreaks. Calm is now a
density of the same mounted columns."
```

---

### Task 4: Move Calm's suppressions from props into CSS

`WorktreeBody` currently branches on `variant` in six places. With one mount those regions can render always and be hidden by CSS, which is what lets the host and extra panes stay mounted (and their PTYs attached) while Calm shows only Claude. The one thing CSS cannot express — moving the switcher into the Claude pane header — stays as the `switcher` prop, so `variant` survives in `SlotColumn` for that single decision.

**Files:**
- Modify: `src/views/worktree-column/WorktreeBody.tsx` (drop `variant`, add a class to the copy button)
- Modify: `src/views/worktree-column/SlotColumn.tsx:137` (stop passing `variant`)
- Modify: `src/views/worktree-column/WorktreeColumn.css` (calm block: hide chips + action bar + non-first panes)
- Modify: `src/views/worktree-column/WorktreePane.css:55-57` (hide the copy button in calm)

**Interfaces:**
- Consumes: `SlotColumn`'s `calmWorktree` boolean and `switcher` node (both already exist, lines 85-94).
- Produces: `WorktreeBody({ worktree, switcher }: { worktree: Worktree; switcher?: ReactNode })` — the `variant` parameter is **gone**.

- [ ] **Step 1: Drop `variant` from `WorktreeBody`**

In `src/views/worktree-column/WorktreeBody.tsx` make these edits.

Signature and header comment:

```tsx
// `switcher` (calm density only) is the icon+dropdown unit, injected into the Claude pane header so the
// dropdown sits level with the restart button (calm has no separate column header). It is the one
// difference CSS cannot express, which is why it is a prop and the rest of calm's declutter is not.
export function WorktreeBody({ worktree, switcher }: { worktree: Worktree; switcher?: ReactNode }) {
```

`paneProps` — always route through the slice, so expand can collapse live siblings in either density (calm hides the chevron and expand buttons in CSS, and its single visible pane is already open):

```tsx
  const paneProps = (role: string) => ({
    open: isPaneOpen(paneSet, role),
    onToggle: () => toggleWorktreePane(worktree.id, role),
    onExpand: () => expandWorktreePane(worktree.id, role),
  });
```

Chips row — remove the `variant === "full" &&` wrapper, so the block reads:

```tsx
      <div className="wt-col__chips">
        {/* identity (repo/branch/dir) is behind this hover popup rather than its own row */}
        <WorktreeInfo worktree={worktree} />
        {worktreeChips(worktree, host.address).map((c, i) => (
          <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
            {c.label}
          </button>
        ))}
        {/* user links live in the same row as the derived chips, with + link at the end. */}
        <LinksList worktreeId={worktree.id} worktreePath={worktree.worktreePath} links={worktree.links} />
      </div>
```

Claude pane — `lead` takes the prop directly, and the copy button gains a class to hide by and drops its `variant` condition:

```tsx
          lead={switcher}
```

```tsx
          action={prompt ? (
            <button
              className="icon-btn wt-pane__copy" title={`copy prompt: ${prompt}`}
              onClick={() => navigator.clipboard.writeText(prompt).catch((e) => console.error("copy prompt failed", e))}
            ><CopyIcon /></button>
          ) : undefined}
```

Host pane — drop `variant === "full" &&`:

```tsx
        {paneSet.host && (
```

Extras — drop `variant === "full" &&`:

```tsx
        {paneSet.extras.map((role) => (
```

Action bar — drop the `variant === "full" &&` wrapper so `<div className="wt-col__actions">…</div>` renders unconditionally, keeping both buttons exactly as they are.

- [ ] **Step 2: Stop passing `variant` from `SlotColumn`**

In `src/views/worktree-column/SlotColumn.tsx`, line 137:

```tsx
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} variant={variant} switcher={calmWorktree ? switcher : undefined} />
```

becomes:

```tsx
        <WorktreeBody key={entity.worktree.id} worktree={entity.worktree} switcher={calmWorktree ? switcher : undefined} />
```

- [ ] **Step 3: Verify the compiler catches nothing else**

Run: `npm run build`
Expected: clean. An error about an unused `variant` or a missing prop means Step 1 or 2 is incomplete.

- [ ] **Step 4: Add the CSS suppressions**

In `src/views/worktree-column/WorktreeColumn.css`, the calm block currently ends at
`.wt-col--calm .wt-pane { width: 100%; max-width: 760px; }` (line 141). Append after it:

```css
/* The regions the full density shows and this one does not. They stay MOUNTED and are hidden — that is
   the point: the host and extra terminals keep their PTYs attached and their scrollback intact while
   Calm shows only Claude. */
.wt-col--calm .wt-col__chips,
.wt-col--calm .wt-col__actions { display: none; }
/* Claude is always the first pane in the column; host + extra shells follow it. */
.wt-col--calm .wt-pane:not(:first-child) { display: none; }
```

In `src/views/worktree-column/WorktreePane.css`, extend the existing hidden-controls group (lines 54-57) with the copy button:

```css
/* single visible pane — collapse/expand/close and the copy-prompt button are all noise here */
.wt-col--calm .wt-pane__close,
.wt-col--calm .wt-pane__expand,
.wt-col--calm .wt-pane__copy,
.wt-col--calm .wt-pane__chevron { display: none; }
```

Then force the visible pane's body open, by extending the existing rule on line 59 from:

```css
/* the terminal body is still the terminal (always-dark --term); soft radius, no border → floating */
.wt-col--calm .wt-pane__body { border-radius: var(--r); }
```

to:

```css
/* the terminal body is still the terminal (always-dark --term); soft radius, no border → floating.
   display overrides .wt-pane--closed (same specificity, later in the file): collapse state is shared
   with the full density, and this one hides the chevron — so a pane collapsed over there must not
   arrive here as a header with nothing under it and no way to reopen it. */
.wt-col--calm .wt-pane__body { border-radius: var(--r); display: block; }
```

- [ ] **Step 5: Verify the suite and the build**

Run: `npx vitest run && npm run build`
Expected: 310 tests passed; clean build.

- [ ] **Step 6: Commit**

```bash
git add src/views/worktree-column/WorktreeBody.tsx src/views/worktree-column/SlotColumn.tsx src/views/worktree-column/WorktreeColumn.css src/views/worktree-column/WorktreePane.css
git commit -m "refactor(calm): express the declutter in CSS, not a variant prop

WorktreeBody's six variant branches become CSS under .wt-col--calm. The
host and extra panes stay mounted and hidden, so their PTYs and scrollback
survive a switch into Calm."
```

---

### Task 5: Restore the focus and attention cues

Both cues colour a border that Calm removes with `border: none`, so neither can show. Give the pane a border that is transparent at rest instead — no layout shift when it lights up.

The specificity trap to avoid: `.wt-col--calm .wt-pane { border-color: transparent }` is (0,2,0), the same as `.wt-pane--focused:not(.wt-pane--attention)`, and it comes later in the file — so it would win and focus would *still* be invisible. Feeding the rest-state colour through a **component-local custom property** removes the conflict outright: the state rules set `border-color` directly on the element and the variable only feeds the base rule, so neither source order nor doubled classes matter.

**Files:**
- Modify: `src/views/worktree-column/WorktreePane.css:2-5` (base border via a variable), `:50-61` (the calm block)

**Interfaces:**
- Consumes: `--bdr`, `--accent`, `--bad`, `--bad-rgb` (existing Deep Slate tokens).
- Produces: `--pane-bdr`, a component-local custom property (not a theme token — it does not belong in `deepSlate.css`).

- [ ] **Step 1: Route the base border colour through a variable**

In `src/views/worktree-column/WorktreePane.css`, change the base rule:

```css
.wt-pane {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--surface); border: 1px solid var(--bdr); border-radius: var(--r); overflow: hidden;
}
```

to:

```css
/* --pane-bdr is the REST-state border colour, component-local (not a theme token). A density that wants
   a frameless pane overrides it rather than setting border-color, so the focus/attention rules below
   still win on their own terms — no dependence on source order or doubled selectors. */
.wt-pane {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--surface); border: 1px solid var(--pane-bdr, var(--bdr)); border-radius: var(--r); overflow: hidden;
}
```

- [ ] **Step 2: Make the calm pane frameless-at-rest instead of borderless**

In the same file, replace:

```css
/* Calm variant: no card. Drop the pane border + surface background + header divider so the
   terminal floats on the app ground; keep only the icon/title/restart (+ attention badge). */
.wt-col--calm .wt-pane { background: none; border: none; }
```

with:

```css
/* Calm variant: no card. Drop the surface background + header divider so the terminal floats on the app
   ground; keep only the icon/title/restart (+ attention badge). The border stays as a transparent 1px
   box rather than being removed, so focus and attention have something to colour and lighting it up
   shifts no layout. */
.wt-col--calm { --pane-bdr: transparent; }
.wt-col--calm .wt-pane { background: none; }
```

- [ ] **Step 3: Let attention glow in Calm**

Delete these two lines from the calm block:

```css
/* attention: keep the "Attention" text badge, drop the box glow (a glow is a frame) */
.wt-col--calm .wt-pane--attention { border: none; box-shadow: none; }
```

The earlier "a glow is a frame" decision is deliberately reversed: a cue the user cannot see is worse than
a frame, and Calm is where an unattended Claude pane is most likely to be sitting.

- [ ] **Step 4: Verify the suite and the build**

Run: `npx vitest run && npm run build`
Expected: 310 tests passed; clean build.

- [ ] **Step 5: Commit**

```bash
git add src/views/worktree-column/WorktreePane.css
git commit -m "fix(calm): show the focus and attention highlights

Calm removed the pane border the two cues colour. It now keeps a
transparent 1px box via --pane-bdr, so both show with no layout shift."
```

---

### Task 6: GUI acceptance smoke

Nothing in Tasks 1-5 is unit-testable beyond `shouldFit` — the rest is React effects, IPC ordering and CSS. **This task is the acceptance gate and needs the human at the keyboard**; the agent's job is to get the app running and hand over the checklist.

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Confirm the automated baseline first**

Run: `npx vitest run && npm run build`
Expected: 310 tests passed in 34 files; clean `tsc && vite build`. Do not proceed on a red suite.

- [ ] **Step 2: Launch the app**

Run: `npm run tauri dev`

Note: the agent cannot see the native window (no Screen Recording permission), so every item below is a
human observation. Assign at least two worktrees to Worktrees-view columns before starting, with Claude
running in each.

- [ ] **Step 3: Walk the checklist**

1. Claude running in a Worktrees column → switch to Calm → **the TUI repaints at the new width**, no
   broken linebreaks or misplaced boxes; switch back → repaints again.
2. Repeat with 2 and 3 assigned columns, and with the window resized between switches.
3. Click into a Calm terminal → **quiet blue border** (`--accent`); click away → it goes.
4. Let a Claude pane bell in Calm → **warm-red border + glow + the `Attention` badge**; type a reply →
   all three clear.
5. Bell while on Worktrees, then switch to Calm → the highlight is **still there** (store state survives,
   and now so does the mount).
6. On Worktrees: `▶ Run` a dev server and `+ Add` an extra terminal → switch to Calm (**neither is
   visible, only Claude**) → switch back → **both are still alive with their scrollback intact**.
7. Pinned worktree: Cockpit ↔ Worktrees → the terminal repaints correctly. (This exercises Task 2 alone,
   on a path that still remounts.)
8. Calm with a single assigned column → the terminal is centred and width-capped as before, and the `+`
   rail and swap buttons are absent.
9. Calm over a **scratch** terminal and over a **pending** (spinner) tile → both render as before.
10. On Worktrees, collapse the Claude pane with its chevron → switch to Calm → **the terminal is still
    shown** (not a bare header), because collapse state is shared between the densities.

- [ ] **Step 4: Record the outcome**

If every item passes, note it in the plan's Status line and stop — integration is the user's call
(`superpowers:finishing-a-development-branch`). If any item fails, do **not** patch blindly: use
`superpowers:systematic-debugging`, and treat item 1 or 6 failing as a sign the mount is still being torn
down (check `App.tsx` renders `<WorktreesView>` at the same child position for both views).

---

## Status

Not started.

## Deferred

Recorded so they are not silently lost:

- **Decoupling Calm's slot selection** — spec §Out of scope. Calm keeps sharing `slots`.
- **Keeping the Cockpit view mounted too** — Task 2 already covers its remount; merging it would hold
  every tile and terminal live at once.
- **The animated background** — the iteration this gardening was clearing the way for.
- **Registering the resize-on-attach ordering in a test** — needs a React + xterm harness the repo does
  not have. Currently guarded only by the comment in `useTerminal.ts` and smoke item 7.
