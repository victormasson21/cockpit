// ExistingBranchForm.test.ts — the branch picker's row rules: which branches can be picked, and which
// one means "open the repo's own working tree in place" rather than "add a worktree".
import { describe, it, expect } from "vitest";
import { branchPickerGroups, opensInPlace } from "./ExistingBranchForm";
import type { BranchInfo } from "../../worktrees/api";

const branch = (name: string, over: Partial<BranchInfo> = {}): BranchInfo => ({
  name, lastCommitRelative: "2 days ago", checkedOut: false, primaryTree: false, ...over,
});

describe("branchPickerGroups", () => {
  it("heads the list with the repo's own tree, named and pickable", () => {
    const groups = branchPickerGroups([
      branch("feat/login"),
      branch("main", { checkedOut: true, primaryTree: true }),
    ]);
    expect(groups[0]).toEqual({
      label: "Checked out in the repo",
      options: [{ value: "main", label: "main", hint: "2 days ago · open in place", disabled: false }],
    });
    expect(groups[1]?.options.map((o) => o.value)).toEqual(["feat/login"]);
  });

  it("keeps a branch checked out in another worktree disabled", () => {
    const groups = branchPickerGroups([branch("feat/login", { checkedOut: true })]);
    expect(groups).toEqual([
      { options: [{ value: "feat/login", label: "feat/login", hint: "2 days ago · checked out", disabled: true }] },
    ]);
  });

  it("omits the repo group when the repo's tree is detached", () => {
    const groups = branchPickerGroups([branch("feat/a"), branch("feat/b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.options.map((o) => o.value)).toEqual(["feat/a", "feat/b"]);
    expect(groups[0]?.options.every((o) => o.disabled === false)).toBe(true);
  });
});

describe("opensInPlace", () => {
  const branches = [
    branch("main", { checkedOut: true, primaryTree: true }),
    branch("feat/login", { checkedOut: true }),
    branch("feat/idle"),
  ];

  it("is true for the branch the repo's own tree has checked out", () => {
    expect(opensInPlace(branches, "main")).toBe(true);
  });
  it("is false for a branch checked out in another worktree", () => {
    expect(opensInPlace(branches, "feat/login")).toBe(false);
  });
  it("is false for a branch no tree holds", () => {
    expect(opensInPlace(branches, "feat/idle")).toBe(false);
  });
  it("is false when nothing is selected yet", () => {
    expect(opensInPlace(branches, "")).toBe(false);
  });
});
