# Worktree Info Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible worktree details row (repo · branch · worktree dir) with a circled ⓘ button at the head of the chips row that reveals those three values in a hover popup.

**Architecture:** One new presentational component (`WorktreeInfo`) rendered as the first child of `.wt-col__chips`, plus CSS. The popup is revealed by a pure CSS `:hover` / `:focus-within` rule on the wrapper — no React state, no store slice, no document listener (unlike the click-toggled gear menu). Two new inline-SVG glyphs join `views/icons.tsx`; the branch and tree glyphs reuse the existing masked-image `.wt-ico` family.

**Tech Stack:** React 19 + TypeScript (Vite), plain CSS over the Deep Slate design tokens. Vitest for the existing suite. No new dependencies. No Rust changes.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-29-worktree-info-button-design.md` — the authority for anything this plan leaves implicit.
- **Comment conventions (CLAUDE.md):** every new file gets a one-line top comment stating its role; every non-obvious block gets a one-line why. Keep comments short and high-signal.
- **Smallest thing that works:** no new dependencies, no new abstractions, no visual polish beyond what the spec states.
- **Colour literals are banned outside the allowed sites** — every colour must come from a token (`--surface`, `--bdr`, `--tx-3`, `--menu-shadow`, `--r`, `--r-sm`, `--mono`, `--fs-xs`, `--fs-2xl`, `--space-1`).
- **Three values, this order:** repo basename (folder glyph), `worktree.branch` (branch glyph), worktree-dir basename (tree glyph) — identical to the row being deleted.
- **No new unit tests.** The repo's vitest suite is pure-logic only (no jsdom, no testing-library anywhere in `package.json`), and this change introduces no pure logic. The gate is `npx tsc --noEmit` + `npx vitest run` + `npm run build` staying green, then human eyeball.
- **Verification commands** (run from the repo root, `/Users/victormasson/CockpitWorktrees/cockpit/info-button`):
  - `npx tsc --noEmit` → no output
  - `npx vitest run` → all tests pass
  - `npm run build` → exits 0 (it runs `tsc && vite build`)

---

### Task 1: The two new glyphs + the `.wt-ico--tree` mask

Adds the vocabulary Task 2 consumes: a circled-i trigger glyph, a folder glyph for the repo row, and
the missing `.wt-ico` variant for tree.svg (currently tree.svg is masked only through
`.wt-col__icon--tree`, which is hard-sized to 16.8px for the column header).

**Files:**
- Modify: `src/views/icons.tsx` (append two exports at the end of the file, after `PinIcon`)
- Modify: `src/views/worktree-column/WorktreePane.css:41` (add one rule after `.wt-ico--terminal`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `InfoIcon(): JSX.Element` and `FolderIcon(): JSX.Element`, exported from `src/views/icons.tsx`. Both are argument-less like every other icon there, sized `1em` via the shared `base` object, and tinted by the parent's `color` (`stroke: currentColor`).
  - CSS class `.wt-ico--tree`, usable as `<span className="wt-ico wt-ico--tree" aria-hidden />`.

- [ ] **Step 1: Append `InfoIcon` and `FolderIcon` to `src/views/icons.tsx`**

Add at the end of the file (after `PinIcon`). Both reuse the module's existing `base` spread and
`viewBox="0 0 16 16"`, matching every 16-box icon in the file.

```tsx
// Info: circled "i" — the trigger that reveals a worktree's repo/branch/dir rows on hover.
// The dot is a 0.4-long segment rather than a circle: with base's round linecap it renders as a
// clean 2px dot at any size, where a tiny stroked circle reads as a ring.
export function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v4" />
      <path d="M8 4.9v.4" />
    </svg>
  );
}

// Folder: the repo row's glyph in the Info popup — drawn inline because there is no folder image
// asset to mask the way branch/tree are.
export function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M2.2 5A1.5 1.5 0 0 1 3.7 3.5h1.9l1.4 1.8h5.3A1.5 1.5 0 0 1 13.8 6.8v4.7A1.5 1.5 0 0 1 12.3 13h-8.6A1.5 1.5 0 0 1 2.2 11.5z" />
    </svg>
  );
}
```

- [ ] **Step 2: Add the `.wt-ico--tree` mask rule**

In `src/views/worktree-column/WorktreePane.css`, immediately after the `.wt-ico--terminal` line
(currently line 41), matching its siblings exactly:

```css
.wt-ico--tree { -webkit-mask-image: url("../../assets/icons/tree.svg"); mask-image: url("../../assets/icons/tree.svg"); }
```

- [ ] **Step 3: Verify the typecheck and existing suite are still green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` prints nothing; vitest reports all tests passing (the suite is untouched by this task,
so any failure here means something unrelated broke).

