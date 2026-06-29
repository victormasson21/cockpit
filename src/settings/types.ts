// types.ts — shared TypeScript shapes for persisted settings; mirror the Rust serde structs.
export interface TileInstance<Config = unknown> {
  id: string;
  type: string;
  config: Config;
}

// Narrower than the Rust side (plain String): TS encodes the valid domain the backend doesn't enforce.
export interface Preferences {
  theme: "system" | "light" | "dark";
  defaultView: "cockpit" | "worktrees" | "calm";
  panes: number; // visible Worktrees/Calm columns (2 or 3)
}

export interface HostConfig { startCmd: string; address: string }
export interface KnownRepo { path: string; host?: HostConfig }
export interface WorktreeLink { label: string; url: string }
export interface SlackIntegration { clientId?: string; watchedChannelIds: string[] }
export interface Integrations { slack?: SlackIntegration }
export type TodoState = "todo" | "in_progress" | "done";
export interface TodoItem { id: string; text: string; state: TodoState }
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
  knownRepos: KnownRepo[];
  integrations?: Integrations;
  todos: TodoItem[];
  cockpitWorktreeId?: string;
  preferences: Preferences;
}

export interface LayoutConfig {
  version: number;
  views: Record<string, unknown>; // serialized layout per view (kept for round-trip; not written by new shell)
}

export interface Settings {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
}
