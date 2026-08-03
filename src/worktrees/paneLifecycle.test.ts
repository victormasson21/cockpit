// paneLifecycle.test.ts — the stopping sequences: what runs in what order, and that a failed kill
// never strands a visible pane. Deps are injected, so no store and no module mocks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { killPanes, closePane, type PaneDeps } from "./paneLifecycle";

const calls: string[] = [];
let killFails = false;

const deps = (): PaneDeps => ({
  pane: (worktreeId, role) => ({
    id: `${worktreeId}:${role}`,
    kill: () => {
      calls.push(`kill:${worktreeId}:${role}`);
      return killFails ? Promise.reject("kill boom") : Promise.resolve();
    },
  }),
  clearAttention: (ptyId) => calls.push(`clearAttention:${ptyId}`),
  removePane: (worktreeId, role) => calls.push(`removePane:${worktreeId}:${role}`),
});

beforeEach(() => {
  calls.length = 0;
  killFails = false;
});

describe("killPanes", () => {
  it("clears the attention mark before killing each role", async () => {
    await killPanes("wt-1", ["claude"], deps());
    expect(calls).toEqual(["clearAttention:wt-1:claude", "kill:wt-1:claude"]);
  });

  it("walks every live role in order", async () => {
    await killPanes("wt-1", ["claude", "host", "shell-2"], deps());
    expect(calls.filter((c) => c.startsWith("kill:"))).toEqual([
      "kill:wt-1:claude", "kill:wt-1:host", "kill:wt-1:shell-2",
    ]);
  });

  it("takes any id, so a scratch terminal's single shell goes through the same path", async () => {
    await killPanes("scratch-3", ["shell"], deps());
    expect(calls).toEqual(["clearAttention:scratch-3:shell", "kill:scratch-3:shell"]);
  });

  // Teardown must not reach `git worktree remove` while a process still holds the directory.
  it("propagates a kill failure and stops walking", async () => {
    killFails = true;
    await expect(killPanes("wt-1", ["claude", "host"], deps())).rejects.toBe("kill boom");
    expect(calls.filter((c) => c.startsWith("kill:"))).toEqual(["kill:wt-1:claude"]);
  });

  it("does not remove panes — dropping them from the column is closePane's job", async () => {
    await killPanes("wt-1", ["host"], deps());
    expect(calls.some((c) => c.startsWith("removePane"))).toBe(false);
  });
});

describe("closePane", () => {
  // The host role reuses a fixed pty id: dropping the pane before the kill lands lets a re-Run
  // reattach the still-alive entry, which the lagging kill then removes.
  it("kills before it drops the pane", async () => {
    await closePane("wt-1", "host", deps());
    expect(calls).toEqual(["clearAttention:wt-1:host", "kill:wt-1:host", "removePane:wt-1:host"]);
  });

  // A pane left on screen with no process behind it blinks a cursor and eats keystrokes silently.
  it("still drops the pane when the kill fails", async () => {
    killFails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await closePane("wt-1", "shell-1", deps());
    expect(calls).toEqual(["clearAttention:wt-1:shell-1", "kill:wt-1:shell-1", "removePane:wt-1:shell-1"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
