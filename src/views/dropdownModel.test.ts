// dropdownModel.test.ts — trigger-label resolution for the themed Dropdown.
import { describe, it, expect } from "vitest";
import { selectedLabel, selectedSuffix, sanitizeTitle, type DropdownGroup } from "./dropdownModel";

const groups: DropdownGroup[] = [
  { options: [{ value: "", label: "Select…" }] },
  { label: "Worktrees", options: [
    { value: "wt-1", label: "fix-login", suffix: "cockpit" },
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
  it("excludes the suffix so it can be rendered at its own weight", () => {
    expect(selectedLabel(groups, "wt-1", "Select…")).toBe("fix-login");
  });
});

describe("selectedSuffix", () => {
  it("returns the selected option's suffix (the repo name)", () => {
    expect(selectedSuffix(groups, "wt-1")).toBe("cockpit");
  });
  it("is undefined for an option without one", () => {
    expect(selectedSuffix(groups, "scratch-1")).toBeUndefined();
  });
  it("is undefined for a null or unmatched value", () => {
    expect(selectedSuffix(groups, null)).toBeUndefined();
    expect(selectedSuffix(groups, "gone")).toBeUndefined();
  });
});

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
