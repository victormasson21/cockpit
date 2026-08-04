import { describe, it, expect } from "vitest";
import { shouldFit } from "./fit";

describe("shouldFit", () => {
  it("is true for a pane with real dimensions", () => {
    expect(shouldFit(720, 400)).toBe(true);
  });
  it("is false at zero height (a collapsed pane)", () => {
    expect(shouldFit(720, 0)).toBe(false);
  });
  it("is false at zero width (a density that hides this pane)", () => {
    expect(shouldFit(0, 400)).toBe(false);
  });
  // A display:none ancestor makes the computed height "auto", which parses to NaN rather than 0.
  it("is false when the measurement is not a number", () => {
    expect(shouldFit(NaN, NaN)).toBe(false);
  });
});
