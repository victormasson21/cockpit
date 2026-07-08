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
  fontScale?: number; // text zoom multiplier (Cmd +/-/0); 1 = 100%. optional for back-compat with older cockpit.json
}

export interface HostConfig { startCmd: string; address: string }
export interface KnownRepo { path: string; host?: HostConfig }
export interface WorktreeLink { label: string; url: string }
export interface SlackIntegration { clientId?: string; watchedChannelIds: string[] }
// One captured PR review request (render-ready; id = the Slack message ts).
export interface PrReviewItem {
  id: string;
  url: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  ts: string;
  mode?: string; // Ship/Show/Ask marker from the message ("SHIP" | "SHOW" | "ASK")
}
// PR Reviews tile config + state: watched channel, fetch cursor, user-curated item list.
export interface PrReviewsIntegration { channelId?: string; lastSeenTs?: string; items: PrReviewItem[] }
export interface Integrations { slack?: SlackIntegration; prReviews?: PrReviewsIntegration }
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
  prompt?: string; // the deduce prompt that created this worktree (auto-sent to Claude once; kept copyable)
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
