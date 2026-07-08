# Themed Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's 3 native `<select>`s with one shared themed `Dropdown` component (trigger + styled popover), since macOS renders the native popup list and CSS can't touch it.

**Architecture:** A pure module `src/views/dropdown.ts` holds the option/group types and the tested `selectedLabel` helper; `src/views/Dropdown.tsx` renders a trigger `<button>` + absolutely-positioned popover listbox (same pattern as the existing gear-menu popover); `src/views/Dropdown.css` styles both trigger variants (`heading` for the slot picker, `form` for the Checkout form) with theme tokens only. Call sites: `SlotColumn.tsx` (1) and `ExistingBranchForm.tsx` (2).

**Tech Stack:** React 19 + TS, Vitest (node env — pure-function tests only), CSS design tokens (Deep Slate theme contract).

## Global Constraints

- No new dependencies (CLAUDE.md: lean & native; no dropdown library, no portal).
- No literal colours outside `deepSlate.css` (theme rule) — the popover shadow becomes a new `--menu-shadow` token there, in the "additions beyond the spec token list" block.
- Every file gets a one-line role comment at the top; non-obvious blocks get one-line intent comments (CLAUDE.md convention).
- Font sizes use `--fs-*` tokens (they carry the Cmd+/- zoom multiplier); layout values stay px/`--space-*`.
- Arrow-key/typeahead navigation and ARIA-complete listbox semantics are **out of scope** (deferred per spec).
- Verification commands: `npx vitest run` and `npm run build` (no Rust changes in this plan).

---

### Task 1: pure `dropdown.ts` — types + `selectedLabel`

**Files:**
- Create: `src/views/dropdown.ts`
- Test: `src/views/dropdown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type DropdownOption = { value: string; label: string; hint?: string; disabled?: boolean }`, `type DropdownGroup = { label?: string; options: DropdownOption[] }`, `function selectedLabel(groups: DropdownGroup[], value: string | null, placeholder: string): string` — Task 2's component and Tasks 3–4's call sites import these from `./dropdown` / `../dropdown`.

- [ ] **Step 1: Write the failing test**

Create `src/views/dropdown.test.ts`:

```ts
// dropdown.test.ts — trigger-label resolution for the themed Dropdown.
import { describe, it, expect } from "vitest";
import { selectedLabel, type DropdownGroup } from "./dropdown";

const groups: DropdownGroup[] = [
  { options: [{ value: "", label: "Select…" }] },
  { label: "Worktrees", options: [
    { value: "wt-1", label: "fix-login · cockpit" },
    { value: "pending-1", label: "deducing…", disabled: true },
  ]},
  { label: "Scratch", options: [{ value: "scratch-1", label: "Terminal 1" }] },
];

describe("selectedLabel", () => {
  it("null value falls back to the placeholder", () => {
    expect(selectedLabel(groups, null, "Select…")).toBe("Select…");
  });
  it("unmatched value falls back to the placeholder", () => {
    expect(selectedLabel(groups, "gone", "Select…")).toBe("Select…");
  });
  it("finds a label inside a named group", () => {
    expect(selectedLabel(groups, "scratch-1", "Select…")).toBe("Terminal 1");
  });
  it("a disabled option's label still shows on the trigger (pending tiles)", () => {
    expect(selectedLabel(groups, "pending-1", "Select…")).toBe("deducing…");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/dropdown.test.ts`
Expected: FAIL — cannot resolve `./dropdown`.

- [ ] **Step 3: Write minimal implementation**

Create `src/views/dropdown.ts`:

```ts
// dropdown.ts — pure types + trigger-label resolution for the themed Dropdown component.
export type DropdownOption = { value: string; label: string; hint?: string; disabled?: boolean };
export type DropdownGroup = { label?: string; options: DropdownOption[] };

// The trigger shows the selected option's label; a null/unmatched value falls back to the placeholder.
export function selectedLabel(groups: DropdownGroup[], value: string | null, placeholder: string): string {
  if (value === null) return placeholder;
  for (const g of groups) {
    const hit = g.options.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return placeholder;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/dropdown.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/dropdown.ts src/views/dropdown.test.ts
git commit -m "feat(dropdown): pure option types + selectedLabel helper"
```

---

### Task 2: `Dropdown` component + CSS + `--menu-shadow` token + `TickIcon`

**Files:**
- Create: `src/views/Dropdown.tsx`
- Create: `src/views/Dropdown.css`
- Modify: `src/views/icons.tsx` (append `TickIcon`)
- Modify: `src/theme/deepSlate.css:43-45` (add `--menu-shadow` to the additions block)

