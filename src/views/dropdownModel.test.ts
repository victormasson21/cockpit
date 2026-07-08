// dropdownModel.test.ts — trigger-label resolution for the themed Dropdown.
import { describe, it, expect } from "vitest";
import { selectedLabel, type DropdownGroup } from "./dropdownModel";

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
