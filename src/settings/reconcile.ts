// reconcile.ts — pure join of tile instances (cockpit.json) against placed panel ids (layout.json).
import type { TileInstance } from "./types";

// Result of reconciling configured tiles with the saved layout.
export interface ReconcileResult {
  placedIds: string[];        // tiles already positioned in the layout
  unplacedTiles: TileInstance[]; // configured tiles needing a default spot
  orphanPanelIds: string[];   // layout panels whose tile no longer exists
}

// Split tiles into placed/unplaced and surface orphan panels, so startup can add the missing ones and drop the dead ones.
export function reconcile(
  tiles: TileInstance[],
  panelTileIds: string[],
): ReconcileResult {
  const tileIds = new Set(tiles.map((t) => t.id));
  const placedSet = new Set(panelTileIds.filter((id) => tileIds.has(id)));

  return {
    placedIds: [...placedSet],
    unplacedTiles: tiles.filter((t) => !placedSet.has(t.id)),
    orphanPanelIds: panelTileIds.filter((id) => !tileIds.has(id)),
  };
}
