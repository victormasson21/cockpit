// store.test.ts — the assembly point's own responsibilities: `init` (hydrating every slice from the
// settings file, including the session-restore branch) and the single debounced writer back to disk.
// Per-concern behaviour lives in slices/*.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC layer so the debounced save never reaches Tauri in tests.
vi.mock("./api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

import { useSettings } from "./store";
import { saveSettings } from "./api";
import type { CockpitConfig, Worktree } from "./types";
import { baseCockpit, baseLayout, resetStore, sampleWt, slotIds } from "./slices/fixtures";

const three: Worktree[] = [sampleWt, { ...sampleWt, id: "wt-2" }, { ...sampleWt, id: "wt-3" }];

describe("init — hydration", () => {
  beforeEach(() => resetStore());

  it("seeds one column per ongoing worktree (first 3), each with a key", () => {
    const w = (id: string, status: "ongoing" | "completed" = "ongoing"): Worktree => ({ ...sampleWt, id, status });
    useSettings.getState().init({
      cockpit: { ...baseCockpit, worktrees: [w("done", "completed"), w("a"), w("b"), w("c"), w("d")] },
      layout: baseLayout,
    });
    expect(slotIds()).toEqual(["a", "b", "c"]);
    expect(useSettings.getState().slots.every((s) => typeof s.key === "string")).toBe(true);
    expect(useSettings.getState().slotSeq).toBe(3);
  });

  it("marks the store loaded and carries both config blocks through", () => {
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout: baseLayout });
    const st = useSettings.getState();
    expect(st.loaded).toBe(true);
    expect(st.cockpit.tiles).toHaveLength(1);
    expect(st.layout).toEqual(baseLayout);
  });
});

describe("init — session restore", () => {
  beforeEach(() => resetStore());

  it("restores the persisted arrangement instead of the first-ongoing default", () => {
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
    useSettings.getState().init({ cockpit, layout: baseLayout });
    const st = useSettings.getState();
    expect(slotIds()).toEqual(["wt-3", null]);
    expect(st.scratchTerminals).toEqual([{ id: "scratch-1", title: "Scratch 1" }]);
    expect(st.worktreePanes["wt-3"].host).toBe(true);
    expect(st.restoredWorktrees).toEqual({ "wt-3": true });
  });

  it("falls back to the first ongoing worktrees when the file has no workspace block", () => {
    const cockpit: CockpitConfig = { ...structuredClone(baseCockpit), worktrees: three };
    useSettings.getState().init({ cockpit, layout: baseLayout });
    expect(slotIds()).toEqual(["wt-1", "wt-2", "wt-3"]);
    expect(useSettings.getState().restoredWorktrees).toEqual({});
  });

  it("drops a slot id that no longer resolves, keeping the column count", () => {
    const cockpit: CockpitConfig = {
      ...structuredClone(baseCockpit),
      worktrees: [sampleWt],
      workspace: { slots: ["wt-1", "wt-gone"], scratch: [], scratchSeq: 0, panes: {} },
    };
    useSettings.getState().init({ cockpit, layout: baseLayout });
    expect(slotIds()).toEqual(["wt-1", null]);
  });
});

describe("the debounced writer", () => {
  beforeEach(() => resetStore());

  // A session-only change (no setCockpit call) must still reach disk, or the arrangement is lost.
  it("a slots-only change schedules a save carrying the workspace block", () => {
    vi.useFakeTimers();
    vi.mocked(saveSettings).mockClear();
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout: baseLayout });
    useSettings.getState().addEmptySlot();
    vi.advanceTimersByTime(600);
    // tsconfig's lib target (ES2020) predates Array.prototype.at; index from the end instead.
    const calls = vi.mocked(saveSettings).mock.calls;
    const written = calls[calls.length - 1][0];
    expect(written.cockpit.workspace).toEqual({ slots: [null], scratch: [], scratchSeq: 0, panes: {} });
    vi.useRealTimers();
  });

  // One debounce shared by every slice: a burst of writes from different concerns collapses to one save.
  it("coalesces writes from several slices into a single save", () => {
    vi.useFakeTimers();
    useSettings.getState().init({ cockpit: structuredClone(baseCockpit), layout: baseLayout });
    vi.advanceTimersByTime(600);
    vi.mocked(saveSettings).mockClear();
    useSettings.getState().addTodo("a"); // todos slice
    useSettings.getState().addEmptySlot(); // workspace slice
    useSettings.getState().setFontScale(1.3); // zoom slice
    vi.advanceTimersByTime(600);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const written = vi.mocked(saveSettings).mock.calls[0][0];
    expect(written.cockpit.todos).toHaveLength(1);
    expect(written.cockpit.preferences.fontScale).toBe(1.3);
    expect(written.cockpit.workspace?.slots).toEqual([null]);
    vi.useRealTimers();
  });
});
