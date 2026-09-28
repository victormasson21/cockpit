import { describe, expect, it } from "vitest";
import { worktreeOption } from "./worktreeOption";
import { makeWorktree } from "../worktrees/model";

describe("worktreeOption", () => {
  it("uses the id as value, the name as label and the repo basename as suffix", () => {
    const w = makeWorktree({
      id: "wt-1", name: "fix login", repoPath: "/Users/me/Repos/web-app", branch: "b",
      worktreePath: "/w", host: { startCmd: "", address: "" }, links: [],
    });
    expect(worktreeOption(w)).toEqual({ value: "wt-1", label: "fix login", suffix: "web-app" });
  });
});
