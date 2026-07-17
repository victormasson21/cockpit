# Customisable Worktree Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rename a slot's heading (worktree or scratch terminal) by clicking the title, while the arrow-down chevron keeps opening the worktree/scratch picker.

**Architecture:** The shared `Dropdown` (heading variant) gains an optional inline-edit mode. When a rename callback is supplied, the trigger splits into a clickable title (→ inline `<input>`) and a separate chevron button (→ popover). `SlotColumn` wires the callback to overwrite the entity in place: `updateWorktree(id, {name})` (persisted) for worktrees, a new session-only `renameScratch(id, title)` for scratch. The Linear chip is relabelled to a fixed "Linear" and detected from the branch/link (rename-robust) instead of the now-mutable name.

**Tech Stack:** React + TypeScript (Vite), Zustand store, Vitest (node environment — pure-logic tests only; component keyboard wiring is GUI-verified per existing codebase convention). No Rust changes.

## Global Constraints

- **Overwrite in place** — no new persisted field. Worktree → `Worktree.name`; scratch → `ScratchTerminal.title`.
- **No clear mechanism** — an empty/whitespace save is a no-op revert.
- **Editable entities:** worktrees and scratch terminals only. Pending entities and empty slots show no rename affordance.
- **Chevron styling:** reuse the `.icon-btn` baseline (the class the nearby gear uses — `padding: 6px 12px`, `--r-sm`, hover state) for a comfortable click target.
- **Do not regress the two Checkout `form`-variant Dropdowns** — the inline-edit path must be inert when no rename callback is passed.
- **Top-of-file / block comments** per repo convention (`CLAUDE.md`): concise role comment at file top, short intent comments on non-obvious blocks.
- **Test env is `node`** (`vite.config.ts`): only pure functions and the Zustand store are unit-tested; do not add jsdom/testing-library.

---

### Task 1: `sanitizeTitle` pure helper (rename-commit rule)

**Files:**
- Modify: `src/views/dropdownModel.ts`
- Test: `src/views/dropdownModel.test.ts`

**Interfaces:**
- Produces: `sanitizeTitle(raw: string): string | null` — trims `raw`; returns the trimmed string if non-empty, else `null` (caller treats `null` as no-op / revert).

- [ ] **Step 1: Write the failing tests**

Append to `src/views/dropdownModel.test.ts`:

```typescript
import { selectedLabel, sanitizeTitle, type DropdownGroup } from "./dropdownModel";
// (merge with the existing import line — do not duplicate the import)

describe("sanitizeTitle", () => {
  it("returns the trimmed value for non-blank input", () => {
    expect(sanitizeTitle("  Fix the login bug  ")).toBe("Fix the login bug");
  });
  it("returns null for an empty string", () => {
    expect(sanitizeTitle("")).toBeNull();
  });
  it("returns null for whitespace-only input", () => {
    expect(sanitizeTitle("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/dropdownModel.test.ts`
Expected: FAIL — `sanitizeTitle is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/views/dropdownModel.ts`:

```typescript
// A rename commits only a non-blank, trimmed value; blank input is a no-op revert (no clear mechanism).
export function sanitizeTitle(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/views/dropdownModel.test.ts`
Expected: PASS (existing `selectedLabel` tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/views/dropdownModel.ts src/views/dropdownModel.test.ts
git commit -m "feat: sanitizeTitle helper for inline title edits"
```

---

### Task 2: `renameScratch` store action

**Files:**
- Modify: `src/settings/store.ts` (interface near line 55; action near line 206)
- Test: `src/settings/store.test.ts`

**Interfaces:**
- Consumes: existing `scratchTerminals: ScratchTerminal[]` slice and `addScratch(): string`.
- Produces: `renameScratch(id: string, title: string): void` — overwrites the matching scratch terminal's `title`; leaves others unchanged; session-only (not persisted).

- [ ] **Step 1: Write the failing test**

Append to `src/settings/store.test.ts`:

```typescript
describe("renameScratch", () => {
  beforeEach(() => {
    useSettings.setState({ scratchTerminals: [], scratchSeq: 0 });
  });
  it("overwrites the matching scratch terminal's title only", () => {
    const a = useSettings.getState().addScratch();
    const b = useSettings.getState().addScratch();
    useSettings.getState().renameScratch(a, "My shell");
    const list = useSettings.getState().scratchTerminals;
    expect(list.find((s) => s.id === a)?.title).toBe("My shell");
    expect(list.find((s) => s.id === b)?.title).toBe("Scratch 2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/settings/store.test.ts`
Expected: FAIL — `renameScratch is not a function`.

- [ ] **Step 3: Add the action to the store interface**

In `src/settings/store.ts`, in the store type/interface, add next to the other scratch actions (after the `removeScratch` declaration around line 56):

```typescript
  renameScratch: (id: string, title: string) => void;
```

- [ ] **Step 4: Implement the action**

In `src/settings/store.ts`, insert immediately after the `removeScratch` implementation (around line 210):

```typescript
  // Session-only: overwrite a scratch terminal's display title in place (scratch is never persisted).
  renameScratch: (id, title) =>
    set((st) => ({ scratchTerminals: st.scratchTerminals.map((s) => (s.id === id ? { ...s, title } : s)) })),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/settings/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/settings/store.ts src/settings/store.test.ts
git commit -m "feat: renameScratch store action"
```

---

### Task 3: Rename-robust Linear chip

**Files:**
- Modify: `src/views/worktree-column/chips.ts:16-18`
- Test: `src/views/worktree-column/chips.test.ts`

**Interfaces:**
- Consumes: `Worktree` (`branch`, `links`), `findLink(links, needle)` (already in file).
- Produces: no signature change — `worktreeChips(w)` still returns `Chip[]`; the `linear` chip's `label` is now the fixed string `"Linear"` and detection reads `branch`/link, not `name`.

- [ ] **Step 1: Update the tests (they encode the new behaviour)**

Replace the first three `it(...)` blocks in `src/views/worktree-column/chips.test.ts` (the Linear-related ones, lines 14–24) with:

```typescript
  it("shows a Linear chip (label 'Linear') from a Linear branch ref", () => {
    expect(chip({ ...base, branch: "eng-2841-fix-checkout" }, "linear")?.label).toBe("Linear");
  });
  it("shows a Linear chip from a linear.app link even with no branch ref", () => {
    const w = { ...base, branch: "", links: [{ label: "t", url: "https://linear.app/acme/issue/ENG-1" }] };
    expect(chip(w, "linear")?.label).toBe("Linear");
    expect(chip(w, "linear")?.url).toContain("linear.app");
  });
  it("still shows Linear after the worktree name is renamed (branch retains the ref)", () => {
    const w = { ...base, name: "Fix the login bug", branch: "eng-2841-fix" };
    expect(kinds(w)).toContain("linear");
  });
  it("does not treat a plain branch, 'pr-<N>', or 'issue-<N>' as Linear", () => {
    expect(kinds({ ...base, branch: "" })).not.toContain("linear");
    expect(kinds({ ...base, branch: "pr-4790" })).not.toContain("linear");
    expect(kinds({ ...base, branch: "issue-12" })).not.toContain("linear");
  });
```

Leave the PR / Issue / localhost / CI tests unchanged. Note the standalone `it("does not treat 'React 19' or 'pr-4790'...")` block at lines 21–24 is replaced by the new negative test above — delete the old one to avoid a duplicate.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/worktree-column/chips.test.ts`
Expected: FAIL — current code labels the chip with the raw ref and reads `name`.

- [ ] **Step 3: Update the detection**

In `src/views/worktree-column/chips.ts`, replace lines 16–18:

```typescript
  // Canonical Linear ids are uppercase in the name (ENG-1234); searching the name avoids lowercase branch noise.
  const linear = w.name.match(/\b[A-Z]{2,}-\d+\b/);
  if (linear) chips.push({ kind: "linear", label: linear[0], url: findLink(w.links, "linear.app") });
```

with:

```typescript
  // Linear detection is rename-robust: the name is user-editable, so read the immutable branch ref
  // (e.g. eng-1234-…) and/or a linear.app link. Exclude pr-/issue- prefixes so those aren't misread.
  const linearLink = findLink(w.links, "linear.app");
  const branchRef = w.branch.match(/\b([a-z]{2,})-\d+\b/i);
  const branchIsLinear = branchRef !== null && !["pr", "issue"].includes(branchRef[1].toLowerCase());
  if (linearLink || branchIsLinear) chips.push({ kind: "linear", label: "Linear", url: linearLink });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/views/worktree-column/chips.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/worktree-column/chips.ts src/views/worktree-column/chips.test.ts
git commit -m "feat: rename-robust Linear chip labelled 'Linear'"
```

---

### Task 4: Split the Dropdown trigger into editable title + chevron button

**Files:**
- Modify: `src/views/Dropdown.tsx`
- Modify: `src/views/Dropdown.css`

**Interfaces:**
- Consumes: `sanitizeTitle` (Task 1); `selectedLabel`, `DropdownGroup` (existing); `ChevronIcon`, `TickIcon` (existing).
- Produces: `Dropdown` gains two optional props — `onRename?: (value: string) => void` and `editValue?: string`. When `onRename` is supplied, the heading trigger splits: the label region enters inline edit, a separate chevron button toggles the popover. When `onRename` is absent, the component is byte-for-byte behaviourally identical to today (whole trigger opens popover).

- [ ] **Step 1: Extend the component**

Replace the whole body of `src/views/Dropdown.tsx` with:

```tsx
// Dropdown.tsx — themed <select> replacement: trigger button + popover listbox (macOS renders the native popup; CSS can't style it).
// Heading variant supports optional inline title edit: pass onRename + editValue to split the trigger into an editable label + a chevron button.
import { useEffect, useRef, useState } from "react";
import { selectedLabel, sanitizeTitle, type DropdownGroup } from "./dropdownModel";
import { ChevronIcon, TickIcon } from "./icons";
import "./Dropdown.css";

export function Dropdown({ value, onChange, groups, placeholder, variant, onRename, editValue }: {
  value: string | null;
  onChange: (value: string) => void;
  groups: DropdownGroup[];
  placeholder: string;
  variant: "heading" | "form";
  onRename?: (value: string) => void; // present → the label is click-to-edit; the chevron alone opens the popover
  editValue?: string;                 // raw value to seed the edit input (the entity name/title, not the composed label)
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
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

  // Commit an inline rename: blank input is a no-op revert (no clear mechanism); always exit edit mode.
  const commit = (raw: string) => {
    const t = sanitizeTitle(raw);
    if (t && onRename) onRename(t);
    setEditing(false);
  };

  const label = <span className="dd__label">{selectedLabel(groups, value, placeholder)}</span>;

  return (
    <div className={`dd dd--${variant}`} ref={rootRef} onKeyDown={onKeyDown}>
      {editing ? (
        // Inline title editor: Enter/blur commit, Escape reverts (stopPropagation so the popover Escape doesn't also fire).
        <input
          className="dd__edit" autoFocus defaultValue={editValue ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            else if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
          }}
          onBlur={(e) => commit(e.target.value)}
        />
      ) : onRename ? (
        // Split trigger: label click → edit; chevron button → popover (styled like the nearby gear).
        <>
          <button type="button" className="dd__trigger dd__trigger--editable" onClick={() => setEditing(true)}>
            {label}
          </button>
          <button type="button" className="dd__chevron-btn icon-btn" aria-label="switch worktree" onClick={() => setOpen((o) => !o)}>
            <ChevronIcon open />
          </button>
        </>
      ) : (
        <button type="button" className="dd__trigger" onClick={() => setOpen((o) => !o)}>
          {label}
          <span className="dd__chevron" aria-hidden><ChevronIcon open /></span>
        </button>
      )}
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

- [ ] **Step 2: Add styles for the editable label, chevron button, and edit input**

Append to `src/views/Dropdown.css`:

```css
/* editable heading — label is its own click-to-edit button; chevron is a sibling icon-btn (matches the gear) */
.dd--heading button.dd__trigger--editable {
  background: none; border: none; padding: 0 2px;
  color: var(--tx-hi); font-size: var(--fs-xl); font-weight: 700;
  min-width: 0; max-width: 100%; cursor: text; text-align: left;
}
.dd--heading button.dd__trigger--editable:hover:not(:disabled) { background: none; background-image: none; }
/* chevron-as-button: shares the .icon-btn baseline (padding 6px 12px, hover) with the gear for a comfy target */
.dd button.dd__chevron-btn { flex: 0 0 auto; font-size: 14px; }
/* inline edit input — mirrors the heading type so the box doesn't jump when entering edit mode */
.dd__edit {
  min-width: 0; max-width: 100%; width: 12ch;
  font-family: var(--ui); font-size: var(--fs-xl); font-weight: 700;
  color: var(--tx-hi); background: var(--bg-3);
  border: 1px solid var(--bdr); border-radius: var(--r-sm); padding: 0 4px;
}
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; Vite build succeeds. (No unit test — the component render/keyboard path is GUI-verified per repo convention; the pure commit rule is already covered by `sanitizeTitle` in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add src/views/Dropdown.tsx src/views/Dropdown.css
git commit -m "feat: Dropdown heading inline title edit + chevron button"
```

---

### Task 5: Wire the switcher rename in SlotColumn

**Files:**
- Modify: `src/views/worktree-column/SlotColumn.tsx` (destructure at line 19; switcher at lines 73–78)

**Interfaces:**
- Consumes: `updateWorktree(id, patch)` and the new `renameScratch(id, title)` from `useSettings` (Task 2); `Dropdown`'s new `onRename`/`editValue` props (Task 4); the resolved `entity`.
- Produces: renders the heading `Dropdown` with `onRename`/`editValue` set for worktree and scratch entities; unset (undefined) for pending/empty, so those keep the plain single-button trigger.

- [ ] **Step 1: Pull the rename actions from the store**

In `src/views/worktree-column/SlotColumn.tsx`, extend the destructure on line 19:

```tsx
  const { cockpit, removeScratch, scratchTerminals, pendingWorktrees, updateWorktree, renameScratch } = useSettings();
```

- [ ] **Step 2: Compute the rename wiring and pass it to the switcher Dropdown**

In `src/views/worktree-column/SlotColumn.tsx`, replace the `switcher` definition (lines 71–78) with:

```tsx
  // Rename wiring: worktree → persisted name; scratch → session-only title; pending/empty → not editable.
  const editValue = entity?.kind === "worktree" ? entity.worktree.name
    : entity?.kind === "scratch" ? entity.scratch.title : undefined;
  const onRename = entity?.kind === "worktree" ? (t: string) => updateWorktree(entity.worktree.id, { name: t })
    : entity?.kind === "scratch" ? (t: string) => renameScratch(entity.scratch.id, t) : undefined;

  // The switcher = identity glyph + worktree dropdown. In calm mode over a worktree it's injected
  // into the Claude pane header (level with restart) instead of a standalone column header.
  const switcher = (
    <>
      <span className={`wt-col__icon wt-col__icon--${iconKind}${attention ? " wt-col__icon--attention" : ""}`} aria-hidden />
      <Dropdown
        value={activeId} onChange={(v) => onSelect(v || null)} groups={pickerGroups}
        placeholder="Select…" variant="heading" onRename={onRename} editValue={editValue}
      />
    </>
  );
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; Vite build succeeds.

- [ ] **Step 4: Full test + build gate**

Run: `npx vitest run && npm run build`
Expected: all JS tests pass; Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/views/worktree-column/SlotColumn.tsx
git commit -m "feat: wire inline title rename into the slot switcher"
```

---

### Task 6: GUI acceptance (human eyeball)

The macOS Tauri window can't be driven headlessly, so this task is a manual smoke, not automated. No code changes; do not mark other tasks blocked on it.

- [ ] **Step 1: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify the checklist**

- Clicking the **chevron** (arrow-down) opens the worktree/scratch picker; selecting an entry switches the slot (unchanged).
- Clicking the **title text** turns it into an input seeded with the current name/title.
- **Enter** or clicking away (**blur**) saves; the heading and the picker rows both show the new title.
- **Escape** reverts without saving.
- Saving an **empty** value leaves the previous title unchanged.
- A worktree rename **persists** across an app restart; a scratch rename does **not** (scratch is session-only).
- Renaming a Linear worktree still shows a **"Linear"** chip; the chevron button reads as a sibling to the gear with a comfortable click target.
- Checkout modal's repo/branch dropdowns are **unchanged** (whole control still opens the popover).

- [ ] **Step 3: Record the result**

If all pass, note GUI acceptance in the commit/PR description. If anything fails, open a systematic-debugging pass before merging.

---

## Self-Review notes

- **Spec coverage:** interaction split → Task 4+5; overwrite-in-place (worktree persisted / scratch session-only) → Task 2, 5; display scope header+rows → automatic (picker rows already read `name`/`title`), verified in Task 6; no-clear → Task 1 (`sanitizeTitle`); worktrees+scratch → Task 5; Linear chip relabel + rename-robust detection → Task 3; chevron styled like the gear → Task 4 (`.icon-btn`). All spec sections mapped.
- **Type consistency:** `sanitizeTitle(raw: string): string | null` (Task 1) consumed in Task 4; `renameScratch(id, title)` (Task 2) consumed in Task 5; `onRename`/`editValue` props (Task 4) consumed in Task 5. Names match across tasks.
- **Test-env reality:** no jsdom/testing-library in this repo (`test: { environment: "node" }`), so keyboard/render behaviour is GUI-verified (Task 6) while the decision logic is unit-tested via `sanitizeTitle`, `renameScratch`, and `worktreeChips` — matching the existing pure-logic testing convention.
- **No Rust changes** — `name` is display+creation-slug only; the branch and `worktreePath` are untouched by a rename.