**Interfaces:**
- Consumes: `selectedLabel`, `DropdownGroup` from `./dropdown`; `ChevronIcon` (existing, takes `{ open: boolean }`) and new `TickIcon` from `./icons`.
- Produces: `function Dropdown(props: { value: string | null; onChange: (value: string) => void; groups: DropdownGroup[]; placeholder: string; variant: "heading" | "form" })` — Tasks 3–4 render it.

No unit test (component + CSS; vitest runs in node env, no DOM) — verified by `npm run build` here and by the GUI pass at the end.

- [ ] **Step 1: Add `TickIcon` to `src/views/icons.tsx`**

Append at the end of the file:

```tsx
// Tick: selected-row marker in the themed Dropdown popover.
export function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Add the shadow token to `src/theme/deepSlate.css`**

In the `/* additions beyond the spec token list: */` block (after `--bad-rgb`), add:

```css
  --menu-shadow: 0 8px 24px rgba(0,0,0,.35); /* floating popovers (dropdown, gear menu) */
```

- [ ] **Step 3: Create `src/views/Dropdown.tsx`**

```tsx
// Dropdown.tsx — themed <select> replacement: trigger button + popover listbox (macOS renders the native popup; CSS can't style it).
import { useEffect, useRef, useState } from "react";
import { selectedLabel, type DropdownGroup } from "./dropdown";
import { ChevronIcon, TickIcon } from "./icons";
import "./Dropdown.css";

