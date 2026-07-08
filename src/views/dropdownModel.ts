// dropdownModel.ts — pure types + trigger-label resolution for the themed Dropdown component.
// (Named dropdownModel, not dropdown: macOS's case-insensitive FS would collide `dropdown.ts` with `Dropdown.tsx` on import resolution.)
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
