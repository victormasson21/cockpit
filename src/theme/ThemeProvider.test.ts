// ThemeProvider.test.ts — applyTheme must brand the given root element with the active theme.
import { describe, it, expect } from "vitest";
import { applyTheme, THEME } from "./ThemeProvider";

describe("applyTheme", () => {
  it("sets data-theme to the active theme on the root element", () => {
    const calls: [string, string][] = [];
    const fakeRoot = { setAttribute: (k: string, v: string) => calls.push([k, v]) };
    applyTheme(fakeRoot);
    expect(THEME).toBe("deep-slate");
    expect(calls).toEqual([["data-theme", "deep-slate"]]);
  });
});
