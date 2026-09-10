// ExistingBranchForm.test.ts — the branch picker's row rules: which branches can be picked, and which
// one means "open the repo's own working tree in place" rather than "add a worktree".
import { describe, it, expect } from "vitest";
import { branchPickerOptions, opensInPlace } from "./ExistingBranchForm";
import type { BranchInfo } from "../../worktrees/api";

const branch = (name: string, over: Partial<BranchInfo> = {}): BranchInfo => ({
  name, lastCommitRelative: "2 days ago", checkedOut: false, checkedOutPath: null, ...over,
});

describe("branchPickerOptions", () => {
  it("hoists the repo's own checked-out branch to the top and lets it be picked", () => {
    const rows = branchPickerOptions([
      branch("feat/login"),
      branch("main", { checkedOut: true, checkedOutPath: "/repo" }),
    ], "/repo");
    expect(rows[0]).toEqual({
      value: "main", label: "main", hint: "2 days ago · open in place", disabled: false,
    });
  });

  it("keeps a branch checked out in another worktree disabled", () => {
    const rows = branchPickerOptions([
      branch("feat/login", { checkedOut: true, checkedOutPath: "/Users/me/CockpitWorktrees/repo/login" }),
    ], "/repo");
    expect(rows).toEqual([
      { value: "feat/login", label: "feat/login", hint: "2 days ago · checked out", disabled: true },
    ]);
  });

  it("leaves free branches enabled in the recency order git gave them", () => {
    const rows = branchPickerOptions([branch("feat/a"), branch("feat/b")], "/repo");
    expect(rows.map((r) => r.value)).toEqual(["feat/a", "feat/b"]);
    expect(rows.every((r) => r.disabled === false)).toBe(true);
  });
});

describe("opensInPlace", () => {
  const branches = [
    branch("main", { checkedOut: true, checkedOutPath: "/repo" }),
    branch("feat/login", { checkedOut: true, checkedOutPath: "/Users/me/CockpitWorktrees/repo/login" }),
    branch("feat/idle"),
  ];

  it("is true for the branch the repo's own tree has checked out", () => {
    expect(opensInPlace(branches, "main", "/repo")).toBe(true);
  });
  it("is false for a branch checked out in another worktree", () => {
    expect(opensInPlace(branches, "feat/login", "/repo")).toBe(false);
  });
  it("is false for a branch no tree holds", () => {
    expect(opensInPlace(branches, "feat/idle", "/repo")).toBe(false);
  });
  it("is false when nothing is selected yet", () => {
    expect(opensInPlace(branches, "", "/repo")).toBe(false);
  });
});
