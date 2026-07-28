import { describe, it, expect } from "vitest";
import { escapeDroppedPath, formatDroppedPaths, logicalPoint, dropCommand } from "./drop";

describe("escapeDroppedPath", () => {
  it("leaves a plain path untouched", () => {
    expect(escapeDroppedPath("/Users/me/img.png")).toBe("/Users/me/img.png");
  });

  it("escapes spaces — the macOS screenshot case", () => {
    expect(escapeDroppedPath("/Users/me/Screenshot 2026-07-28 at 14.32.10.png"))
      .toBe("/Users/me/Screenshot\\ 2026-07-28\\ at\\ 14.32.10.png");
  });

  it("escapes an apostrophe", () => {
    expect(escapeDroppedPath("/tmp/it's.png")).toBe("/tmp/it\\'s.png");
  });

  it("escapes shell metacharacters", () => {
    expect(escapeDroppedPath("/tmp/$v&(1).png")).toBe("/tmp/\\$v\\&\\(1\\).png");
  });

  it("escapes a literal backslash", () => {
    expect(escapeDroppedPath("/tmp/a\\b.png")).toBe("/tmp/a\\\\b.png");
  });

  it("leaves non-ASCII filename characters alone", () => {
    expect(escapeDroppedPath("/tmp/café.png")).toBe("/tmp/café.png");
  });
});

describe("formatDroppedPaths", () => {
  it("returns empty string for no paths, so the caller can skip the write", () => {
    expect(formatDroppedPaths([])).toBe("");
  });

  it("appends a trailing space after a single path", () => {
    expect(formatDroppedPaths(["/a.png"])).toBe("/a.png ");
  });

  it("space-separates multiple escaped paths", () => {
    expect(formatDroppedPaths(["/a b.png", "/c.png"])).toBe("/a\\ b.png /c.png ");
  });
});

describe("logicalPoint", () => {
  it("is identity at dpr 1", () => {
    expect(logicalPoint({ x: 400, y: 300 }, 1)).toEqual({ x: 400, y: 300 });
  });

  it("halves physical pixels on a retina display", () => {
    expect(logicalPoint({ x: 400, y: 300 }, 2)).toEqual({ x: 200, y: 150 });
  });
});

describe("dropCommand", () => {
  const hit = () => "wt-1:claude";

  it("ignores events that are not a drop", () => {
    expect(dropCommand({ type: "over", position: { x: 1, y: 1 } }, 1, hit)).toBeNull();
    expect(dropCommand({ type: "leave" }, 1, hit)).toBeNull();
    expect(dropCommand({ type: "enter", paths: ["/a.png"], position: { x: 1, y: 1 } }, 1, hit)).toBeNull();
  });

  it("ignores a drop carrying no paths", () => {
    expect(dropCommand({ type: "drop", paths: [], position: { x: 1, y: 1 } }, 1, hit)).toBeNull();
  });

  it("returns null when no pane is under the cursor", () => {
    expect(dropCommand({ type: "drop", paths: ["/a.png"], position: { x: 1, y: 1 } }, 1, () => null)).toBeNull();
  });

  it("hit-tests in CSS pixels, not physical ones", () => {
    const seen: Array<[number, number]> = [];
    dropCommand({ type: "drop", paths: ["/a.png"], position: { x: 400, y: 300 } }, 2, (x, y) => {
      seen.push([x, y]);
      return "wt-1:claude";
    });
    expect(seen).toEqual([[200, 150]]);
  });

  it("returns the resolved pane id and the formatted text", () => {
    expect(dropCommand({ type: "drop", paths: ["/a b.png"], position: { x: 10, y: 20 } }, 1, hit))
      .toEqual({ ptyId: "wt-1:claude", text: "/a\\ b.png " });
  });
});
