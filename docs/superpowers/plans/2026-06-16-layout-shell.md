# Layout Shell & Settings Implementation Plan

> ✅ **COMPLETED & MERGED to `main`.** All 13 tasks (0–12) implemented via
> subagent-driven development with per-task spec + quality review. Final state:
> 9 frontend (Vitest) tests + 5 Rust tests green, `tsc`/`build` clean, GUI
> confirmed rendering. As-built deltas from this plan: dockview is **6.6.1**
> (themed via `theme={themeLight}` prop, not a `className`); React is **19**, not
> 18; Stage 0's terminal-spike was descoped to sub-project 2 (terminals don't
> belong here). The unchecked `- [ ]` boxes below are the original plan, kept for
> historical reference — they are all done.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cockpit app shell — a Tauri v2 + React three-zone dockable layout whose tiles and geometry are fully described by two JSON files that survive quit/relaunch.

**Architecture:** Rust core does dumb JSON persistence (load/save/defaults/atomic-write/backup) over a two-command IPC surface. React owns all live state in a single store, renders a dockview layout, and reconciles user config (`cockpit.json`) against layout geometry (`layout.json`) on startup. Tiles are pluggable units: a `TileDefinition` is code registered at startup; a `TileInstance` is data in `cockpit.json`.

**Tech Stack:** Tauri v2, Rust (serde, serde_json, tempfile), React 18 + TypeScript, Vite, dockview, Zustand, Vitest.

**Design reference:** `docs/superpowers/specs/2026-06-16-layout-shell-design.md`

---

## File Structure

**Rust core (`src-tauri/`)**
- `src/settings.rs` — config types + persistence: `config_dir`, `load_cockpit`, `load_layout`, `atomic_write`, `save_all`. The only file with disk semantics.
- `src/commands.rs` — `load_settings`, `save_settings` Tauri commands (thin wrappers over `settings.rs`).
- `src/lib.rs` — Tauri builder, registers commands.
- `src/main.rs` — entry point (calls `lib.rs`).

**React frontend (`src/`)**
- `settings/types.ts` — `CockpitConfig`, `LayoutConfig`, `TileInstance`, `Preferences`, `Settings`.
- `settings/reconcile.ts` — pure `reconcile()` joining tiles × placed panel ids.
- `settings/store.ts` — Zustand store: live state, debounced save.
- `settings/api.ts` — typed wrappers over `invoke("load_settings"/"save_settings")`.
- `tiles/registry.ts` — `TileDefinition`, `TileProps`, registry map + `registerTile`.
- `tiles/clock/ClockTile.tsx` — stub tile.
- `tiles/notes/NotesTile.tsx` — stub tile (exercises config editing).
- `tiles/index.ts` — registers the stub tiles.
- `layout/Layout.tsx` — dockview wrapper: builds panels from settings, wires change events.
- `layout/UnknownTile.tsx` — placeholder for unregistered tile types.
- `App.tsx` — loads settings, renders Layout, calm/main toggle, error banner.
- `main.tsx` — React entry.

---

## Stage 0 — Toolchain spike (de-risk Tauri/React/Vite/IPC)

### Task 0: Scaffold the Tauri + React + TS app into the existing repo

**Files:**
- Create: whole `src-tauri/` + `src/` + root config via the official template.

- [ ] **Step 1: Scaffold into a temp dir** (the repo already has `CLAUDE.md`, `docs/`, `.git` — scaffolding in place would conflict)

Run:
```bash
cd /tmp && rm -rf cockpit-scaffold
npm create tauri-app@latest cockpit-scaffold -- --template react-ts --manager npm
```
Expected: a `/tmp/cockpit-scaffold` folder containing `package.json`, `index.html`, `vite.config.ts`, `src/`, `src-tauri/`.

- [ ] **Step 2: Copy scaffold into the repo without clobbering docs/git**

Run:
```bash
cd /tmp/cockpit-scaffold
rsync -av --exclude='.git' --exclude='README.md' ./ /Users/victormasson/Repos/perso/cockpit/
cd /Users/victormasson/Repos/perso/cockpit
```
Expected: repo now has `package.json`, `src/`, `src-tauri/`; `CLAUDE.md` and `docs/` untouched.

- [ ] **Step 3: Install deps and verify dev build runs**

Run:
```bash
npm install
npm run tauri dev
```
Expected: a native macOS window opens showing the default Tauri+React template. Close it (Cmd-Q) to continue.

- [ ] **Step 4: Add `layout.json` and Rust target dir to .gitignore**

