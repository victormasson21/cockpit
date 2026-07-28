// drop.ts — pure helpers turning a native file-drop payload into text for a PTY.

// Characters backslash-escaped so a dropped path survives both a shell and Claude Code's input box.
// Escaping (not quoting) mirrors what Finder → Terminal.app produces, which is the form Claude Code
// is tested against. Load-bearing: macOS screenshot filenames always contain spaces.
const SHELL_SPECIAL = new Set([
  " ", "\t", "\\", '"', "'", "`", "$", "&", "|", ";", "<", ">",
  "(", ")", "*", "?", "[", "]", "{", "}", "~", "!", "#",
]);

export function escapeDroppedPath(path: string): string {
  // Iterating the string yields code points, so multi-byte filename characters pass through intact.
  let out = "";
  for (const ch of path) out += SHELL_SPECIAL.has(ch) ? `\\${ch}` : ch;
  return out;
}

// Escaped paths, space-separated, with a trailing space so the user can keep typing after them.
// No newline: the paths land at the cursor and are never submitted for them.
export function formatDroppedPaths(paths: string[]): string {
  if (paths.length === 0) return "";
  return paths.map(escapeDroppedPath).join(" ") + " ";
}

// Drag-drop payload positions are PHYSICAL pixels; elementFromPoint needs CSS pixels. We divide by
// devicePixelRatio rather than calling PhysicalPosition.toLogical(scaleFactor) because the latter
// needs an awaited scaleFactor() call, and this runs inside a synchronous event handler.
export function logicalPoint(p: { x: number; y: number }, dpr: number): { x: number; y: number } {
  return { x: p.x / dpr, y: p.y / dpr };
}

// The payload shape this module needs. Written as a union that Tauri's DragDropEvent satisfies
// structurally, so App.tsx passes its payload straight through with no cast (PhysicalPosition has
// x and y, and extra properties are fine on a non-literal assignment).
export type DropPayload =
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "leave" };

// Resolves a pane's pty id from a point in CSS pixels; null when no pane is there.
export type DropHitTest = (x: number, y: number) => string | null;

// What a drop should write and where — null when the payload is not an actionable drop.
// The DOM hit-test is injected so this stays pure: every way routing can go wrong (non-drop event,
// no paths, wrong DPR scaling, nothing under the cursor) is unit-testable without a layout engine.
export function dropCommand(
  payload: DropPayload,
  dpr: number,
  hitTest: DropHitTest,
): { ptyId: string; text: string } | null {
  if (payload.type !== "drop") return null;
  const text = formatDroppedPaths(payload.paths);
  if (!text) return null;
  const { x, y } = logicalPoint(payload.position, dpr);
  const ptyId = hitTest(x, y);
  return ptyId ? { ptyId, text } : null;
}
