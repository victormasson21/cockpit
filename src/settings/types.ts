// types.ts — shared TypeScript shapes for persisted settings; mirror the Rust serde structs.
export interface TileInstance<Config = unknown> {
  id: string;
  type: string;
  config: Config;
}

// Narrower than the Rust side (plain String): TS encodes the valid domain the backend doesn't enforce.
export interface Preferences {
  theme: "system" | "light" | "dark";
  defaultView: "main" | "calm";
}

export interface HostConfig { startCmd: string; address: string }
export interface WorktreeLink { label: string; url: string }
export type WorktreeStatus = "ongoing" | "completed";
export interface Worktree {
  id: string;
  name: string;
  repoPath: string;
  branch: string;
  worktreePath: string;
  host: HostConfig;
  links: WorktreeLink[];
  status: WorktreeStatus;
}

export interface CockpitConfig {
  version: number;
  tiles: TileInstance[];
  worktrees: Worktree[];
  preferences: Preferences;
}

export interface LayoutConfig {
  version: number;
  views: Record<string, unknown>; // dockview serialized layout per view
}

export interface Settings {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
}
