// relocate.test.ts — moving a worktree to another repo: branch spec choice, model repoint, guards.
import { describe, it, expect, vi } from "vitest";
import { canRelocate, relocateWorktree, type RelocateDeps } from "./relocate";
import type { BranchInfo } from "./api";
import { makeWorktree } from "./model";

const WT = makeWorktree({
  id: "wt-1", name: "fix login", repoPath: "/wrong", branch: "fix-login", worktreePath: "/wt/wrong/fix-login",
  host: { startCmd: "npm run dev", address: "http://localhost:3000" },
});

const branch = (name: string, checkedOut = false): BranchInfo => ({ name, lastCommitRelative: "", checkedOut, primaryTree: false });

const deps = (branches: BranchInfo[] = [], over: Partial<RelocateDeps> = {}) => ({
  listBranches: vi.fn(() => Promise.resolve(branches)),
  defaultBranch: vi.fn(() => Promise.resolve("main")),
  create: vi.fn(() => Promise.resolve("/wt/right/fix-login")),
  update: vi.fn(),
  typeIntoClaude: vi.fn(() => Promise.resolve()),
  ...over,
}) satisfies RelocateDeps;

describe("relocateWorktree", () => {
  it("creates the branch from the target's default branch when it does not exist there", async () => {
    const d = deps();
    await relocateWorktree(WT, "/right", d);
    expect(d.create).toHaveBeenCalledWith("/right", "fix login", { kind: "new", branch: "fix-login", base: "main" });
  });

  it("checks out the branch when the target already has it free", async () => {
    const d = deps([branch("fix-login")]);
    await relocateWorktree(WT, "/right", d);
    expect(d.create).toHaveBeenCalledWith("/right", "fix login", { kind: "existing", branch: "fix-login" });
    expect(d.defaultBranch).not.toHaveBeenCalled();
  });

  it("refuses a branch checked out elsewhere in the target, before creating anything", async () => {
    const d = deps([branch("fix-login", true)]);
    await expect(relocateWorktree(WT, "/right", d)).rejects.toThrow("already checked out");
    expect(d.create).not.toHaveBeenCalled();
    expect(d.update).not.toHaveBeenCalled();
  });

  it("repoints the model, blanks the old repo's host, and records the earlier checkout", async () => {
    const d = deps();
    await relocateWorktree(WT, "/right", d);
    expect(d.update).toHaveBeenCalledWith("wt-1", {
      repoPath: "/right", worktreePath: "/wt/right/fix-login",
      host: { startCmd: "", address: "" },
      relocatedFrom: { repoPath: "/wrong", worktreePath: "/wt/wrong/fix-login", branch: "fix-login" },
    });
  });

  it("types /add-dir into Claude, and a missing Claude pane does not fail the move", async () => {
    const d = deps([], { typeIntoClaude: vi.fn(() => Promise.reject(new Error("no pty"))) });
    await relocateWorktree(WT, "/right", d);
    expect(d.typeIntoClaude).toHaveBeenCalledWith("/add-dir /wt/right/fix-login");
    expect(d.update).toHaveBeenCalled();
  });

  it("a failed create leaves the model untouched", async () => {
    const d = deps([], { create: vi.fn(() => Promise.reject(new Error("git says no"))) });
    await expect(relocateWorktree(WT, "/right", d)).rejects.toThrow("git says no");
    expect(d.update).not.toHaveBeenCalled();
  });
});

describe("canRelocate", () => {
  it("allows one move per worktree and never a primary tree", () => {
    expect(canRelocate(WT)).toBe(true);
    expect(canRelocate({ ...WT, relocatedFrom: { repoPath: "/a", worktreePath: "/b", branch: "c" } })).toBe(false);
    expect(canRelocate({ ...WT, worktreePath: WT.repoPath })).toBe(false);
  });
});
