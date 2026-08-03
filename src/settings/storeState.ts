// storeState.ts — the settings store's combined state type, composed from its slices.
// Every slice is typed over the WHOLE state, not just its own members: a few actions are genuinely
// cross-slice (removeWorktree drops a model AND clears the slot/flags/panes; setCockpitWorktree is a
// workspace concern stored in the config), and they reach each other through get(). That's why this is
// one store with slice files rather than several stores — see the plan for 2026-08-03.
import type { StateCreator } from "zustand";
import type { ConfigSlice } from "./slices/config";
import type { IntegrationsSlice } from "./slices/integrations";
import type { TodosSlice } from "./slices/todos";
import type { WorkspaceSlice } from "./slices/workspace";
import type { ZoomSlice } from "./slices/zoom";

export type View = "cockpit" | "worktrees" | "calm";

// `init` hydrates every slice at once, so it lives on the assembly point (store.ts) rather than in a slice.
export interface HydrateSlice {
  init: (s: import("./types").Settings) => void;
}

export type SettingsState =
  & ConfigSlice
  & ZoomSlice
  & TodosSlice
  & IntegrationsSlice
  & WorkspaceSlice
  & HydrateSlice;

// The shape of a slice creator. Typed over SettingsState so cross-slice get() calls typecheck.
export type SettingsSlice<T> = StateCreator<SettingsState, [], [], T>;

// A set() that accepts a value or an updater. Declared explicitly rather than as `typeof set`: zustand's
// setState is overloaded, and a wrapper over it does not typecheck otherwise.
export type Setter = (patch: Partial<SettingsState> | ((st: SettingsState) => Partial<SettingsState>)) => void;
