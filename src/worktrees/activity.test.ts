import { describe, it, expect } from "vitest";
import { activityOf } from "./activity";

const at = (id: string, displayedIds: (string | null | undefined)[], livePtyIds: string[]) =>
  activityOf(id, { displayedIds, livePtyIds });

describe("activityOf", () => {
  it("reads an id held by a slot as displayed", () => {
    expect(at("wt-1", ["wt-1"], [])).toBe("displayed");
  });

  it("prefers displayed over running when both are true", () => {
    expect(at("wt-1", ["wt-1"], ["wt-1:claude"])).toBe("displayed");
  });

  it("reads an off-screen id with a live pty as running", () => {
    expect(at("wt-1", ["wt-2", null], ["wt-1:claude"])).toBe("running");
  });

  it("reads an off-screen id with no live pty as paused", () => {
    expect(at("wt-1", ["wt-2"], ["wt-2:claude"])).toBe("paused");
  });

  it("matches any role, not just claude", () => {
    expect(at("wt-1", [], ["wt-1:host"])).toBe("running");
    expect(at("scratch-1", [], ["scratch-1:shell"])).toBe("running");
  });

  it("requires the separator, so a longer id is not a prefix match", () => {
    expect(at("wt-1", [], ["wt-10:claude"])).toBe("paused");
  });

  it("ignores empty slots and an unassigned cockpit pin", () => {
    expect(at("wt-1", [null, undefined], [])).toBe("paused");
  });

  it("treats a never-opened entity as paused", () => {
    expect(at("wt-1", [], [])).toBe("paused");
  });
});
