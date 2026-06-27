import { describe, it, expect } from "vitest";
import { relativeTime } from "./time";

const NOW = 1_700_000_000_000; // ms

describe("relativeTime", () => {
  it("shows seconds under a minute as 'now'", () => {
    expect(relativeTime(1_700_000_000 - 5, NOW)).toBe("now");
  });
  it("shows minutes", () => {
    expect(relativeTime(1_700_000_000 - 120, NOW)).toBe("2m");
  });
  it("shows hours", () => {
    expect(relativeTime(1_700_000_000 - 3 * 3600, NOW)).toBe("3h");
  });
  it("shows days", () => {
    expect(relativeTime(1_700_000_000 - 2 * 86400, NOW)).toBe("2d");
  });
});
