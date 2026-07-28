# Focused-Pane Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the terminal pane that currently has keyboard focus a discreet accent-coloured border, so you can see which of the many live terminals in the Worktrees view your keystrokes will land in.

**Architecture:** Purely presentational and entirely local to `WorktreePane`. A `useState` boolean tracks whether focus is inside the pane's terminal body; native `focusin`/`focusout` listeners on the container div (the same div `useTerminal` mounts xterm into) flip it. The boolean adds a `wt-pane--focused` class, and one CSS rule swaps `border-color` from `--bdr` to `--accent`. No store slice, no `useTerminal` change, no Rust, no persistence.

**Tech Stack:** React 19 + TypeScript, xterm.js v6, plain CSS over the Deep Slate token contract, Vitest.

## Global Constraints

- **Discretion is the point.** The focused state must be **only** a `border-color` swap: no glow, no `box-shadow`, no border-width change, no padding/layout shift. The loud treatment (warm-red border + glow + "Attention" badge) belongs to the bell-driven attention state and must not be diluted.
- **Colour comes from the token `var(--accent)`** (steel blue, `#7CACE0` in `src/theme/deepSlate.css`). Never a literal colour — literal colours are allowed only at the sites listed in `CLAUDE.md`, and this is not one of them.
- **Attention wins over focus.** `.wt-pane--focused` must be declared **above** `.wt-pane--attention` in `WorktreePane.css` so the later, equal-specificity attention rule overrides it.
- **Strict focus semantics.** The border reverts the moment focus leaves the terminal body. Do not add sticky/last-focused behaviour, and do not track window activation.
- **Scope focus to the terminal body**, i.e. the `containerRef` div (`.wt-pane__body`) — not the whole `.wt-pane` card. Clicking a header button must not light the pane.
- **`src/worktrees/useTerminal.ts` must not be modified.**
- **Comment conventions** (`CLAUDE.md`): keep the file's top-line role comment accurate, and add a concise one-line explanation above the non-obvious block (why native listeners, why body-scoped).
- Two files only: `src/views/worktree-column/WorktreePane.tsx`, `src/views/worktree-column/WorktreePane.css`.

**Spec:** `docs/superpowers/specs/2026-07-28-focused-pane-highlight-design.md`

---

### Task 1: Focused-pane border in `WorktreePane`

Both files change together for one indivisible deliverable (a class with no rule, or a rule with no class, is not reviewable on its own), so this is a single task. There is no new pure logic, therefore no new unit test — the project's convention is to unit-test pure helpers (`paneSet.ts`, `chips.ts`, `diffLines.ts`), and a DOM-focus → CSS-class binding has no such seam. Verification is the existing suites staying green plus a GUI eyeball.

**Files:**
- Modify: `src/views/worktree-column/WorktreePane.tsx` (imports on line 2; component body around lines 26–35)
- Modify: `src/views/worktree-column/WorktreePane.css` (insert before the `.wt-pane--attention` rule at lines 10–15)

**Interfaces:**
- Consumes: `useTerminal(args)` returns `{ containerRef, restart, close }` where `containerRef` is a `RefObject<HTMLDivElement | null>` already spread onto `.wt-pane__body`. Existing pane classes: `wt-pane`, `wt-pane--open`, `wt-pane--closed`, `wt-pane--attention`.
- Produces: a new CSS class `wt-pane--focused` on the `.wt-pane` root. Nothing else consumes it — no exported symbols change, so no other file needs updating.

- [ ] **Step 1: Record the pre-change baseline**

The deliverable is visual, so the guard rail is "nothing else broke". Capture the green baseline before touching anything.

Run:
```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass. Note the exact test count (it should be around 149–160 depending on recent work) — the same count must pass at the end, with no new tests added by this task.

- [ ] **Step 2: Add the focus state and listeners to `WorktreePane.tsx`**

Change the import on line 2 from:

```tsx
import { useState, type ReactNode } from "react";
```

to:

```tsx
import { useEffect, useState, type ReactNode } from "react";
```

Then, immediately after this existing line in the component body (line 27):

```tsx
  const { containerRef, restart, close } = useTerminal(args);
```

insert:

```tsx
  // "Keystrokes land here": true while focus is inside this pane's terminal body. Local state, not
  // the store — unlike attention (a bell in a background pane is read by SlotColumn), focus has no
  // remote consumer and the DOM already guarantees at most one focused pane.
  const [focused, setFocused] = useState(false);
  // Native focusin/focusout on the terminal container: the focus target is xterm's helper textarea,
  // created imperatively inside this div rather than by React. Scoped to the body, not the card, so
  // clicking a header button doesn't light the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onIn = () => setFocused(true);
    const onOut = () => setFocused(false);
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
    };
  }, [containerRef]);
```

- [ ] **Step 3: Add the class to the pane root**

Replace the existing root `div` opening tag (line 35):

```tsx
    <div className={`wt-pane ${open ? "wt-pane--open" : "wt-pane--closed"}${needsAttention ? " wt-pane--attention" : ""}`}>
```

with:

```tsx
    <div className={`wt-pane ${open ? "wt-pane--open" : "wt-pane--closed"}${focused ? " wt-pane--focused" : ""}${needsAttention ? " wt-pane--attention" : ""}`}>
