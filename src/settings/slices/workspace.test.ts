// workspace.test.ts — the on-screen arrangement slice: responsive column slots, view-dependent
// placement, scratch terminals, the session-only flag maps, and the ONE wiring test proving the store's
// private deduceSession port actually works (the chain's own sequence lives in deduceFlow.test.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));
// Mock the worktree IPC calls the deduce→create background chain makes.
vi.mock("../../worktrees/api", () => ({ deduceWorktree: vi.fn(), createWorktree: vi.fn() }));

import { useSettings } from "../store";
import { createWorktree, deduceWorktree, type DeducedWorktree } from "../../worktrees/api";
import { baseCockpit, resetStore, slotIds } from "./fixtures";

describe("column slots", () => {
  beforeEach(() => resetStore());

  it("addEmptySlot appends an empty column; setSlot fills it by key", () => {
    useSettings.getState().addEmptySlot();
    expect(slotIds()).toEqual([null]);
    const key = useSettings.getState().slots[0].key;
    useSettings.getState().setSlot(key, "wt-1");
    expect(slotIds()).toEqual(["wt-1"]);
  });

  it("addEmptySlot is a no-op at the 3-column cap", () => {
    const { addEmptySlot } = useSettings.getState();
    addEmptySlot(); addEmptySlot(); addEmptySlot(); addEmptySlot();
    expect(useSettings.getState().slots).toHaveLength(3);
  });

  it("removeSlot splices a column out and reflows", () => {
    resetStore({ slots: [{ key: "k1", id: "a" }, { key: "k2", id: "b" }], slotSeq: 2 });
    useSettings.getState().removeSlot("k1");
    expect(slotIds()).toEqual(["b"]);
  });

  it("swapSlots exchanges two columns' positions, keys travelling with them", () => {
    resetStore({ slots: [{ key: "k1", id: "a" }, { key: "k2", id: "b" }], slotSeq: 2 });
    useSettings.getState().swapSlots("k1", "k2");
    expect(useSettings.getState().slots).toEqual([{ key: "k2", id: "b" }, { key: "k1", id: "a" }]);
  });
});

