// zoom.test.ts — text zoom: the clamp/grid contract, and the fact that the multiplier is BOTH session
// state and a persisted preference (so it survives a restart).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

import { useSettings } from "../store";
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from "./zoom";
import { baseCockpit, baseLayout, resetStore } from "./fixtures";

describe("text zoom", () => {
  beforeEach(() => resetStore());

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
      layout: baseLayout,
    });
    expect(useSettings.getState().fontScale).toBe(1.4);
  });

  it("init defaults fontScale to 1 when absent (back-compat)", () => {
    useSettings.getState().init({ cockpit: baseCockpit, layout: baseLayout });
    expect(useSettings.getState().fontScale).toBe(1);
  });
});
