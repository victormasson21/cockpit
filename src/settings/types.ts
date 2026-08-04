// types.ts — shared TypeScript shapes for persisted settings; mirror the Rust serde structs.
import type { WorktreePaneSet } from "../worktrees/paneSet";
import type { ScratchTerminal } from "../views/slots";

export interface TileInstance<Config = unknown> {
  id: string;
  type: string;
  config: Config;
}

// Narrower than the Rust side (plain String): TS encodes the valid domain the backend doesn't enforce.
export interface Preferences {
  theme: "system" | "light" | "dark";
  defaultView: "cockpit" | "worktrees" | "calm";
  panes?: number; // legacy: old fixed Worktrees/Calm column count. No longer read/written (layout is now responsive); kept optional for back-compat with older cockpit.json.
  fontScale?: number; // text zoom multiplier (Cmd +/-/0); 1 = 100%. optional for back-compat with older cockpit.json
  background?: string; // id from the background registry; absent or unknown = the default. "none" = off.
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
// A named to-do list = one tab in the To Do tile.
export interface TodoList { id: string; name: string }
// `listId` is optional: absent (or dangling) resolves to the first list via listIdOf() in
// tiles/todo/todo.ts, so a pre-tabs cockpit.json loads with no migration.
export interface TodoItem { id: string; text: string; state: TodoState; listId?: string }
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

// The previous session's arrangement (mirrors the Rust Workspace struct). `slots` holds entity ids in
// column order; null = a shown-but-empty column. Absent from the config entirely on a pre-feature file.
export interface WorkspaceState {
  slots: (string | null)[];
  scratch: ScratchTerminal[];
  scratchSeq: number;
  panes: Record<string, WorktreePaneSet>;
}

export interface CockpitConfig {
  version: number;
  tiles: TileInstance[];
  worktrees: Worktree[];
  knownRepos: KnownRepo[];
  integrations?: Integrations;
  todos: TodoItem[];
  todoLists: TodoList[];
  activeTodoList?: string;
  worktreeContexts?: Record<string, string>;
  cockpitWorktreeId?: string;
  workspace?: WorkspaceState;
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
