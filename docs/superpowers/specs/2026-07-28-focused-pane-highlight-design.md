# Focused-pane highlight — design

**Date:** 2026-07-28
**Status:** approved, ready to plan

## Problem

The Worktrees view shows up to three columns, each holding one to four live terminal
panes (Claude + an optional localhost pane + up to two extra shells). Nothing tells you
which of those terminals your keystrokes will land in. With six or more panes on screen
you type into the wrong one.

## Requirement

Mark the terminal pane that currently has keyboard focus. The marker must be **discreet**
— the loud treatment (warm-red border + glow + "Attention" badge) already belongs to the
bell-driven attention state, and a second loud highlight would dilute it.

## Behaviour

- Keyboard focus inside a pane's terminal body → that pane's **existing 1px border changes
  colour from `--bdr` to `--accent`**. No glow, no ring, no border-width change, no layout
  shift.
- Focus leaves the terminal → the border reverts immediately (strict semantics: the line
  means "focus is here *now*", not "was here last").
- At most one pane is lined, guaranteed by the browser: at most one DOM element holds focus.
- Focus is scoped to the **terminal body**, not the whole pane card. Clicking a header
  button (restart / close / expand / chevron) does not light the pane, because keystrokes
  would not go to the terminal.

### Precedence with Attention

Attention wins. Both states set `border-color` on `.wt-pane`, so `.wt-pane--focused` is
declared **above** `.wt-pane--attention` in `WorktreePane.css`; equal specificity means the
later rule wins and a belled pane stays warm-red even while focused. The overlap is short
lived anyway — typing into a pane clears its attention flag (`useTerminal`'s `onData`).

### App-switch caveat

Whether the line survives Cmd-Tabbing away depends on whether WebKit fires element
`focusout` on window deactivation. We follow DOM focus semantics rather than fighting them:
either outcome still accurately reports where keystrokes would land, and the alternative
(tracking window activation separately) is not worth the code.

## Architecture

**State is local to `WorktreePane` (`useState`) — deliberately not the store.**

The attention highlight needs the session-only `attention` store slice because a bell in a
*background* pane must be observable elsewhere (`SlotColumn` tints the column icon from it).
Focus has no such remote consumer: it is strictly "here, now", the browser already tracks it,
and only the pane itself renders it. Adding a store slice would mean coordinating a
single-writer invariant that the DOM gives us for free.

**Wiring.** `WorktreePane` already receives `containerRef` from `useTerminal`. A small
`useEffect` attaches native `focusin` / `focusout` listeners to that container div; they
fire for xterm's helper textarea mounted inside it. Native listeners (not React's
`onFocus`/`onBlur`) because the focus target is DOM created imperatively by xterm rather
than by React.

`useTerminal.ts` is **untouched** — no new hook return value, no change to the terminal
lifecycle.

## Scope of effect

The change lives in `WorktreePane`, so it applies wherever panes render:

| Surface | Effect |
|---------|--------|
| Worktrees view | the feature — one accent line across all columns |
| Cockpit right column | same behaviour, free |
| Calm view | visual no-op: `.wt-col--calm .wt-pane` already sets `border: none` |

No gating prop is needed.

## Files

- `src/views/worktree-column/WorktreePane.tsx` — focus state + `focusin`/`focusout` effect
  + `wt-pane--focused` class (~6 lines).
- `src/views/worktree-column/WorktreePane.css` — one `.wt-pane--focused` rule placed above
  `.wt-pane--attention` (~3 lines).

No Rust changes. No store changes. No persistence — focus is inherently transient.

## Testing

No new pure logic, so no new unit tests: a focus → CSS-class binding has no headlessly
testable seam, and the project's test convention is to unit-test pure helpers.

Verification:

1. `npx vitest run` and `npx tsc --noEmit` + `npm run build` stay green (no regressions).
2. GUI eyeball:
   - click between two panes in one column → exactly one accent line, it moves;
   - click a pane in a different column → the line moves across columns;
   - click a pane header button → no line appears from that alone;
   - a pane showing "Attention" stays warm-red while focused;
   - Calm view shows no border change.

## Rejected alternatives

- **Highlight the whole column** instead of the pane — tells you which worktree, not which
  terminal; the ambiguity being fixed is between panes.
- **Dim the unfocused panes** — strongest signal, but it darkens terminals you are still
  reading.
- **Accent header bar** — heavier than a border-colour swap for the same information.
- **Sticky last-focused pane** — considered and rejected: a line that persists when nothing
  is focused overstates what it knows.
