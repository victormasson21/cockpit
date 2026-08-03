// store.test.ts — regression: two settings writes in one tick must compose, not clobber (the worktree-create bug).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettings, clampZoom, ZOOM_MIN, ZOOM_MAX } from "./store";
import type { CockpitConfig, Worktree } from "./types";

// Mock the IPC layer so the debounced save never reaches Tauri in tests.
vi.mock("./api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));
import { saveSettings } from "./api";
// Mock the worktree IPC calls the deduce→create background chain makes.
vi.mock("../worktrees/api", () => ({ deduceWorktree: vi.fn(), createWorktree: vi.fn() }));
import { deduceWorktree, createWorktree } from "../worktrees/api";
import type { DeducedWorktree } from "../worktrees/api";

const baseCockpit: CockpitConfig = {
  version: 1,
  tiles: [{ id: "worktree-1", type: "worktree", config: {} }],
  worktrees: [],
  knownRepos: [],
  todos: [],
  todoLists: [],
  preferences: { theme: "system", defaultView: "worktrees" },
};

// slotIds: compare a keyed Slots array by its ids, ignoring the (opaque) per-column keys.
const slotIds = () => useSettings.getState().slots.map((s) => s.id);

const sampleWt: Worktree = {
  id: "wt-1", name: "n", repoPath: "/r", branch: "b", worktreePath: "/wt",
  host: { startCmd: "x", address: "y" }, links: [], status: "ongoing",
};

describe("settings store — writes compose without clobber", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true });
  });

  // Reproduces NewWorktreeForm.submit: add the model, then synchronously set the tile's config.
  // Before the fix, the second (snapshot-based) write clobbered the first, leaving worktrees: [].
  it("addWorktree then a functional tile-config write both persist", () => {
    const s = useSettings.getState();
    s.addWorktree(sampleWt);
    s.setCockpit((c) => ({
      ...c,
      tiles: c.tiles.map((t) => (t.id === "worktree-1" ? { ...t, config: { worktreeId: "wt-1" } } : t)),
    }));
    const after = useSettings.getState().cockpit;
    expect(after.worktrees).toHaveLength(1);
    expect(after.worktrees[0].id).toBe("wt-1");
    expect(after.tiles[0].config).toEqual({ worktreeId: "wt-1" });
  });
});

describe("knownRepos actions", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true });
  });

  it("addKnownRepo appends a { path } object", () => {
    useSettings.getState().addKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/a" }]);
  });
  it("addKnownRepo is idempotent by path", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().addKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/a" }]);
  });
  it("removeKnownRepo drops only the matching entry", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().addKnownRepo("/b");
    useSettings.getState().removeKnownRepo("/a");
    expect(useSettings.getState().cockpit.knownRepos).toEqual([{ path: "/b" }]);
  });
  it("setRepoHost sets the host on the matching entry", () => {
    useSettings.getState().addKnownRepo("/a");
    useSettings.getState().setRepoHost("/a", { startCmd: "pnpm start", address: "http://localhost:2000" });
    expect(useSettings.getState().cockpit.knownRepos[0].host).toEqual({
      startCmd: "pnpm start",
      address: "http://localhost:2000",
    });
  });
});