Append to `.gitignore` (create if absent):
```gitignore
# build
node_modules/
dist/
src-tauri/target/
# disposable layout geometry (regenerated at runtime)
# (only ignored under the app data dir at runtime, not in-repo — kept here as a reminder)
```

- [ ] **Step 5: Commit the scaffold**

```bash
git add -A
git commit -m "chore: scaffold Tauri v2 + React + TS app"
```

### Task 1: Prove the IPC round-trip (smoke test)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a `ping` command to `src-tauri/src/lib.rs`**

Add the command and register it (keep the template's existing `greet` if present, or replace it):
```rust
#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Call it from `src/App.tsx`**

Replace the template body with a minimal ping check:
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [reply, setReply] = useState("");
  useEffect(() => {
    invoke<string>("ping").then(setReply);
  }, []);
  return <div>IPC says: {reply}</div>;
}

export default App;
```

- [ ] **Step 3: Run and verify the round-trip**

Run: `npm run tauri dev`
Expected: window shows `IPC says: pong`. Close the window.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify Tauri IPC round-trip (ping/pong)"
```

> Stage 0 done — the toolchain is proven on this machine. Everything below is the real layout shell.

---

## Stage 1 — Rust persistence core

### Task 2: Settings types + defaults in Rust

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod settings;`)
- Modify: `src-tauri/Cargo.toml` (add `tempfile` dev-dependency)

- [ ] **Step 1: Add `tempfile` as a dev-dependency**

In `src-tauri/Cargo.toml`, under a `[dev-dependencies]` section (create it if missing):
```toml
[dev-dependencies]
tempfile = "3"
```
`serde` and `serde_json` ship with the Tauri template; confirm `serde = { version = "1", features = ["derive"] }` and `serde_json = "1"` are under `[dependencies]`, add them if not.

- [ ] **Step 2: Write the failing test for defaults**

Create `src-tauri/src/settings.rs` with types and a defaults test:
```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TileInstance {
    pub id: String,
    #[serde(rename = "type")]
    pub tile_type: String,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preferences {
    pub theme: String,
    #[serde(rename = "defaultView")]
    pub default_view: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CockpitConfig {
    pub version: u32,
    pub tiles: Vec<TileInstance>,
    pub preferences: Preferences,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutConfig {
    pub version: u32,
    pub views: serde_json::Map<String, serde_json::Value>,
}

impl Default for CockpitConfig {
    fn default() -> Self {
        CockpitConfig {
            version: 1,
            tiles: vec![
                TileInstance { id: "clock-1".into(), tile_type: "clock".into(), config: serde_json::json!({}) },
                TileInstance { id: "notes-1".into(), tile_type: "notes".into(), config: serde_json::json!({ "text": "" }) },
            ],
            preferences: Preferences { theme: "system".into(), default_view: "main".into() },
        }
    }
}

impl Default for LayoutConfig {
    fn default() -> Self {
        LayoutConfig { version: 1, views: serde_json::Map::new() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cockpit_default_has_two_stub_tiles() {
        let c = CockpitConfig::default();
        assert_eq!(c.version, 1);
        assert_eq!(c.tiles.len(), 2);
        assert_eq!(c.tiles[0].tile_type, "clock");
        assert_eq!(c.preferences.default_view, "main");
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add near the top:
```rust
mod settings;
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test cockpit_default_has_two_stub_tiles`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): settings types and defaults"
```

### Task 3: Atomic write + load-with-defaults

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Write the failing test for atomic write round-trip**

Append to the `tests` module in `src-tauri/src/settings.rs`:
```rust
    #[test]
    fn atomic_write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cockpit.json");
        let cfg = CockpitConfig::default();
        let json = serde_json::to_string_pretty(&cfg).unwrap();
        atomic_write(&path, &json).unwrap();
        let read = std::fs::read_to_string(&path).unwrap();
        let parsed: CockpitConfig = serde_json::from_str(&read).unwrap();
        assert_eq!(parsed, cfg);
    }

    #[test]
    fn load_cockpit_missing_returns_default_and_writes_it() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load_cockpit(dir.path());
        assert_eq!(cfg, CockpitConfig::default());
        assert!(dir.path().join("cockpit.json").exists());
    }

    #[test]
    fn load_cockpit_malformed_backs_up_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cockpit.json"), "{ not json").unwrap();
        let cfg = load_cockpit(dir.path());
        assert_eq!(cfg, CockpitConfig::default());
        assert!(dir.path().join("cockpit.json.bak").exists());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test settings::tests`
