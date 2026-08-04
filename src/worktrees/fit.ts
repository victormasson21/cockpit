// fit.ts — the guard for a terminal's ResizeObserver. FitAddon clamps its proposal to a 2x1 floor, so
// fitting a hidden pane would push that bogus geometry onto the PTY and wreck the TUI's layout.
// A NaN measurement (a display:none ancestor computes height "auto") fails the comparison too.
export function shouldFit(width: number, height: number): boolean {
  return width > 0 && height > 0;
}
