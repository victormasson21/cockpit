// api.ts — typed wrappers over the Tauri settings IPC commands.
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

// Load both config files from the Rust core at startup.
export const loadSettings = () => invoke<Settings>("load_settings");

// Persist both config files to the Rust core.
export const saveSettings = (settings: Settings) =>
  invoke<void>("save_settings", { settings });
