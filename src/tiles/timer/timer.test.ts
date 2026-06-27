import { describe, it, expect } from "vitest";
import { formatTime } from "./timer";

describe("formatTime", () => {
  it("formats whole minutes", () => { expect(formatTime(25 * 60)).toBe("25:00"); });
  it("formats minutes and seconds with zero-pad", () => { expect(formatTime(65)).toBe("01:05"); });
  it("formats sub-minute", () => { expect(formatTime(5)).toBe("00:05"); });
  it("floors at zero", () => { expect(formatTime(0)).toBe("00:00"); });
  it("clamps negatives to zero", () => { expect(formatTime(-5)).toBe("00:00"); });
});