```

Order note: the class *string* order is irrelevant to CSS precedence (the stylesheet rule order decides that, handled in Step 4) — `--focused` is placed before `--attention` here only to read in the same order as the CSS.

Dependency note for the effect in Step 2: `[containerRef]` is a stable ref object, so the effect runs once on mount and cleans up on unmount. Do **not** write `[containerRef.current]` — reading `.current` in a dependency array does not re-run the effect when the ref is populated and is a lint error waiting to happen. `containerRef.current` is already set by the time effects run, because `useTerminal`'s own mount effect calls `term.open(containerRef.current!)`; React attaches refs before running effects.

- [ ] **Step 4: Add the CSS rule above the attention rule**

In `src/views/worktree-column/WorktreePane.css`, find this existing block (lines 10–15):

```css
/* needs-attention: warm reddish border + glow (a Claude/scratch pane waiting for you). */
.wt-pane--attention {
  border-color: var(--bad);
  box-shadow: 0 0 0 1px var(--bad),
              0 0 24px 5px rgba(var(--bad-rgb), 0.45);
}
```

Insert **immediately above** it:

```css
/* focused: the pane whose terminal has keyboard focus — border-colour only, deliberately quiet so it
   can't be mistaken for attention below (which, being later at equal specificity, wins when both apply). */
.wt-pane--focused { border-color: var(--accent); }
```

Do not add anything else to this rule. No `box-shadow`, no `border-width`, no `outline`.

- [ ] **Step 5: Verify types and build**

Run:
```bash
npx tsc --noEmit && npm run build 2>&1 | tail -5
```
Expected: no TypeScript errors; Vite build succeeds. A failure here is almost certainly the missing `useEffect` import from Step 2.

- [ ] **Step 6: Verify the test suite is unchanged and green**

Run:
```bash
npx vitest run 2>&1 | tail -5
```
Expected: PASS, with the **same test count** as the Step 1 baseline. This task adds no tests by design; a changed count means something unintended was touched.

- [ ] **Step 7: Commit**

```bash
git add src/views/worktree-column/WorktreePane.tsx src/views/worktree-column/WorktreePane.css
git commit -m "$(cat <<'EOF'
feat: line the focused terminal pane with an accent border

Discreet border-colour swap (--bdr -> --accent) on the pane whose terminal
holds keyboard focus, so it's obvious which of the many live terminals will
receive keystrokes. Local state + native focusin/focusout on the terminal
container; attention (warm-red) still wins when both apply.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: GUI acceptance (human eyeball — the native macOS window cannot be driven headlessly)**

Start the app with `npm run tauri dev`, go to the Worktrees view, and confirm each of these:

1. **Moves between panes in one column.** Assign a worktree to a slot, press `▶ Run` or `+ Add` so the column has two panes. Click into the Claude terminal → its border turns steel blue. Click into the second terminal → the blue moves; the Claude pane returns to the default grey border. Exactly one pane is lined.
2. **Moves across columns.** With two columns assigned, click a terminal in each in turn → the line follows, never two at once.
3. **Header buttons don't light the pane.** Click a pane's chevron (collapse) then expand it again, and click the gear in the column header. Neither should, by itself, put a blue border on a pane.
4. **Attention still wins.** With a Claude pane showing the red "Attention" badge and glow, click into that terminal. It must stay warm-red with its glow until you type (typing clears attention, at which point it may show the blue focus line). It must never show a blue border while the badge is up.
5. **Discretion check.** The focused pane must look identical to an unfocused one apart from the border colour — no glow, no size change, no jump when focus moves.
6. **Calm view is unaffected.** Switch to the Calm view and click into its terminal → no border appears (that variant sets `border: none` on the pane).

Record the result in the commit trailer or a follow-up note; do not claim GUI acceptance without having actually looked.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a step:

| Spec requirement | Where |
|---|---|
| `--bdr` → `--accent`, nothing else | Task 1 Step 4 + Global Constraints |
| Strict clear on focus loss | Step 2 (`focusout` → `setFocused(false)`) |
| At most one lined pane | Guaranteed by DOM focus; verified Step 8.1–8.2 |
| Body-scoped, not card-scoped | Step 2 (listeners on `containerRef`); verified Step 8.3 |
| Attention wins | Step 4 rule order; verified Step 8.4 |
| Local state, not the store | Step 2 |
| `useTerminal.ts` untouched | Global Constraints; the plan never opens it |
| Applies to Worktrees / Cockpit / no-op in Calm | Follows from placing it in `WorktreePane`; Calm verified Step 8.6 |
| No new unit tests; suites stay green | Steps 1, 5, 6 |
| Two files, no Rust, no persistence | Files block |

No gaps.

**2. Placeholder scan** — no "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step shows the exact before/after text and the exact command with its expected outcome.

**3. Type consistency** — the only new identifiers are the local `focused` / `setFocused` (Steps 2–3) and the CSS class `wt-pane--focused` (Steps 3–4); both spellings match across steps. `containerRef` matches `useTerminal`'s actual return shape as read from `src/worktrees/useTerminal.ts:195`. No exported API changes, so no other file can drift.

One nit found and fixed inline: the import step originally added `useRef`, which the effect never calls — dropped, so only `useEffect` is added.