- [ ] **Step 4: Commit**

```bash
git add src/views/icons.tsx src/views/worktree-column/WorktreePane.css
git commit -m "feat: add Info + Folder glyphs and the wt-ico tree mask"
```

---

### Task 2: `WorktreeInfo` component, its CSS, and removal of the details row

The feature itself: render the ⓘ at the head of the chips row and delete the row it replaces.

**Files:**
- Create: `src/views/worktree-column/WorktreeInfo.tsx`
- Modify: `src/views/worktree-column/WorktreeColumn.css:77` (replace the `.wt-col__path` rule with the `.wt-info*` block)
- Modify: `src/views/worktree-column/WorktreeBody.tsx:59-74` (add the import + the `<WorktreeInfo>` element; delete the `.wt-col__path` div)

**Interfaces:**
- Consumes: `InfoIcon`, `FolderIcon` from `../icons` and the `.wt-ico--tree` class, both from Task 1. `Worktree` from `../../settings/types` (fields used: `repoPath`, `branch`, `worktreePath` — all `string`).
- Produces: `WorktreeInfo({ worktree }: { worktree: Worktree })`, exported from `src/views/worktree-column/WorktreeInfo.tsx`.

- [ ] **Step 1: Create `src/views/worktree-column/WorktreeInfo.tsx`**

The two basename expressions are moved verbatim from the row being deleted, so the popup shows
exactly the same strings it did.

```tsx
// WorktreeInfo.tsx — the circled ⓘ at the head of a worktree's chips row: hovering it reveals the
// worktree's repo / branch / directory on three rows (previously an always-visible details row).
import type { Worktree } from "../../settings/types";
import { InfoIcon, FolderIcon } from "../icons";

// Reveal is CSS-only (`.wt-info:hover`/`:focus-within` in WorktreeColumn.css) — hover needs no state,
// so there is nothing to toggle, close, or clean up. The trigger is a real <button> purely so
// :focus-within opens the popup when it is reached by keyboard.
export function WorktreeInfo({ worktree }: { worktree: Worktree }) {
  return (
    <span className="wt-info">
      <button type="button" className="wt-info__btn" aria-label="worktree details"><InfoIcon /></button>
      <div className="wt-info__pop">
        <span className="wt-info__row"><FolderIcon />{worktree.repoPath.split("/").pop()}</span>
        <span className="wt-info__row"><span className="wt-ico wt-ico--branch" aria-hidden />{worktree.branch}</span>
        <span className="wt-info__row"><span className="wt-ico wt-ico--tree" aria-hidden />{worktree.worktreePath.split("/").pop()}</span>
      </div>
    </span>
  );
}
```

- [ ] **Step 2: Replace the `.wt-col__path` rule in `src/views/worktree-column/WorktreeColumn.css`**

Delete this line (currently line 77):

```css
.wt-col__path { padding: 0 var(--space-3) var(--space-2); color: var(--tx-3); font-family: var(--mono); font-size: var(--fs-xs); }
```

and put this block in its place (it sits between the `.wt-chip--note` rules above and
`.wt-col__panes` below):