describe("worktree slots (session state)", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true, slots: [], slotSeq: 0, scratchTerminals: [], scratchSeq: 0 });
  });

  it("init seeds one column per ongoing worktree (first 3), each with a key", () => {
    const w = (id: string, status: "ongoing" | "completed" = "ongoing"): Worktree => ({ ...sampleWt, id, status });
    useSettings.getState().init({
      cockpit: { ...baseCockpit, worktrees: [w("done", "completed"), w("a"), w("b"), w("c"), w("d")] },
      layout: { version: 1, views: {} },
    });
    expect(slotIds()).toEqual(["a", "b", "c"]);
    expect(useSettings.getState().slots.every((s) => typeof s.key === "string")).toBe(true);
    expect(useSettings.getState().slotSeq).toBe(3);
  });

  it("addEmptySlot appends an empty column; setSlot fills it by key", () => {
    useSettings.getState().addEmptySlot();
    expect(slotIds()).toEqual([null]);
    const key = useSettings.getState().slots[0].key;
    useSettings.getState().setSlot(key, "wt-1");
    expect(slotIds()).toEqual(["wt-1"]);
  });

  it("addEmptySlot is a no-op at the 3-column cap", () => {
    useSettings.getState().addEmptySlot();
    useSettings.getState().addEmptySlot();
    useSettings.getState().addEmptySlot();
    useSettings.getState().addEmptySlot();
    expect(useSettings.getState().slots).toHaveLength(3);
  });

  it("removeSlot splices a column out and reflows", () => {
    useSettings.getState().init({ cockpit: { ...baseCockpit, worktrees: [{ ...sampleWt, id: "a" }, { ...sampleWt, id: "b" }] }, layout: { version: 1, views: {} } });
    const key = useSettings.getState().slots[0].key;
    useSettings.getState().removeSlot(key);
    expect(slotIds()).toEqual(["b"]);
  });

  it("placeNewEntity on worktrees view fills the first empty slot; cockpit untouched", () => {
    useSettings.setState({ slots: [{ key: "k1", id: "wt-1" }, { key: "k2", id: null }], slotSeq: 2 });
    useSettings.getState().placeNewEntity("wt-2", "worktrees");
    expect(slotIds()).toEqual(["wt-1", "wt-2"]);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("placeNewEntity on worktrees view appends a column when there is room", () => {
    useSettings.setState({ slots: [{ key: "k1", id: "wt-1" }], slotSeq: 1 });
    useSettings.getState().placeNewEntity("wt-2", "worktrees");
    expect(slotIds()).toEqual(["wt-1", "wt-2"]);
  });

  it("placeNewEntity on worktrees view replaces the rightmost slot when full", () => {
    useSettings.setState({ slots: [{ key: "k1", id: "a" }, { key: "k2", id: "b" }, { key: "k3", id: "c" }], slotSeq: 3 });
    useSettings.getState().placeNewEntity("d", "worktrees");
    expect(slotIds()).toEqual(["a", "b", "d"]);
  });

  it("placeNewEntity on cockpit view sets the cockpit slot and fills a free Worktrees slot", () => {
    useSettings.setState({ slots: [{ key: "k1", id: "wt-1" }], slotSeq: 1, cockpit: structuredClone(baseCockpit) });
    useSettings.getState().placeNewEntity("wt-9", "cockpit");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-9");
    expect(slotIds()).toEqual(["wt-1", "wt-9"]);
  });

  it("placeNewEntity on cockpit view leaves the Worktrees view unchanged when full (no eviction)", () => {
    useSettings.setState({ slots: [{ key: "k1", id: "a" }, { key: "k2", id: "b" }, { key: "k3", id: "c" }], slotSeq: 3, cockpit: structuredClone(baseCockpit) });
    useSettings.getState().placeNewEntity("wt-9", "cockpit");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-9");
    expect(slotIds()).toEqual(["a", "b", "c"]);
  });

  it("setCockpitWorktree sets and clears the persisted slot", () => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit) });
    useSettings.getState().setCockpitWorktree("wt-5");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBe("wt-5");
    useSettings.getState().setCockpitWorktree(null);
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("removeWorktree splices it out of its slot (reflow)", () => {
    useSettings.setState({ cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt] }, slots: [{ key: "k1", id: "wt-1" }] });
    useSettings.getState().removeWorktree("wt-1");
    expect(slotIds()).toEqual([]);
    expect(useSettings.getState().cockpit.worktrees).toHaveLength(0);
  });

  it("removeWorktree clears it from the cockpit slot too", () => {
    useSettings.setState({ cockpit: { ...structuredClone(baseCockpit), worktrees: [sampleWt], cockpitWorktreeId: "wt-1" }, slots: [{ key: "k1", id: "wt-1" }] });
    useSettings.getState().removeWorktree("wt-1");
    expect(useSettings.getState().cockpit.cockpitWorktreeId).toBeUndefined();
  });

  it("addScratch creates a scratch entity without assigning a slot", () => {
    const id = useSettings.getState().addScratch();
    const st = useSettings.getState();
    expect(id).toBe("scratch-1");
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.slots).toEqual([]); // placement is placeNewEntity's job now
  });

  it("removeScratch drops the entity and splices its slot (and the cockpit slot)", () => {
    const id = useSettings.getState().addScratch();
    useSettings.getState().placeNewEntity(id, "worktrees");
    useSettings.getState().setCockpitWorktree(id);
    useSettings.getState().removeScratch(id);
    const st = useSettings.getState();
    expect(st.scratchTerminals).toEqual([]);
    expect(st.slots).toEqual([]);
    expect(st.cockpit.cockpitWorktreeId).toBeUndefined();
  });
});