export function Dropdown({ value, onChange, groups, placeholder, variant }: {
  value: string | null;
  onChange: (value: string) => void;
  groups: DropdownGroup[];
  placeholder: string;
  variant: "heading" | "form";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click — listener only lives while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Escape closes the popover; stopPropagation keeps a host modal's own Escape handler from also firing.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className={`dd dd--${variant}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" className="dd__trigger" onClick={() => setOpen((o) => !o)}>
        <span className="dd__label">{selectedLabel(groups, value, placeholder)}</span>
        <span className="dd__chevron" aria-hidden><ChevronIcon open /></span>
      </button>
      {open && (
        <div className="dd__pop" role="listbox">
          {groups.map((g, i) => (
            <div key={g.label ?? i}>
              {g.label && <div className="dd__group">{g.label}</div>}
              {g.options.map((o) => (
                <button
                  type="button" key={o.value} role="option" disabled={o.disabled}
                  aria-selected={o.value === value}
                  className={`dd__opt${o.value === value ? " dd__opt--selected" : ""}`}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                >
                  <span className="dd__opt-label">{o.label}</span>
                  {o.hint && <span className="dd__opt-hint">{o.hint}</span>}
                  {o.value === value && <span className="dd__tick"><TickIcon /></span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/views/Dropdown.css`**

Selector note: rows and trigger are `button`s, so the global `button` baseline (tokens.css) and the Checkout form's `.eb-form button` rule (both give a boxed `--bg-3` look) would hit them. The `.dd button.dd__*` shape (0,2,1) out-specifies both — keep that pattern for every button rule here.

```css
/* Dropdown.css — themed select replacement: heading|form trigger variants + floating popover listbox. */
.dd { position: relative; min-width: 0; }

/* trigger skeleton — variants below set the box */
.dd button.dd__trigger {
  display: inline-flex; align-items: center; gap: 6px;
  min-width: 0; max-width: 100%; cursor: pointer; text-align: left;
  font-family: var(--ui);
}
.dd__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd__chevron { display: inline-flex; color: var(--tx-3); flex: 0 0 auto; font-size: 14px; }

/* heading variant — the slot column's bold title-as-picker look */
.dd--heading { flex: 0 1 auto; }
.dd--heading button.dd__trigger {
  background: none; border: none; padding: 0 2px;
  color: var(--tx-hi); font-size: var(--fs-xl); font-weight: 700;
}
.dd--heading button.dd__trigger:hover:not(:disabled) { background: none; background-image: none; }

/* form variant — matches the global input baseline so closed state blends into forms */
.dd--form button.dd__trigger {
  width: 100%; justify-content: space-between;
  background: var(--bg-3); border: 1px solid var(--bdr); border-radius: var(--r-sm);
  padding: 6px 8px; font-size: var(--fs-md); color: var(--tx);
}

/* popover — floating themed listbox; scrolls past ~240px (inside the modal it extends the
   scrollable content instead of floating over the card — kept usable by the modest cap) */
.dd__pop {
  position: absolute; left: 0; top: 100%; z-index: 10; margin-top: 4px;
  min-width: 100%; max-height: 240px; overflow-y: auto; overflow-x: hidden;
  background: var(--surface); border: 1px solid var(--bdr); border-radius: var(--r);
  box-shadow: var(--menu-shadow); padding: var(--space-1);
}

/* rows — roomy hover pills; one type-step larger than body */
.dd button.dd__opt {
  display: flex; align-items: center; gap: var(--space-2);
  width: 100%; background: none; border: none; border-radius: var(--r-sm); text-align: left;
  padding: 8px 14px; font-size: var(--fs-lg); color: var(--tx); line-height: 1.2; cursor: pointer;
  white-space: nowrap;
}
.dd button.dd__opt:hover:not(:disabled) { background: var(--hover); background-image: none; }
.dd button.dd__opt:disabled { color: var(--tx-3); cursor: default; }
.dd__opt--selected { color: var(--tx-hi); }
.dd__opt-label { overflow: hidden; text-overflow: ellipsis; }
.dd__opt-hint { color: var(--tx-3); font-size: var(--fs-sm); flex: 0 0 auto; }
.dd__tick { display: inline-flex; margin-left: auto; color: var(--accent); font-size: 13px; }

/* group headers — themed optgroup labels */
.dd__group {
  padding: 8px 14px 4px; text-transform: uppercase; letter-spacing: 0.08em;
  font-size: var(--fs-2xs); color: var(--tx-3);
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: tsc + vite succeed. (`Dropdown` is not imported anywhere yet — `tsc` doesn't fail builds on unused *modules*, only unused locals; the import lands in Task 3.)

Run: `npx vitest run`
Expected: all tests PASS (existing 104 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/views/Dropdown.tsx src/views/Dropdown.css src/views/icons.tsx src/theme/deepSlate.css
git commit -m "feat(dropdown): themed Dropdown component (trigger + popover) + --menu-shadow token"
```

---

### Task 3: swap the slot-column picker to `Dropdown`

**Files:**
- Modify: `src/views/worktree-column/SlotColumn.tsx:50-69` (the `.wt-col__picker-wrap` block)
- Modify: `src/views/worktree-column/WorktreeColumn.css:21-31` (remove select-specific picker CSS)

**Interfaces:**
- Consumes: `Dropdown` from `../Dropdown`, `DropdownGroup` from `../dropdown`.
- Produces: nothing new — `SlotColumn`'s props are unchanged.

No new unit test — the picker markup is render-only; behavior is covered by the GUI pass. Existing tests must stay green.

- [ ] **Step 1: Replace the select in `SlotColumn.tsx`**

Add imports:

```tsx
import { Dropdown } from "../Dropdown";
import type { DropdownGroup } from "../dropdown";
```

Inside the component, before `return`, build the groups (this replaces the JSX option lists; the "Select…" row keeps its role as the clear-the-slot action via `onChange("") → onSelect(null)`):

```tsx
// Picker rows: clear-action + (synthetic pending) ungrouped, then Worktrees / Scratch groups.
const pickerGroups: DropdownGroup[] = [
  { options: [
    { value: "", label: "Select…" },
    // A pending id isn't in the worktree/scratch lists — synthetic disabled row so the trigger reads sensibly.
    ...(entity?.kind === "pending" ? [{ value: entity.pending.id, label: `${entity.pending.status}…`, disabled: true }] : []),
  ]},
  { label: "Worktrees", options: ongoing.map((w) => {
    // Append the repo basename so each slot's origin is obvious at a glance.
    const repo = w.repoPath.split("/").pop();
    return { value: w.id, label: repo ? `${w.name} · ${repo}` : w.name };
  })},
  ...(scratchTerminals.length > 0
    ? [{ label: "Scratch", options: scratchTerminals.map((s) => ({ value: s.id, label: s.title })) }]
    : []),
];
```

Replace the whole `<div className="wt-col__picker-wrap">…</div>` block (select + caret span) with:

```tsx
<Dropdown value={activeId} onChange={(v) => onSelect(v || null)} groups={pickerGroups} placeholder="Select…" variant="heading" />
```

- [ ] **Step 2: Remove the dead picker CSS from `WorktreeColumn.css`**

Delete the `.wt-col__picker-wrap`, `.wt-col__picker`, `.wt-col__picker:focus`, and `.wt-col__caret` rules (lines 21–31) and their `/* heading-style picker … */` comment.

- [ ] **Step 3: Verify**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build clean.

- [ ] **Step 4: Commit**

```bash
git add src/views/worktree-column/SlotColumn.tsx src/views/worktree-column/WorktreeColumn.css
git commit -m "feat(dropdown): slot-column picker uses the themed Dropdown"
```

---

### Task 4: swap Checkout's repo + branch selects to `Dropdown`

**Files:**
- Modify: `src/tiles/worktree/ExistingBranchForm.tsx:67-88`

**Interfaces:**
- Consumes: `Dropdown` from `../../views/Dropdown`.
- Produces: nothing new — the form's behavior is unchanged.

Behavior note: the native version exposed "select repo…"/"select branch…" as selectable empty options; with `Dropdown` they become placeholders only (no reset row — YAGNI, picking another value re-picks; `pickRepo("")` is never fired by the UI anymore, its reset branch stays as dead-safe code).

- [ ] **Step 1: Replace both selects in `ExistingBranchForm.tsx`**

Add import:

```tsx
import { Dropdown } from "../../views/Dropdown";
```

Replace the repo `<select className="eb-form__repo">…</select>` with:

```tsx
<Dropdown variant="form" placeholder="select repo…" value={repoPath || null} onChange={pickRepo}
  groups={[{ options: cockpit.knownRepos.map((r) => ({ value: r.path, label: r.path })) }]} />
```

Replace the branch `<select className="eb-form__branch">…</select>` with (recency hint moves to the dim `hint` slot; disabled = already checked out, git can't worktree-add those):

```tsx
<Dropdown variant="form" placeholder="select branch…" value={branch || null} onChange={pickBranch}
  groups={[{ options: branches.map((b) => ({
    value: b.name, label: b.name,
    hint: `${b.lastCommitRelative}${b.checkedOut ? " · checked out" : ""}`,
    disabled: b.checkedOut,
  })) }]} />
```

- [ ] **Step 2: Check nothing referenced the removed class names**

Run: `grep -rn "eb-form__repo\|eb-form__branch" src/`
Expected: no matches.

- [ ] **Step 3: Verify**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build clean.

- [ ] **Step 4: Commit**

```bash
git add src/tiles/worktree/ExistingBranchForm.tsx
git commit -m "feat(dropdown): Checkout repo/branch pickers use the themed Dropdown"
```

---

### Task 5: gear-menu consistency pass + final verify

**Files:**
- Modify: `src/views/worktree-column/WorktreeColumn.css` (`.wt-col__menu-pop` block)

**Interfaces:**
- Consumes: `--menu-shadow` from Task 2.
- Produces: nothing — CSS only.

- [ ] **Step 1: Align the gear popover with the dropdown family**

In `WorktreeColumn.css`, update `.wt-col__menu-pop` (radius `--r-sm` → `--r`, add the shadow, side padding so rows hover as pills) and its rows (rounded hover pill):

```css
.wt-col__menu-pop {
  position: absolute; right: 0; top: 100%; z-index: 10; margin-top: 4px;
  background: var(--surface); border: 1px solid var(--bdr); border-radius: var(--r);
  box-shadow: var(--menu-shadow);
  display: flex; flex-direction: column; min-width: 150px; overflow: hidden; padding: var(--space-1);
}
```

and add `border-radius: var(--r-sm);` to the `.wt-col__menu-pop button` rule (keep everything else as is).

- [ ] **Step 2: Full verify**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; build clean.

- [ ] **Step 3: Commit**

```bash
git add src/views/worktree-column/WorktreeColumn.css
git commit -m "style(dropdown): gear-menu popover matches the dropdown family (radius, shadow, hover pills)"
```

---

### Manual GUI acceptance (human)

In `npm run tauri dev`:
1. Slot picker: open → dark rounded popover with Worktrees/Scratch group headers, larger rows, hover pill, tick on the selected row; "Select…" clears the slot; Escape and click-outside close it.
2. Pending tile: trigger shows "deducing…", the synthetic row is dimmed and unclickable.
3. Checkout (Cmd+N): repo then branch dropdowns look like form inputs when closed; branch rows show dim "2 days ago" hints; checked-out branches dimmed/unclickable; a long branch list scrolls inside the popover within the modal; Escape with the popover open closes only the popover, a second Escape closes the modal.
4. Gear menu: same radius/shadow/hover-pill family as the dropdown.