```css
/* ⓘ at the head of the chips row: hover (or keyboard focus) reveals the worktree's identity rows.
   CSS-only — no state to toggle, and the popup is a descendant of the hovered wrapper, so moving
   the pointer onto it never breaks :hover. */
.wt-info { position: relative; display: inline-flex; align-self: center; }
/* reset the global button baseline (bg-3 fill, border, 6px 12px padding) so the trigger hugs the
   row's leading edge; the hover tint it keeps from that baseline is deliberate. */
.wt-info__btn {
  display: inline-flex; align-items: center; line-height: 1;
  background: none; border: none; padding: 1px 3px;
  color: var(--tx-3); cursor: help; font-size: var(--fs-2xl);
}
.wt-info:hover .wt-info__btn { color: var(--tx); }
/* same floating-popover family as the gear menu and the Dropdown list */
.wt-info__pop {
  display: none; position: absolute; top: 100%; left: 0; z-index: 10; margin-top: 4px;
  background: var(--surface); border: 1px solid var(--bdr); border-radius: var(--r);
  box-shadow: var(--menu-shadow); padding: var(--space-1); gap: 2px; white-space: nowrap;
}
.wt-info:hover .wt-info__pop,
.wt-info:focus-within .wt-info__pop { display: flex; flex-direction: column; }
/* identical type to the details row this replaced: mono, --fs-xs, --tx-3 */
.wt-info__row {
  display: flex; align-items: center; gap: 6px; padding: 2px 6px;
  color: var(--tx-3); font-family: var(--mono); font-size: var(--fs-xs);
}
/* shrink the shared masked glyphs (15.6px by default) to sit level with --fs-xs text, and match its tint */
.wt-info__row .wt-ico { width: 12px; height: 12px; background: var(--tx-3); }
.wt-info__row svg { width: 12px; height: 12px; flex: 0 0 auto; }
```

- [ ] **Step 3: Wire it into `WorktreeBody.tsx` and delete the details row**

Add the import next to the sibling component imports (after the `WorktreePane` import on line 8):

```tsx
import { WorktreeInfo } from "./WorktreeInfo";
```

Then replace the whole `variant === "full"` fragment (lines 59-74 — the `.wt-col__chips` div plus
the `.wt-col__path` div it is grouped with) with just the chips row, `<WorktreeInfo>` first:

```tsx
      {variant === "full" && (
        <div className="wt-col__chips">
          {/* identity (repo/branch/dir) is behind this hover popup rather than its own row */}
          <WorktreeInfo worktree={worktree} />
          {worktreeChips(worktree).map((c, i) => (
            <button key={i} className={`wt-chip wt-chip--${c.kind}`} disabled={!c.url} onClick={() => c.url && openUrl(c.url)}>
              {c.label}
            </button>
          ))}
          {/* user links live in the same row as the derived chips, with + link at the end. */}
          <LinksList worktreeId={worktree.id} worktreePath={worktree.worktreePath} links={worktree.links} />
        </div>
      )}
```

Note the enclosing `<>…</>` fragment is no longer needed — a single child follows the `&&`.

- [ ] **Step 4: Confirm no reference to `wt-col__path` survives in source**

Run: `grep -rn "wt-col__path" src/`
Expected: no output. (The remaining repo-wide hits live in `docs/superpowers/plans/` — historical
plan documents, which must stay untouched.)

- [ ] **Step 5: Verify typecheck, tests, and build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: `tsc` prints nothing; every vitest test passes; `vite build` completes and the command
exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/views/worktree-column/WorktreeInfo.tsx src/views/worktree-column/WorktreeColumn.css src/views/worktree-column/WorktreeBody.tsx
git commit -m "feat: hide worktree details behind a hover Info button"
```

---

## Human verification (after Task 2)

Automated checks cannot see the window, so these need a human on the running app (`npm run tauri dev`,
Worktrees view, a slot holding a worktree):

1. The circled ⓘ is the leftmost element of the top row, before the Linear/PR/localhost chips.
2. The old `repo · branch · dir` line under that row is gone, and the terminal panes moved up to fill the space.
3. Hovering the ⓘ pops up three rows — folder + repo name, branch glyph + branch name, tree glyph + worktree dir name — in mono at the same size/colour the old row used.
4. Moving the pointer from the ⓘ down onto the popup keeps it open; moving away closes it.
5. The popup floats over the chips row and the pane below without pushing anything, and does not spill past the column's left edge.
6. Calm view and scratch/pending slots look unchanged (they never had the details row).

## Notes for the implementer

- `Worktree.name` is NOT one of the three values — the spec's trio is repo, branch, and the worktree
  *directory* basename. The name is already visible in the column heading above.
- Do not reuse `.icon-btn` for the trigger: its `padding: 6px 12px` would shove the whole chips row
  right. That is why `.wt-info__btn` sets its own tight padding.
- `.wt-info__btn` at (0,1,0) out-specifies the bare `button` baseline at (0,0,1), so the `background`/
  `border`/`padding` resets land. Do not weaken it to a bare element selector.
