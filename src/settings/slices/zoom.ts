// zoom.ts — text zoom (Cmd +/-/0): a multiplier applied to every font-size token. Held as session state
// for cheap reads AND persisted into preferences, so it survives a restart.
import type { SettingsSlice } from "../storeState";

// Clamp to a readable range and quantise to the step so repeated +/- stay on grid.
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export function clampZoom(n: number): number {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
  return Math.round(clamped * 10) / 10; // avoid float drift (e.g. 1.0000000002) across many steps
}

export interface ZoomSlice {
  fontScale: number;
  setFontScale: (n: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const createZoomSlice: SettingsSlice<ZoomSlice> = (set, get) => ({
  fontScale: 1,
  // App applies this to <html> as --font-scale; useTerminal reads it for the xterm font size.
  setFontScale: (n) => {
    const fontScale = clampZoom(n);
    set({ fontScale });
    get().setCockpit((c) => ({ ...c, preferences: { ...c.preferences, fontScale } }));
  },
  zoomIn: () => get().setFontScale(get().fontScale + ZOOM_STEP),
  zoomOut: () => get().setFontScale(get().fontScale - ZOOM_STEP),
  resetZoom: () => get().setFontScale(1),
});
