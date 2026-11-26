// ThemeProvider.test.ts — the theme preference picks Day or Night, and applyTheme brands the root with it.
import { describe, it, expect } from "vitest";
import { applyTheme, themeFor, DAY_THEME, NIGHT_THEME } from "./ThemeProvider";

describe("themeFor", () => {
  it("maps light to the day theme", () => {
    expect(themeFor("light")).toBe(DAY_THEME);
  });

  it("keeps night for dark and system", () => {
    expect(themeFor("dark")).toBe(NIGHT_THEME);
    expect(themeFor("system")).toBe(NIGHT_THEME);
  });
});

describe("applyTheme", () => {
  it("sets data-theme to the given theme on the root element", () => {
    const calls: [string, string][] = [];
    const fakeRoot = { setAttribute: (k: string, v: string) => calls.push([k, v]) };
    applyTheme(fakeRoot, DAY_THEME);
    expect(calls).toEqual([["data-theme", "day"]]);
  });
});
