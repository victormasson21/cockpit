// dropdownModel.ts — pure types + trigger-label resolution for the themed Dropdown component.
// (Named dropdownModel, not dropdown: macOS's case-insensitive FS would collide `dropdown.ts` with `Dropdown.tsx` on import resolution.)
// `suffix` is secondary identity shown after the label (the slot picker's repo name) — kept out of
// `label` so it can be rendered at its own weight instead of blending into the title.
export type DropdownOption = { value: string; label: string; suffix?: string; hint?: string; disabled?: boolean };
export type DropdownGroup = { label?: string; options: DropdownOption[] };

function findOption(groups: DropdownGroup[], value: string | null): DropdownOption | undefined {
  if (value === null) return undefined;
  for (const g of groups) {
    const hit = g.options.find((o) => o.value === value);
    if (hit) return hit;
  }
  return undefined;
}

// The trigger shows the selected option's label; a null/unmatched value falls back to the placeholder.
export function selectedLabel(groups: DropdownGroup[], value: string | null, placeholder: string): string {
  return findOption(groups, value)?.label ?? placeholder;
}

// The selected option's suffix, if it has one — rendered beside the label at a lighter weight.
export function selectedSuffix(groups: DropdownGroup[], value: string | null): string | undefined {
  return findOption(groups, value)?.suffix;
}

// A rename commits only a non-blank, trimmed value; blank input is a no-op revert (no clear mechanism).
export function sanitizeTitle(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}