describe("text zoom", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true, fontScale: 1 });
  });

  it("clampZoom bounds and quantises to the 0.1 grid", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(1.24)).toBe(1.2); // rounds to grid
  });

  it("setFontScale clamps and persists into preferences", () => {
    useSettings.getState().setFontScale(1.5);
    expect(useSettings.getState().fontScale).toBe(1.5);
    expect(useSettings.getState().cockpit.preferences.fontScale).toBe(1.5);
    useSettings.getState().setFontScale(99);
    expect(useSettings.getState().fontScale).toBe(ZOOM_MAX);
  });

  it("zoomIn / zoomOut step by 0.1 and stay on grid across repeats", () => {
    const s = useSettings.getState();
    s.zoomIn(); // 1.1
    s.zoomIn(); // 1.2
    expect(useSettings.getState().fontScale).toBe(1.2);
    s.zoomOut(); s.zoomOut(); s.zoomOut(); // 0.9
    expect(useSettings.getState().fontScale).toBe(0.9);
  });

  it("resetZoom returns to 1", () => {
    useSettings.getState().setFontScale(1.6);
    useSettings.getState().resetZoom();
    expect(useSettings.getState().fontScale).toBe(1);
  });

  it("init seeds fontScale from preferences (clamped)", () => {
    useSettings.getState().init({
      cockpit: { ...baseCockpit, preferences: { ...baseCockpit.preferences, fontScale: 1.4 } },
      layout: { version: 1, views: {} },
    });
    expect(useSettings.getState().fontScale).toBe(1.4);
  });

  it("init defaults fontScale to 1 when absent (back-compat)", () => {
    useSettings.getState().init({ cockpit: baseCockpit, layout: { version: 1, views: {} } });
    expect(useSettings.getState().fontScale).toBe(1);
  });
});

describe("PR reviews actions", () => {
  const item = (id: string, url: string) => ({
    id, url, repo: "web-app", number: 1, title: "t", author: "a", ts: id,
  });

  beforeEach(() => {
    useSettings.setState({
      cockpit: {
        ...structuredClone(baseCockpit),
        integrations: { slack: { clientId: "c1", watchedChannelIds: ["C0"] } },
      },
      layout: { version: 1, views: {} }, loaded: true,
    });
  });

  it("setPrChannel sets the channel, clears the cursor, keeps items and the slack sibling", () => {
    useSettings.setState((st) => ({
      cockpit: { ...st.cockpit, integrations: { ...st.cockpit.integrations, prReviews: { channelId: "C1", lastSeenTs: "9.9", items: [item("1", "u1")] } } },
    }));
    useSettings.getState().setPrChannel("C2");
    const c = useSettings.getState().cockpit;
    expect(c.integrations?.prReviews).toEqual({ channelId: "C2", items: [item("1", "u1")] });
    expect(c.integrations?.slack?.clientId).toBe("c1");
  });

  it("setPrChannel(null) clears the channel", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().setPrChannel(null);
    expect(useSettings.getState().cockpit.integrations?.prReviews?.channelId).toBeUndefined();
  });

  it("applyPrFetch merges new items on top and advances the cursor", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().applyPrFetch([item("2", "u2")], "2");
    useSettings.getState().applyPrFetch([item("3", "u3")], "3");
    const pr = useSettings.getState().cockpit.integrations?.prReviews;
    expect(pr?.items.map((i) => i.id)).toEqual(["3", "2"]);
    expect(pr?.lastSeenTs).toBe("3");
  });

  it("applyPrFetch without a newestTs keeps the existing cursor", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().applyPrFetch([item("2", "u2")], "2");
    useSettings.getState().applyPrFetch([], undefined);
    expect(useSettings.getState().cockpit.integrations?.prReviews?.lastSeenTs).toBe("2");
  });

  it("removePrItem drops only the matching item", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().applyPrFetch([item("2", "u2"), item("1", "u1")], "2");
    useSettings.getState().removePrItem("1");
    expect(useSettings.getState().cockpit.integrations?.prReviews?.items.map((i) => i.id)).toEqual(["2"]);
  });
});

