// registry.ts — the tile contract + a startup-populated map; the central plug-in seam for all features.
import type { FC } from "react";
import type { TileInstance } from "../settings/types";

// Props every tile component receives. A tile owns only its config — never its layout position.
export interface TileProps<Config = unknown> {
  id: string;
  config: Config;
  updateConfig: (next: Config) => void;
}

// A kind of tile (code, registered at startup). Distinct from a TileInstance (data, in cockpit.json).
export interface TileDefinition<Config = unknown> {
  type: string;
  displayName: string;
  icon?: string;
  defaultConfig: Config;
  component: FC<TileProps<Config>>;
  settingsComponent?: FC<TileProps<Config>>;
}

const registry = new Map<string, TileDefinition<any>>();

// Register a tile kind so instances of it can be rendered.
// Last-write-wins is deliberate: Vite HMR re-runs registration on hot reload, so a duplicate-throw would crash dev.
export function registerTile<Config>(def: TileDefinition<Config>): void {
  registry.set(def.type, def);
}

// Look up a tile kind by its type string.
export function getTile(type: string): TileDefinition<any> | undefined {
  return registry.get(type);
}

// Test helper: empty the registry between cases.
export function clearRegistry(): void {
  registry.clear();
}

// Build a fresh tile instance with the kind's default config.
// structuredClone so instances never share the definition's mutable default object.
// Unknown type falls back to {} (not a throw) so a stale cockpit.json entry round-trips to a placeholder instead of crashing.
export function newInstance(type: string, id: string): TileInstance {
  const def = registry.get(type);
  return { id, type, config: def ? structuredClone(def.defaultConfig) : {} };
}
