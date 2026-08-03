// persist.ts — the store's single writer to disk. Every slice that mutates persisted state goes through
// here, so there is exactly one place that knows the debounce and how the workspace block is composed.
import { saveSettings } from "../api";
import { withWorkspace } from "../workspace";
import type { Setter, SettingsState } from "../storeState";

const SAVE_DEBOUNCE_MS = 500; // absorb drags/keystrokes rather than thrashing the filesystem

let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Queue a debounced write of the whole settings file.
export function scheduleSave(get: () => SettingsState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = get();
    // The workspace block is composed HERE, from live session state, so the in-memory cockpit never
    // holds a copy that could drift out of sync with the slots/panes actually on screen.
    saveSettings({ cockpit: withWorkspace(st.cockpit, st), layout: st.layout })
      .catch((e) => console.error("save failed", e));
  }, SAVE_DEBOUNCE_MS);
}

// setSession: for the session state the persisted `workspace` block covers (slots, scratch, pane sets).
// Same as set(), plus the debounced write — so the arrangement comes back next launch. A slice that
// forgets to use it only delays persistence to the next write; it never persists stale data.
export function makeSetSession(set: Setter, get: () => SettingsState): Setter {
  return (patch) => {
    set(patch);
    scheduleSave(get);
  };
}