// The deduce→create background chain: a pending tile is placed immediately, then swapped for the
// real worktree on success or discarded (with worktreeError set) on failure.
describe("startDeduceWorktree — pending worktree flow", () => {
  const deduced: DeducedWorktree = {
    repoPath: "/a", name: "fix login", branch: "fix-login", base: "main",
    startCmd: "npm run dev", address: "http://localhost:3000", reason: "matched repo",
  };
  // flush(): let the fire-and-forget async chain settle (two awaited IPC calls).
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    vi.clearAllMocks();
    useSettings.setState({
      cockpit: { ...structuredClone(baseCockpit), knownRepos: [{ path: "/a" }] },
      layout: { version: 1, views: {} }, loaded: true,
      slots: [], slotSeq: 0, scratchTerminals: [], scratchSeq: 0,
      pendingWorktrees: [], pendingSeq: 0, worktreeError: null, initialPromptPending: {},
    });
  });

  // Wiring check: the sequence itself is covered in worktrees/deduceFlow.test.ts against a fake session.
  // This one test drives the REAL store, so the private deduceSession port implementation — the ~10
  // single-step reads and writes the flow calls — is proven to actually work against zustand state.
  it("wiring: the real store's session port carries a deduction through to a placed worktree", async () => {
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

  it("clearInitialPrompt removes the flag; no-op (same object) when absent", () => {
    useSettings.setState({ initialPromptPending: { "wt-1": true } });
    useSettings.getState().clearInitialPrompt("wt-1");
    expect(useSettings.getState().initialPromptPending).toEqual({});
    const before = useSettings.getState().initialPromptPending;
    useSettings.getState().clearInitialPrompt("wt-ghost");
    expect(useSettings.getState().initialPromptPending).toBe(before);
  });

  it("clearWorktreeError nulls the field", () => {
    useSettings.setState({ worktreeError: { prompt: "p", message: "m" } });
    useSettings.getState().clearWorktreeError();
    expect(useSettings.getState().worktreeError).toBeNull();
  });
});

describe("session restore", () => {
  const layout = { version: 1, views: {} };
  const three: Worktree[] = [sampleWt, { ...sampleWt, id: "wt-2" }, { ...sampleWt, id: "wt-3" }];

  // The store is module-global and `init` only writes the keys its branch owns — the fallback branch
  // deliberately leaves scratch/panes/restored alone. Reset here or an earlier test leaks into the next.
  beforeEach(() => {
    useSettings.setState({
      slots: [], slotSeq: 0, scratchTerminals: [], scratchSeq: 0,
      worktreePanes: {}, restoredWorktrees: {},
    });
  });

  it("init restores the persisted arrangement instead of the first-ongoing default", () => {
    const cockpit: CockpitConfig = {
      ...structuredClone(baseCockpit),
      worktrees: three,
      workspace: {
        slots: ["wt-3", null],
        scratch: [{ id: "scratch-1", title: "Scratch 1" }],
        scratchSeq: 1,
        panes: { "wt-3": { host: true, extras: [], seq: 0, open: {} } },
      },
    };
    useSettings.getState().init({ cockpit, layout });
    const st = useSettings.getState();
    expect(slotIds()).toEqual(["wt-3", null]);
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.worktreePanes["wt-3"].host).toBe(true);
    expect(st.restoredWorktrees).toEqual({ "wt-3": true });
  });

  it("init falls back to the first ongoing worktrees when the file has no workspace block", () => {
    const cockpit: CockpitConfig = { ...structuredClone(baseCockpit), worktrees: three };
    useSettings.getState().init({ cockpit, layout });
    expect(slotIds()).toEqual(["wt-1", "wt-2", "wt-3"]);
    expect(useSettings.getState().restoredWorktrees).toEqual({});
  });

  it("clearRestored drops one flag and no-ops on an unflagged id", () => {
    useSettings.setState({ restoredWorktrees: { "wt-1": true } });
    const before = useSettings.getState().restoredWorktrees;
    useSettings.getState().clearRestored("wt-9");
    expect(useSettings.getState().restoredWorktrees).toBe(before); // referentially unchanged
    useSettings.getState().clearRestored("wt-1");
    expect(useSettings.getState().restoredWorktrees).toEqual({});
  });

  // A session-only change (no setCockpit call) must still reach disk, or the arrangement is lost.
  it("a slots-only change schedules a save carrying the workspace block", () => {
    vi.useFakeTimers();
    vi.mocked(saveSettings).mockClear();
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout });
    useSettings.getState().addEmptySlot();
    vi.advanceTimersByTime(600);
    // tsconfig's lib target (ES2020) predates Array.prototype.at; index from the end instead.
    const calls = vi.mocked(saveSettings).mock.calls;
    const written = calls[calls.length - 1][0];
    expect(written.cockpit.workspace).toEqual({ slots: [null], scratch: [], scratchSeq: 0, panes: {} });
    vi.useRealTimers();
  });

  it("setDefaultView persists the active view as the launch view", () => {
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout });
    useSettings.getState().setDefaultView("cockpit");
    expect(useSettings.getState().cockpit.preferences.defaultView).toBe("cockpit");
  });
});

