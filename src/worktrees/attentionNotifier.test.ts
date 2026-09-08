// attentionNotifier.test.ts — turning the session-only attention map into desktop notifications:
// which marks are new, what they are called, and when a notification is actually warranted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../settings/api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));
import { attentionLabel, newlyMarked, notifyAttention, startAttentionNotifier } from "./attentionNotifier";
import { useSettings } from "../settings/store";
import { baseCockpit, resetStore } from "../settings/slices/fixtures";
import type { Worktree } from "../settings/types";

describe("newlyMarked", () => {
  it("returns only the ptyIds added since the previous snapshot", () => {
    const prev = { "wt-1:claude": true } as const;
    const next = { "wt-1:claude": true, "wt-2:claude": true } as const;
    expect(newlyMarked(prev, next)).toEqual(["wt-2:claude"]);
  });

  it("returns nothing when an already-marked pane bells again", () => {
    const marked = { "wt-1:claude": true } as const;
    expect(newlyMarked(marked, marked)).toEqual([]);
  });

  it("treats a cleared-then-remarked pane as new", () => {
    expect(newlyMarked({ "wt-1:claude": true }, {})).toEqual([]);
    expect(newlyMarked({}, { "wt-1:claude": true })).toEqual(["wt-1:claude"]);
  });
});

const wt = (id: string, name: string): Worktree => ({
  id, name, repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status: "ongoing",
});

describe("attentionLabel", () => {
  const worktrees = [wt("wt-1", "auth0-provisioning")];
  const scratch = [{ id: "scratch-1", title: "notes" }];

  it("names a worktree's claude pane by the worktree alone", () => {
    expect(attentionLabel("wt-1:claude", worktrees, scratch)).toBe("auth0-provisioning");
  });

  it("appends the role for a worktree's extra shell, which claude does not need", () => {
    expect(attentionLabel("wt-1:shell-2", worktrees, scratch)).toBe("auth0-provisioning \u00b7 shell-2");
  });

  it("names a scratch terminal by its title", () => {
    expect(attentionLabel("scratch-1:shell", worktrees, scratch)).toBe("notes");
  });

  it("falls back to the raw ptyId when the entity is already gone", () => {
    expect(attentionLabel("wt-gone:claude", worktrees, scratch)).toBe("wt-gone:claude");
  });
});

// A recording stand-in for the three OS-facing calls, so the decision logic is tested without mocking
// the Tauri plugin itself. Tests that need different behaviour re-arm the mock they care about.
function ports() {
  return {
    isFocused: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    notify: vi.fn<(title: string, body: string) => Promise<void>>().mockResolvedValue(undefined),
    bounce: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe("notifyAttention", () => {
  it("sends one Check me out notification per newly marked pane", async () => {
    const p = ports();
    await notifyAttention(["auth0-provisioning", "notes"], p, true);
    expect(p.notify.mock.calls).toEqual([
      ["Check me out", "auth0-provisioning"],
      ["Check me out", "notes"],
    ]);
  });

  it("bounces the Dock once, however many panes bell together", async () => {
    const p = ports();
    await notifyAttention(["a", "b", "c"], p, true);
    expect(p.bounce).toHaveBeenCalledTimes(1);
  });

  it("stays silent when cockpit is focused — the on-screen glow already says it", async () => {
    const p = ports();
    p.isFocused.mockResolvedValue(true);
    await notifyAttention(["auth0-provisioning"], p, true);
    expect(p.notify).not.toHaveBeenCalled();
    expect(p.bounce).not.toHaveBeenCalled();
  });

  it("stays silent when the setting is off, without asking the window anything", async () => {
    const p = ports();
    await notifyAttention(["auth0-provisioning"], p, false);
    expect(p.notify).not.toHaveBeenCalled();
    expect(p.isFocused).not.toHaveBeenCalled();
  });

  it("does nothing at all when no pane was newly marked", async () => {
    const p = ports();
    await notifyAttention([], p, true);
    expect(p.isFocused).not.toHaveBeenCalled();
    expect(p.bounce).not.toHaveBeenCalled();
  });

  it("still notifies the remaining panes when one notification throws", async () => {
    const p = ports();
    p.notify.mockRejectedValueOnce(new Error("notification centre unavailable"));
    await expect(notifyAttention(["a", "b"], p, true)).resolves.toBeUndefined();
    expect(p.notify).toHaveBeenCalledTimes(2);
  });
});

// The wiring test: the real store, a real bell-shaped state change, stand-ins only for the OS.
describe("startAttentionNotifier", () => {
  let stop: () => void;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => resetStore({ cockpit: { ...structuredClone(baseCockpit), worktrees: [wt("wt-1", "auth0-provisioning")] } }));
  afterEach(() => stop?.());

  it("notifies with the worktree's name when a pane is marked", async () => {
    const p = ports();
    stop = startAttentionNotifier(p);
    useSettings.getState().markAttention("wt-1:claude");
    await flush();
    expect(p.notify).toHaveBeenCalledWith("Check me out", "auth0-provisioning");
  });

  it("does not notify again while the same pane stays marked", async () => {
    const p = ports();
    stop = startAttentionNotifier(p);
    useSettings.getState().markAttention("wt-1:claude");
    await flush();
    useSettings.getState().markAttention("wt-1:claude");
    await flush();
    expect(p.notify).toHaveBeenCalledTimes(1);
  });

  it("notifies again after the pane is cleared and bells afresh", async () => {
    const p = ports();
    stop = startAttentionNotifier(p);
    useSettings.getState().markAttention("wt-1:claude");
    await flush();
    useSettings.getState().clearAttention("wt-1:claude");
    await flush();
    useSettings.getState().markAttention("wt-1:claude");
    await flush();
    expect(p.notify).toHaveBeenCalledTimes(2);
  });

  it("ignores unrelated store writes", async () => {
    const p = ports();
    stop = startAttentionNotifier(p);
    useSettings.getState().addScratch();
    await flush();
    expect(p.isFocused).not.toHaveBeenCalled();
  });

  it("stops notifying once unsubscribed", async () => {
    const p = ports();
    stop = startAttentionNotifier(p);
    stop();
    useSettings.getState().markAttention("wt-1:claude");
    await flush();
    expect(p.notify).not.toHaveBeenCalled();
  });
});
