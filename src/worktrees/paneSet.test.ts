// paneSet.test.ts — the dynamic pane-set rules: cap, monotonic roles, remove, collapse/expand.
import { describe, it, expect } from "vitest";
import {
  EMPTY_PANE_SET, MAX_EXTRAS, paneRoles, runHost, addExtra, removePane,
  isPaneOpen, togglePane, expandPane, type WorktreePaneSet,
} from "./paneSet";

describe("paneRoles", () => {
  it("default set is claude only", () => {
    expect(paneRoles(EMPTY_PANE_SET)).toEqual(["claude"]);
  });

  it("orders claude, then host, then extras", () => {
    const set = addExtra(addExtra(runHost(EMPTY_PANE_SET)));
    expect(paneRoles(set)).toEqual(["claude", "host", "shell-1", "shell-2"]);
  });
});

describe("runHost", () => {
  it("turns the host pane on (open)", () => {
    const set = runHost(EMPTY_PANE_SET);
    expect(set.host).toBe(true);
    expect(isPaneOpen(set, "host")).toBe(true);
  });

  it("is idempotent", () => {
    const once = runHost(EMPTY_PANE_SET);
    expect(runHost(once)).toBe(once);
  });
});

describe("addExtra", () => {
  it("adds shell-1 then shell-2, open by default", () => {
    const set = addExtra(addExtra(EMPTY_PANE_SET));
    expect(set.extras).toEqual(["shell-1", "shell-2"]);
    expect(isPaneOpen(set, "shell-2")).toBe(true);
  });

  it("is a no-op at the cap", () => {
    let set: WorktreePaneSet = EMPTY_PANE_SET;
    for (let i = 0; i < MAX_EXTRAS; i++) set = addExtra(set);
    expect(addExtra(set)).toBe(set);
  });

  it("never reuses a removed pane's role (monotonic seq)", () => {
    const set = addExtra(removePane(addExtra(EMPTY_PANE_SET), "shell-1"));
    expect(set.extras).toEqual(["shell-2"]);
  });
});

describe("removePane", () => {
  it("removes the host pane and forgets its collapse state", () => {
    const set = removePane(togglePane(runHost(EMPTY_PANE_SET), "host"), "host");
    expect(set.host).toBe(false);
    expect(set.open).not.toHaveProperty("host");
  });

  it("removes one extra, keeps the other", () => {
    const set = removePane(addExtra(addExtra(EMPTY_PANE_SET)), "shell-1");
    expect(set.extras).toEqual(["shell-2"]);
  });
});

describe("open state", () => {
  it("panes default to open; toggle closes then reopens", () => {
    expect(isPaneOpen(EMPTY_PANE_SET, "claude")).toBe(true);
    const closed = togglePane(EMPTY_PANE_SET, "claude");
    expect(isPaneOpen(closed, "claude")).toBe(false);
    expect(isPaneOpen(togglePane(closed, "claude"), "claude")).toBe(true);
  });

  it("expandPane opens the target and collapses every other live pane", () => {
    const set = expandPane(addExtra(runHost(EMPTY_PANE_SET)), "shell-1");
    expect(isPaneOpen(set, "shell-1")).toBe(true);
    expect(isPaneOpen(set, "claude")).toBe(false);
    expect(isPaneOpen(set, "host")).toBe(false);
  });
});
