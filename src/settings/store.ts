// store.ts — the single in-session source of truth for settings. This file is the assembly point: it
// composes the per-concern slices (config, zoom, todos, integrations, workspace) into one store, and
// owns `init`, which is the one action that hydrates every slice at once.
//
// One store rather than several, deliberately: the persisted `workspace` block is composed from session
// state at save time, and a few actions genuinely span concerns (removeWorktree drops a model AND clears
// the slot, flags and pane set). Separate stores would only move that coupling into cross-store reads.
// See docs/superpowers/plans/2026-08-03-deduce-flow-module.md.
import { create } from "zustand";
import { createConfigSlice } from "./slices/config";
import { createIntegrationsSlice } from "./slices/integrations";
import { createTodosSlice } from "./slices/todos";
import { createWorkspaceSlice } from "./slices/workspace";
import { clampZoom, createZoomSlice } from "./slices/zoom";
import { initSlots } from "../views/slots";
import { restoreWorkspace } from "./workspace";
import type { SettingsState } from "./storeState";

export { clampZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "./slices/zoom";

export const useSettings = create<SettingsState>((...a) => {
  const [set] = a;
  return {
    ...createConfigSlice(...a),
    ...createZoomSlice(...a),
    ...createTodosSlice(...a),
    ...createIntegrationsSlice(...a),
    ...createWorkspaceSlice(...a),

    // init: hydrate from the settings file. Cross-slice by nature — it seeds the config blocks, the zoom
    // multiplier and the whole workspace arrangement in one write, so it lives here rather than in a slice.
    init: (s) => set((st) => {
      const base = {
        cockpit: s.cockpit, layout: s.layout, loaded: true,
        fontScale: clampZoom(s.cockpit.preferences.fontScale ?? 1),
      };
      let seq = st.slotSeq;
      const mint = () => { seq += 1; return `slot-${seq}`; };
      // No workspace block = a pre-feature config: seed the slots the old way (first 3 ongoing worktrees).
      if (!s.cockpit.workspace) {
        return { ...base, slots: initSlots(s.cockpit.worktrees, mint), slotSeq: seq };
      }
      const r = restoreWorkspace(s.cockpit.workspace, s.cockpit.worktrees, mint, s.cockpit.cockpitWorktreeId);
      return {
        ...base, slotSeq: seq,
        slots: r.slots,
        scratchTerminals: r.scratchTerminals,
        scratchSeq: r.scratchSeq,
        worktreePanes: r.worktreePanes,
        restoredWorktrees: r.restoredWorktrees,
      };
    }),
  };
});
