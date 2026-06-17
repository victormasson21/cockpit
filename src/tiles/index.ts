// index.ts — registers the built-in stub tiles at startup.
import { registerTile } from "./registry";
import { ClockTile } from "./clock/ClockTile";
import { NotesTile } from "./notes/NotesTile";
import { WorktreeTile } from "./worktree/WorktreeTile";

// Called once on app start to populate the registry with the built-in tiles.
export function registerBuiltinTiles(): void {
  registerTile({ type: "clock", displayName: "Clock", defaultConfig: {}, component: ClockTile });
  registerTile({ type: "notes", displayName: "Notes", defaultConfig: { text: "" }, component: NotesTile });
  registerTile({ type: "worktree", displayName: "Worktree", defaultConfig: {}, component: WorktreeTile });
}