describe("renameScratch", () => {
  beforeEach(() => {
    useSettings.setState({ scratchTerminals: [], scratchSeq: 0 });
  });
  it("overwrites the matching scratch terminal's title only", () => {
    const a = useSettings.getState().addScratch();
    const b = useSettings.getState().addScratch();
    useSettings.getState().renameScratch(a, "My shell");
    const list = useSettings.getState().scratchTerminals;
    expect(list.find((s) => s.id === a)?.title).toBe("My shell");
    expect(list.find((s) => s.id === b)?.title).toBe("Scratch 2");
  });
});

describe("todo list (tab) actions", () => {
  beforeEach(() => {
    useSettings.setState({ cockpit: structuredClone(baseCockpit), layout: { version: 1, views: {} }, loaded: true });
  });

  // The load-bearing case: adding the first tab must materialise "General" too, or every pre-tabs item
  // would silently jump into the new tab (listIdOf falls back to lists[0]).
  it("addTodoList on a pre-tabs config materialises General first, keeping legacy items in it", () => {
    useSettings.setState((st) => ({
      cockpit: { ...st.cockpit, todos: [{ id: "old", text: "legacy", state: "todo" }] },
    }));
    const newId = useSettings.getState().addTodoList("Work");
    const c = useSettings.getState().cockpit;
    expect(c.todoLists.map((l) => l.name)).toEqual(["General", "Work"]);
    expect(c.todoLists[0].id).toBe("default");
    expect(c.activeTodoList).toBe(newId);
    // the legacy item still has no listId, and still resolves to General
    expect(c.todos[0].listId).toBeUndefined();
  });

  it("addTodoList switches to the new list and returns its id", () => {
    const a = useSettings.getState().addTodoList("Work");
    const b = useSettings.getState().addTodoList("Cockpit");
    const c = useSettings.getState().cockpit;
    expect(c.todoLists.map((l) => l.name)).toEqual(["General", "Work", "Cockpit"]);
    expect(c.activeTodoList).toBe(b);
    expect(a).not.toBe(b);
  });

  it("addTodo stamps the active list", () => {
    const work = useSettings.getState().addTodoList("Work");
    useSettings.getState().addTodo("ship it");
    const todos = useSettings.getState().cockpit.todos;
    expect(todos).toHaveLength(1);
    expect(todos[0].listId).toBe(work);
  });

  it("addTodo on a pre-tabs config materialises General and stamps it", () => {
    useSettings.getState().addTodo("ship it");
    const c = useSettings.getState().cockpit;
    expect(c.todoLists).toEqual([{ id: "default", name: "General" }]);
    expect(c.todos[0].listId).toBe("default");
  });

  it("renameTodoList trims and saves", () => {
    const id = useSettings.getState().addTodoList("Work");
    useSettings.getState().renameTodoList(id, "  Day job  ");
    expect(useSettings.getState().cockpit.todoLists.find((l) => l.id === id)!.name).toBe("Day job");
  });

  // Unlike editTodo, an empty name reverts rather than deleting — a nameless tab is meaningless.
  it("renameTodoList ignores an empty name", () => {
    const id = useSettings.getState().addTodoList("Work");
    useSettings.getState().renameTodoList(id, "   ");
    expect(useSettings.getState().cockpit.todoLists.find((l) => l.id === id)!.name).toBe("Work");
  });

  it("removeTodoList drops an empty list and re-points the active tab", () => {
    const work = useSettings.getState().addTodoList("Work");
    useSettings.getState().removeTodoList(work);
    const c = useSettings.getState().cockpit;
    expect(c.todoLists.map((l) => l.name)).toEqual(["General"]);
    expect(c.activeTodoList).toBe("default");
  });

  it("removeTodoList refuses a list that still holds an item", () => {
    const work = useSettings.getState().addTodoList("Work");
    useSettings.getState().addTodo("ship it");
    useSettings.getState().removeTodoList(work);
    expect(useSettings.getState().cockpit.todoLists.map((l) => l.name)).toEqual(["General", "Work"]);
  });

  it("setActiveTodoList switches tabs", () => {
    useSettings.getState().addTodoList("Work");
    useSettings.getState().setActiveTodoList("default");
    expect(useSettings.getState().cockpit.activeTodoList).toBe("default");
  });
});