Expected: FAIL — `atomic_write`, `load_cockpit` not found.

- [ ] **Step 3: Implement the persistence functions**

Add to `src-tauri/src/settings.rs` (above the `tests` module):
```rust
use std::fs;
use std::io::Write;

pub fn atomic_write(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

pub fn load_cockpit(dir: &Path) -> CockpitConfig {
    let path = dir.join("cockpit.json");
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<CockpitConfig>(&text) {
            Ok(cfg) => cfg,
            Err(_) => {
                // never silently overwrite the user's hand-edited file
                let _ = fs::rename(&path, dir.join("cockpit.json.bak"));
                let cfg = CockpitConfig::default();
                let _ = atomic_write(&path, &serde_json::to_string_pretty(&cfg).unwrap());
                cfg
            }
        },
        Err(_) => {
            let cfg = CockpitConfig::default();
            let _ = fs::create_dir_all(dir);
            let _ = atomic_write(&path, &serde_json::to_string_pretty(&cfg).unwrap());
            cfg
        }
    }
}

pub fn load_layout(dir: &Path) -> LayoutConfig {
    let path = dir.join("layout.json");
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<LayoutConfig>(&text).unwrap_or_default(),
        Err(_) => LayoutConfig::default(),
    }
}

pub fn save_all(dir: &Path, cockpit: &CockpitConfig, layout: &LayoutConfig) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    atomic_write(&dir.join("cockpit.json"), &serde_json::to_string_pretty(cockpit).unwrap())?;
    atomic_write(&dir.join("layout.json"), &serde_json::to_string_pretty(layout).unwrap())?;
    Ok(())
}
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test settings::tests`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): atomic write, load-with-defaults, malformed backup"
```

### Task 4: Wire the IPC commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the commands**

Create `src-tauri/src/commands.rs`:
```rust
use crate::settings::{load_cockpit, load_layout, save_all, CockpitConfig, LayoutConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
pub struct Settings {
    pub cockpit: CockpitConfig,
    pub layout: LayoutConfig,
}

fn config_dir(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .expect("no app config dir")
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Settings {
    let dir = config_dir(&app);
    Settings { cockpit: load_cockpit(&dir), layout: load_layout(&dir) }
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let dir = config_dir(&app);
    save_all(&dir, &settings.cockpit, &settings.layout).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the commands in `src-tauri/src/lib.rs`**

```rust
mod settings;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
(Remove the `ping` command from Stage 0 — it has served its purpose.)

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(core): load_settings/save_settings IPC commands"
```

---

## Stage 2 — React settings + reconciliation

### Task 5: Settings types + Vitest setup

**Files:**
- Create: `src/settings/types.ts`
- Modify: `package.json` (add vitest), `vite.config.ts` (test config)

- [ ] **Step 1: Add Vitest**

Run:
```bash
npm install -D vitest
```

- [ ] **Step 2: Enable Vitest in `vite.config.ts`**

Add a `test` block to the existing config object:
```ts
/// <reference types="vitest" />
// ...existing imports/config...
export default defineConfig({
  // ...existing plugins/server config...
  test: { environment: "node" },
});
```

- [ ] **Step 3: Define the shared types**

Create `src/settings/types.ts`:
```ts
export interface TileInstance<Config = unknown> {
  id: string;
  type: string;
  config: Config;
}

export interface Preferences {
  theme: "system" | "light" | "dark";
  defaultView: "main" | "calm";
}

export interface CockpitConfig {
  version: number;
  tiles: TileInstance[];
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
```

- [ ] **Step 4: Add a test script to `package.json`**

In `"scripts"`, add:
```json
"test": "vitest run"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): settings types and vitest setup"
```

### Task 6: Pure reconciliation logic

**Files:**
- Create: `src/settings/reconcile.ts`
- Create: `src/settings/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/settings/reconcile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";
import type { TileInstance } from "./types";

const tiles: TileInstance[] = [
  { id: "clock-1", type: "clock", config: {} },
  { id: "notes-1", type: "notes", config: { text: "" } },
];

describe("reconcile", () => {
  it("marks tiles present in the layout as placed", () => {
    const r = reconcile(tiles, ["clock-1"]);
    expect(r.placedIds).toEqual(["clock-1"]);
  });

  it("returns tiles missing from the layout as unplaced", () => {
    const r = reconcile(tiles, ["clock-1"]);
    expect(r.unplacedTiles.map((t) => t.id)).toEqual(["notes-1"]);
  });

  it("flags layout panels with no matching tile as orphans", () => {
    const r = reconcile(tiles, ["clock-1", "ghost-9"]);
    expect(r.orphanPanelIds).toEqual(["ghost-9"]);
  });

  it("handles an empty layout: everything unplaced, no orphans", () => {
    const r = reconcile(tiles, []);
    expect(r.unplacedTiles).toHaveLength(2);
    expect(r.orphanPanelIds).toEqual([]);
    expect(r.placedIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- reconcile`
Expected: FAIL — cannot find `./reconcile`.

- [ ] **Step 3: Implement `reconcile`**

Create `src/settings/reconcile.ts`:
```ts
import type { TileInstance } from "./types";

export interface ReconcileResult {
  placedIds: string[];
  unplacedTiles: TileInstance[];
  orphanPanelIds: string[];
}

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
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- reconcile`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): pure layout reconciliation logic"
```

---

## Stage 3 — Tile registry + stub tiles

### Task 7: Tile registry contract

**Files:**
- Create: `src/tiles/registry.ts`
- Create: `src/tiles/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tiles/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerTile, getTile, clearRegistry } from "./registry";

describe("tile registry", () => {
  beforeEach(() => clearRegistry());

  it("registers and retrieves a tile definition by type", () => {
    const def = { type: "clock", displayName: "Clock", defaultConfig: {}, component: () => null };
    registerTile(def);
    expect(getTile("clock")).toBe(def);
  });

  it("returns undefined for an unregistered type", () => {
    expect(getTile("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- registry`
Expected: FAIL — cannot find `./registry`.

- [ ] **Step 3: Implement the registry**

Create `src/tiles/registry.ts`:
```ts
import type { FC } from "react";
import type { TileInstance } from "../settings/types";

export interface TileProps<Config = unknown> {
  id: string;
  config: Config;
  updateConfig: (next: Config) => void;
}

export interface TileDefinition<Config = unknown> {
  type: string;
  displayName: string;
  icon?: string;
  defaultConfig: Config;
  component: FC<TileProps<Config>>;
  settingsComponent?: FC<TileProps<Config>>;
}

const registry = new Map<string, TileDefinition<any>>();

export function registerTile<Config>(def: TileDefinition<Config>): void {
  registry.set(def.type, def);
}

export function getTile(type: string): TileDefinition<any> | undefined {
  return registry.get(type);
}

export function clearRegistry(): void {
  registry.clear();
}

export function newInstance(type: string, id: string): TileInstance {
  const def = registry.get(type);
  return { id, type, config: def ? structuredClone(def.defaultConfig) : {} };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- registry`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): tile registry contract"
```

### Task 8: Stub tiles (Clock + Notes)

**Files:**
- Create: `src/tiles/clock/ClockTile.tsx`
- Create: `src/tiles/notes/NotesTile.tsx`
- Create: `src/tiles/index.ts`

- [ ] **Step 1: Implement the Clock tile**

Create `src/tiles/clock/ClockTile.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { TileProps } from "../registry";

export function ClockTile(_: TileProps<{}>) {
  const [now, setNow] = useState(() => new Date().toLocaleTimeString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);
  return <div style={{ padding: 16, fontVariantNumeric: "tabular-nums" }}>{now}</div>;
}
```

- [ ] **Step 2: Implement the Notes tile (exercises config editing)**

Create `src/tiles/notes/NotesTile.tsx`:
```tsx
import type { TileProps } from "../registry";

interface NotesConfig { text: string }

export function NotesTile({ config, updateConfig }: TileProps<NotesConfig>) {
  return (
    <textarea
      style={{ width: "100%", height: "100%", border: "none", padding: 12, resize: "none" }}
      value={config.text}
      onChange={(e) => updateConfig({ text: e.target.value })}
      placeholder="Notes…"
    />
  );
}
```

- [ ] **Step 3: Register both tiles**

Create `src/tiles/index.ts`:
```ts
import { registerTile } from "./registry";
import { ClockTile } from "./clock/ClockTile";
import { NotesTile } from "./notes/NotesTile";

export function registerBuiltinTiles(): void {
  registerTile({ type: "clock", displayName: "Clock", defaultConfig: {}, component: ClockTile });
  registerTile({ type: "notes", displayName: "Notes", defaultConfig: { text: "" }, component: NotesTile });
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): clock and notes stub tiles"
```

---

## Stage 4 — Store, dockview layout, and app assembly

### Task 9: Settings API + Zustand store with debounced save

**Files:**
- Create: `src/settings/api.ts`
- Create: `src/settings/store.ts`
- Modify: `package.json` (add zustand)

- [ ] **Step 1: Install zustand**

Run: `npm install zustand`

- [ ] **Step 2: Typed IPC wrappers**

Create `src/settings/api.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";

export const loadSettings = () => invoke<Settings>("load_settings");
export const saveSettings = (settings: Settings) =>
  invoke<void>("save_settings", { settings });
```

- [ ] **Step 3: Store with debounced persistence**

Create `src/settings/store.ts`:
```ts
import { create } from "zustand";
import type { CockpitConfig, LayoutConfig, Settings } from "./types";
import { saveSettings } from "./api";

interface SettingsState {
  cockpit: CockpitConfig;
  layout: LayoutConfig;
  loaded: boolean;
  init: (s: Settings) => void;
  setCockpit: (c: CockpitConfig) => void;
  setView: (view: string, serialized: unknown) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => SettingsState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { cockpit, layout } = get();
    saveSettings({ cockpit, layout }).catch((e) => console.error("save failed", e));
  }, 500);
}

export const useSettings = create<SettingsState>((set, get) => ({
  cockpit: { version: 1, tiles: [], preferences: { theme: "system", defaultView: "main" } },
  layout: { version: 1, views: {} },
  loaded: false,
  init: (s) => set({ cockpit: s.cockpit, layout: s.layout, loaded: true }),
  setCockpit: (cockpit) => { set({ cockpit }); scheduleSave(get); },
  setView: (view, serialized) => {
    set((st) => ({ layout: { ...st.layout, views: { ...st.layout.views, [view]: serialized } } }));
    scheduleSave(get);
  },
}));
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): settings store with debounced save"
```

### Task 10: Dockview layout component

**Files:**
- Create: `src/layout/Layout.tsx`
- Create: `src/layout/UnknownTile.tsx`
- Modify: `package.json` (add dockview)

- [ ] **Step 1: Install dockview**

Run: `npm install dockview`

- [ ] **Step 2: Unknown-tile placeholder**

Create `src/layout/UnknownTile.tsx`:
```tsx
export function UnknownTile({ type }: { type: string }) {
  return <div style={{ padding: 16, opacity: 0.6 }}>Unknown tile: {type}</div>;
}
```

- [ ] **Step 3: Dockview wrapper that renders tiles from settings**

Create `src/layout/Layout.tsx`:
```tsx
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview";
import "dockview/dist/styles/dockview.css";
import { useSettings } from "../settings/store";
import { getTile } from "../tiles/registry";
import { reconcile } from "../settings/reconcile";
import { UnknownTile } from "./UnknownTile";

// One dockview "component" renders any tile by looking up the registry via panel params.
const components = {
  tile: (props: IDockviewPanelProps<{ tileId: string }>) => {
    const { cockpit, setCockpit } = useSettings();
    const instance = cockpit.tiles.find((t) => t.id === props.params.tileId);
    if (!instance) return <UnknownTile type="(missing)" />;
    const def = getTile(instance.type);
    if (!def) return <UnknownTile type={instance.type} />;
    const Comp = def.component;
    return (
      <Comp
        id={instance.id}
        config={instance.config}
        updateConfig={(next) =>
          setCockpit({
            ...cockpit,
            tiles: cockpit.tiles.map((t) => (t.id === instance.id ? { ...t, config: next } : t)),
          })
        }
      />
    );
  },
};

export function Layout({ view }: { view: string }) {
  const { cockpit, layout, setView } = useSettings();

  const onReady = (event: DockviewReadyEvent) => {
    const serialized = layout.views[view];
    if (serialized) {
      try {
        event.api.fromJSON(serialized as any);
      } catch {
        buildDefault(event);
      }
    } else {
      buildDefault(event);
    }

    // Place any tiles not already in the layout (reconcile step 3).
    const panelIds = event.api.panels.map((p) => (p.params as any)?.tileId).filter(Boolean);
    const { unplacedTiles } = reconcile(cockpit.tiles, panelIds);
    for (const t of unplacedTiles) {
      event.api.addPanel({ id: t.id, component: "tile", title: t.type, params: { tileId: t.id } });
    }

    event.api.onDidLayoutChange(() => setView(view, event.api.toJSON()));
  };

  return <DockviewReact components={components} onReady={onReady} />;
}

function buildDefault(event: DockviewReadyEvent) {
  // first run: empty layout; reconcile will add all tiles as panels
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors. (If dockview's `toJSON`/`fromJSON` types differ in the installed version, adjust the casts — the shape is what matters.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): dockview layout rendering tiles from settings"
```

### Task 11: App assembly — load, render, calm toggle, error banner

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Wire the app together**

Replace `src/App.tsx`:
```tsx
import { useEffect, useState } from "react";
import { loadSettings } from "./settings/api";
import { useSettings } from "./settings/store";
import { registerBuiltinTiles } from "./tiles";
import { Layout } from "./layout/Layout";

registerBuiltinTiles();

function App() {
  const { loaded, cockpit, init, setCockpit } = useSettings();
  const [view, setView] = useState<string>("main");

  useEffect(() => {
    loadSettings()
      .then((s) => { init(s); setView(s.cockpit.preferences.defaultView); })
      .catch((e) => console.error("load failed", e));
  }, [init]);

  if (!loaded) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ display: "flex", gap: 8, padding: 8, borderBottom: "1px solid #ddd" }}>
        <button onClick={() => setView("main")} disabled={view === "main"}>Main</button>
        <button onClick={() => setView("calm")} disabled={view === "calm"}>Calm</button>
        <span style={{ marginLeft: "auto", opacity: 0.5 }}>{cockpit.tiles.length} tiles</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Layout key={view} view={view} />
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Confirm `main.tsx` renders `<App />`**

Ensure `src/main.tsx` mounts `App` (the template already does). No change unless it imports a different root.

- [ ] **Step 3: Run the app and exercise it manually**

Run: `npm run tauri dev`
Expected and verify each:
- Window opens with a top bar (Main / Calm) and a dockview area showing Clock + Notes tiles.
- Drag the Notes tile beside/below the Clock — it moves.
- Type in Notes, quit (Cmd-Q), relaunch → text and layout restored.
- Click Calm → empty/second layout; drag a tile in; relaunch on Calm default if set.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): app assembly with calm/main view toggle"
```

### Task 12: Acceptance — hand-edit and malformed-config behaviour

**Files:** none (manual verification of error handling from the design).

- [ ] **Step 1: Hand-edit adds a tile next launch**

With the app closed, add a third tile to `~/Library/Application Support/com.cockpit.app/cockpit.json` (use the bundle id from `tauri.conf.json`; adjust path accordingly):
```jsonc
{ "id": "notes-2", "type": "notes", "config": { "text": "added by hand" } }
```
Run `npm run tauri dev`.
Expected: a second Notes tile appears (placed by reconcile as unplaced).

- [ ] **Step 2: Malformed config is backed up, app still starts**

Close the app. Corrupt `cockpit.json` (e.g. delete the leading `{`). Run `npm run tauri dev`.
Expected: app starts with default tiles; a `cockpit.json.bak` now exists beside it.

- [ ] **Step 3: Unknown tile type degrades gracefully**

Close the app. Edit a tile's `"type"` to `"frobnicator"`. Launch.
Expected: that panel shows "Unknown tile: frobnicator"; the rest of the layout is intact.

- [ ] **Step 4: Run the full test suite**

Run: `npm test && (cd src-tauri && cargo test)`
Expected: all React + Rust tests pass.

- [ ] **Step 5: Commit a short acceptance note**

```bash
git commit --allow-empty -m "test: manual acceptance of layout shell error handling"
```

---

## Self-Review notes

- **Spec coverage:** scope/boundaries (Task 0–1, scope honored — no terminals/integrations); tile contract (Task 7); two-file settings model (Tasks 2–3, 5); reconciliation join + orphans + unplaced (Task 6, applied in Task 10); data flow & two-command IPC (Tasks 4, 9); calm view as second named layout (Task 11); every error-handling row (Tasks 3 + 12); testing strategy (Rust Tasks 2–3, React Tasks 6–7, manual Task 12). Definition-of-done items all map to Task 11–12.
- **Apply-on-next-launch:** no file watcher anywhere — settings read once in Task 11. ✅
- **Type consistency:** `TileInstance`/`CockpitConfig`/`LayoutConfig`/`Settings` shared between `types.ts` (TS) and `settings.rs` (Rust, with serde renames `type`/`defaultView`); `reconcile()` signature identical in test and impl; registry `getTile`/`registerTile`/`clearRegistry` consistent across Tasks 7–10.
- **Known adjustment point:** dockview's exact `toJSON`/`fromJSON`/`addPanel` types vary by version; Task 10 Step 4 calls this out — match the installed API, keep the data shape.
