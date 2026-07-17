// chips.test.ts — deriving display chips from existing worktree data (no live providers).
import { describe, it, expect } from "vitest";
import { worktreeChips } from "./chips";
import type { Worktree } from "../../settings/types";

const base: Worktree = {
  id: "wt", name: "", repoPath: "/r", branch: "", worktreePath: "/wt",
  host: { startCmd: "pnpm dev", address: "http://localhost:5173" }, links: [], status: "ongoing",
};
const kinds = (w: Worktree) => worktreeChips(w).map((c) => c.kind);
const chip = (w: Worktree, k: string) => worktreeChips(w).find((c) => c.kind === k);

describe("worktreeChips", () => {
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
  it("derives a PR chip from pr-<N> in the branch", () => {
    expect(chip({ ...base, branch: "pr-4790" }, "pr")?.label).toBe("PR #4790");
  });
  it("derives an Issue chip from issue-<N>", () => {
    expect(chip({ ...base, name: "issue-12 thing" }, "issue")?.label).toBe("Issue #12");
  });
  it("derives a localhost chip with the port from host.address", () => {
    const c = chip(base, "localhost");
    expect(c?.label).toBe("localhost:5173");
    expect(c?.url).toBe("http://localhost:5173");
  });
  it("omits the localhost chip when host.address is empty", () => {
    expect(kinds({ ...base, host: { startCmd: "x", address: "" } })).not.toContain("localhost");
  });
  it("never includes a CI stub chip", () => {
    expect(kinds(base)).not.toContain("ci");
  });
});
