// teardown.test.ts — the cumulative teardown sequence: ordering, what each action runs, error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared ordered call log so we can assert PTY kills precede the git remove.
const calls: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((_cmd: string, args: { ptyId: string }) => {
    calls.push(`pty_kill:${args.ptyId}`);
    return Promise.resolve();
  }),
}));
vi.mock("./api", () => ({
  removeWorktreeGit: vi.fn(() => {
    calls.push("remove");
    return Promise.resolve();
  }),
  deleteBranch: vi.fn(() => {
    calls.push("deleteBranch");
    return Promise.resolve();
  }),
}));

import { teardownWorktree } from "./teardown";
import { removeWorktreeGit, deleteBranch } from "./api";

const WT = { id: "wt-1", repoPath: "/r", worktreePath: "/wt", branch: "feat/x" };

beforeEach(() => {
  calls.length = 0;
  // Re-install the logging implementations (mockClear keeps them; a per-test mockRejectedValueOnce
  // overrides for exactly one call).
  vi.mocked(removeWorktreeGit).mockClear();
  vi.mocked(deleteBranch).mockClear();
});

describe("teardownWorktree", () => {
  it("kills all 3 PTYs before removing the worktree", async () => {
    const removeModel = vi.fn();
    await teardownWorktree(WT, { wipe: false, force: false }, removeModel);
    expect(calls).toEqual(["pty_kill:wt-1:git", "pty_kill:wt-1:host", "pty_kill:wt-1:claude", "remove"]);
  });

  it("delete (wipe:false) never deletes the branch and drops the model once", async () => {
    const removeModel = vi.fn();
    const warning = await teardownWorktree(WT, { wipe: false, force: false }, removeModel);
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(removeModel).toHaveBeenCalledExactlyOnceWith("wt-1");
    expect(warning).toBeNull();
  });

  it("wipe success deletes the branch, returns null, and drops the model", async () => {
    const removeModel = vi.fn();
    const warning = await teardownWorktree(WT, { wipe: true, force: false }, removeModel);
    expect(deleteBranch).toHaveBeenCalledWith("/r", "feat/x");
    expect(warning).toBeNull();
    expect(removeModel).toHaveBeenCalledExactlyOnceWith("wt-1");
  });

  it("wipe with branch-delete failure returns a warning but still drops the model", async () => {
    vi.mocked(deleteBranch).mockRejectedValueOnce("not fully merged");
    const removeModel = vi.fn();
    const warning = await teardownWorktree(WT, { wipe: true, force: false }, removeModel);
    expect(warning).toContain("branch could not be deleted");
    expect(removeModel).toHaveBeenCalledExactlyOnceWith("wt-1");
  });

  it("remove failure does NOT drop the model and propagates", async () => {
    vi.mocked(removeWorktreeGit).mockRejectedValueOnce("worktree is dirty");
    const removeModel = vi.fn();
    await expect(teardownWorktree(WT, { wipe: false, force: false }, removeModel)).rejects.toBe("worktree is dirty");
    expect(removeModel).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("threads the force flag through to removeWorktreeGit", async () => {
    await teardownWorktree(WT, { wipe: false, force: true }, vi.fn());
    expect(removeWorktreeGit).toHaveBeenCalledWith("/r", "/wt", true);
  });
});
