// teardown.test.ts — the cumulative teardown sequence: ordering, what each action runs, error handling.
// Which pane roles are live is not this module's concern (see paneLifecycle.test.ts) — the kill arrives
// as an injected thunk, so no store and no PTY mock are in the graph.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared ordered call log so we can assert the PTY kill precedes the git remove.
const calls: string[] = [];

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

import { teardownWorktree, type TeardownDeps } from "./teardown";
import { removeWorktreeGit, deleteBranch } from "./api";

const WT = { id: "wt-1", repoPath: "/r", worktreePath: "/wt", branch: "feat/x" };

// A fresh deps pair per test: the kill logs, the model write is a spy the test can assert on.
const deps = (over: Partial<TeardownDeps> = {}) => {
  const removeModel = vi.fn();
  return {
    removeModel,
    deps: {
      killPtys: () => {
        calls.push("kill");
        return Promise.resolve();
      },
      removeModel,
      ...over,
    } satisfies TeardownDeps,
  };
};

beforeEach(() => {
  calls.length = 0;
  // Re-install the logging implementations (mockClear keeps them; a per-test mockRejectedValueOnce
  // overrides for exactly one call).
  vi.mocked(removeWorktreeGit).mockClear();
  vi.mocked(deleteBranch).mockClear();
});

describe("teardownWorktree", () => {
  it("kills the worktree's PTYs before removing the worktree", async () => {
    await teardownWorktree(WT, { wipe: false, force: false }, deps().deps);
    expect(calls).toEqual(["kill", "remove"]);
  });

  // The dir must be free before git touches it, so a failed kill aborts the whole teardown.
  it("a failed kill propagates and never reaches the git remove", async () => {
    const { removeModel, deps: d } = deps({ killPtys: () => Promise.reject("kill boom") });
    await expect(teardownWorktree(WT, { wipe: false, force: false }, d)).rejects.toBe("kill boom");
    expect(removeWorktreeGit).not.toHaveBeenCalled();
    expect(removeModel).not.toHaveBeenCalled();
  });

  it("delete (wipe:false) never deletes the branch and drops the model once", async () => {
    const { removeModel, deps: d } = deps();
    const warning = await teardownWorktree(WT, { wipe: false, force: false }, d);
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(removeModel).toHaveBeenCalledExactlyOnceWith("wt-1");
    expect(warning).toBeNull();
  });

  it("wipe success deletes the branch, returns null, and drops the model", async () => {
    const { removeModel, deps: d } = deps();
    const warning = await teardownWorktree(WT, { wipe: true, force: false }, d);
    expect(deleteBranch).toHaveBeenCalledWith("/r", "feat/x");
    expect(warning).toBeNull();
    expect(removeModel).toHaveBeenCalledExactlyOnceWith("wt-1");
  });

  it("wipe with branch-delete failure returns a warning but still drops the model", async () => {
    vi.mocked(deleteBranch).mockRejectedValueOnce("not fully merged");
    const { removeModel, deps: d } = deps();
    const warning = await teardownWorktree(WT, { wipe: true, force: false }, d);
    expect(warning).toContain("branch could not be deleted");
    expect(removeModel).toHaveBeenCalledExactlyOnceWith("wt-1");
  });

  it("remove failure does NOT drop the model and propagates", async () => {
    vi.mocked(removeWorktreeGit).mockRejectedValueOnce("worktree is dirty");
    const { removeModel, deps: d } = deps();
    await expect(teardownWorktree(WT, { wipe: false, force: false }, d)).rejects.toBe("worktree is dirty");
    expect(removeModel).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("threads the force flag through to removeWorktreeGit", async () => {
    await teardownWorktree(WT, { wipe: false, force: true }, deps().deps);
    expect(removeWorktreeGit).toHaveBeenCalledWith("/r", "/wt", true);
  });
});