describe("placeNewEntity — view-dependent placement", () => {
  beforeEach(() => resetStore());

  it("on the worktrees view fills the first empty slot; cockpit untouched", () => {
    resetStore({ slots: [{ key: "k1", id: "wt-1" }, { key: "k2", id: null }], slotSeq: 2 });
    useSettings.getState().placeNewEntity("wt-2", "worktrees");
    expect(slotIds()).toEqual(["wt-1", "wt-2"]);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("on the worktrees view appends a column when there is room", () => {
    resetStore({ slots: [{ key: "k1", id: "wt-1" }], slotSeq: 1 });
    useSettings.getState().placeNewEntity("wt-2", "worktrees");
    expect(slotIds()).toEqual(["wt-1", "wt-2"]);
  });

  it("on the worktrees view replaces the rightmost slot when full", () => {
    resetStore({ slots: [{ key: "k1", id: "a" }, { key: "k2", id: "b" }, { key: "k3", id: "c" }], slotSeq: 3 });
    useSettings.getState().placeNewEntity("d", "worktrees");
    expect(slotIds()).toEqual(["a", "b", "d"]);
  });

  it("on the cockpit view sets the cockpit slot and fills a free Worktrees slot", () => {
    resetStore({ slots: [{ key: "k1", id: "wt-1" }], slotSeq: 1 });
    useSettings.getState().placeNewEntity("wt-9", "cockpit");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-9");
    expect(slotIds()).toEqual(["wt-1", "wt-9"]);
  });

  it("on the cockpit view leaves the Worktrees view unchanged when full (no eviction)", () => {
    resetStore({ slots: [{ key: "k1", id: "a" }, { key: "k2", id: "b" }, { key: "k3", id: "c" }], slotSeq: 3 });
    useSettings.getState().placeNewEntity("wt-9", "cockpit");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-9");
    expect(slotIds()).toEqual(["a", "b", "c"]);
  });

  it("setCockpitWorktree sets and clears the persisted pin", () => {
    useSettings.getState().setCockpitWorktree("wt-5");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-5");
    useSettings.getState().setCockpitWorktree(null);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });
});

describe("scratch terminals", () => {
  beforeEach(() => resetStore());

  it("addScratch creates an entity without assigning a slot", () => {
    const id = useSettings.getState().addScratch();
    const st = useSettings.getState();
    expect(id).toBe("scratch-1");
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.slots).toEqual([]); // placement is placeNewEntity's job
  });

  it("removeScratch drops the entity and splices its slot (and the cockpit pin)", () => {
    const id = useSettings.getState().addScratch();
    useSettings.getState().placeNewEntity(id, "worktrees");
    useSettings.getState().setCockpitWorktree(id);
    useSettings.getState().removeScratch(id);
    const st = useSettings.getState();
    expect(st.scratchTerminals).toEqual([]);
    expect(st.slots).toEqual([]);
    expect(st.cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("renameScratch overwrites the matching terminal's title only", () => {
    const a = useSettings.getState().addScratch();
    const b = useSettings.getState().addScratch();
    useSettings.getState().renameScratch(a, "My shell");
    const list = useSettings.getState().scratchTerminals;
    expect(list.find((s) => s.id === a)?.title).toBe("My shell");
    expect(list.find((s) => s.id === b)?.title).toBe("Scratch 2");
  });
});

describe("session-only flag maps", () => {
  beforeEach(() => resetStore());

  it("markAttention sets, clearAttention removes, and clearing an unmarked pane is referentially a no-op", () => {
    useSettings.getState().markAttention("wt-1:claude");
    expect(useSettings.getState().attention).toEqual({ "wt-1:claude": true });
    const before = useSettings.getState().attention;
    useSettings.getState().clearAttention("wt-9:claude");
    expect(useSettings.getState().attention).toBe(before); // same object → no re-render
    useSettings.getState().clearAttention("wt-1:claude");
    expect(useSettings.getState().attention).toEqual({});
  });

  it("clearInitialPrompt removes the flag; no-op (same object) when absent", () => {
    resetStore({ initialPromptPending: { "wt-1": true } });
    useSettings.getState().clearInitialPrompt("wt-1");
    expect(useSettings.getState().initialPromptPending).toEqual({});
    const before = useSettings.getState().initialPromptPending;
    useSettings.getState().clearInitialPrompt("wt-ghost");
    expect(useSettings.getState().initialPromptPending).toBe(before);
  });

  it("clearRestored drops one flag and no-ops on an unflagged id", () => {
    resetStore({ restoredWorktrees: { "wt-1": true } });
    const before = useSettings.getState().restoredWorktrees;
    useSettings.getState().clearRestored("wt-9");
    expect(useSettings.getState().restoredWorktrees).toBe(before); // referentially unchanged
    useSettings.getState().clearRestored("wt-1");
    expect(useSettings.getState().restoredWorktrees).toEqual({});
  });

  it("clearWorktreeError nulls the field", () => {
    resetStore({ worktreeError: { prompt: "p", message: "m" } });
    useSettings.getState().clearWorktreeError();
    expect(useSettings.getState().worktreeError).toBeNull();
  });
});

describe("pane sets", () => {
  beforeEach(() => resetStore());

  it("runHostPane adds the host pane; addShellPane appends extras up to the cap", () => {
    useSettings.getState().runHostPane("wt-1");
    expect(useSettings.getState().worktreePanes["wt-1"].host).toBe(true);
    const { addShellPane } = useSettings.getState();
    addShellPane("wt-1"); addShellPane("wt-1"); addShellPane("wt-1"); // third exceeds MAX_EXTRAS
    expect(useSettings.getState().worktreePanes["wt-1"].extras).toEqual(["shell-1", "shell-2"]);
  });

  it("removeWorktreePane drops the host pane, toggle/expand drive collapse state", () => {
    useSettings.getState().runHostPane("wt-1");
    useSettings.getState().toggleWorktreePane("wt-1", "claude");
    expect(useSettings.getState().worktreePanes["wt-1"].open.claude).toBe(false);
    useSettings.getState().expandWorktreePane("wt-1", "claude");
    expect(useSettings.getState().worktreePanes["wt-1"].open).toEqual({ claude: true, host: false });
    useSettings.getState().removeWorktreePane("wt-1", "host");
    expect(useSettings.getState().worktreePanes["wt-1"].host).toBe(false);
  });

  it("resetWorktreePanes drops the entry; resetting an untouched worktree is a no-op", () => {
    const before = useSettings.getState().worktreePanes;
    useSettings.getState().resetWorktreePanes("wt-ghost");
    expect(useSettings.getState().worktreePanes).toBe(before);
    useSettings.getState().runHostPane("wt-1");
    useSettings.getState().resetWorktreePanes("wt-1");
    expect(useSettings.getState().worktreePanes).toEqual({});
  });
});

// The chain's own sequence is covered in worktrees/deduceFlow.test.ts against a fake session. This one
// test drives the REAL store, so the private deduceSession port implementation — the 14 single-step reads
// and writes the flow calls — is proven to actually work against zustand state.
describe("startDeduceWorktree — wiring to the real store", () => {
  const deduced: DeducedWorktree = {
    repoPath: "/a", name: "fix login", branch: "fix-login", base: "main",
    startCmd: "npm run dev", address: "http://localhost:3000", reason: "matched repo",
  };
  // flush(): let the fire-and-forget async chain settle (two awaited IPC calls).
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore({ cockpit: { ...structuredClone(baseCockpit), knownRepos: [{ path: "/a" }] } });
  });

  it("carries a deduction through to a placed worktree", async () => {
    vi.mocked(deduceWorktree).mockResolvedValue(deduced);
    vi.mocked(createWorktree).mockResolvedValue("/wt/fix-login");
    useSettings.getState().startDeduceWorktree("fix the login bug", "cockpit", "pr-review");
    // Placed synchronously, on both slot surfaces, before the chain awaits anything.
    expect(useSettings.getState().pendingWorktrees).toEqual([
      { id: "pending-1", prompt: "fix the login bug", status: "deducing", view: "cockpit" },
    ]);
    expect(slotIds()).toEqual(["pending-1"]);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("pending-1");

    await flush();

    const st = useSettings.getState();
    const wt = st.cockpit.worktrees[0];
    expect(st.pendingWorktrees).toEqual([]);
    expect(wt.id).toMatch(/^wt-/);
    expect(wt.worktreePath).toBe("/wt/fix-login");
    expect(slotIds()).toEqual([wt.id]); // swapped in place, same column
    expect(st.cockpit.cockpitWorktreeId).toBe(wt.id);
    expect(st.initialPromptPending[wt.id]).toBe(true);
    expect(wt.prompt).toBe("use the /code-review tool to review this PR\n\nfix the login bug");
    expect(deduceWorktree).toHaveBeenCalledWith("fix the login bug", ["/a"]); // deduce got the bare input
    expect(st.worktreeError).toBeNull();
  });
});
