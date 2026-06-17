# Cockpit — Layout Shell & Settings (sub-project 1) — Design

> ✅ **Implemented & merged to `main`.** Built as designed. Notable as-built
> details: dockview **6.6.1** (theme via `theme` prop), React **19**. See
> `../plans/2026-06-16-layout-shell.md` for the executed plan.
>
> First buildable sub-project. The foundation every later feature docks into.
> Product vision: `2026-06-16-cockpit-product-spec.md`. Stack: `../../../CLAUDE.md`.

## Goal

Prove that **a tile is a pluggable unit, and the entire layout (which tiles exist
and where they sit) is just JSON we can save, restore, and copy.** If this is
solid, every later feature — terminals, worktrees, integrations — is an additive
plug-in that registers a tile and (optionally) adds its own IPC.

## Scope

**In scope**

- Tauri v2 + React + TS app frame, window, native menu.
- A three-zone dockable layout (left / centre / right) via **dockview**: resize,
  move a tile between zones, expand a tile into the centre, tabs.
- A **tile registry** — a typed contract any tile implements.
- The **settings store** — two JSON files (user config + layout geometry),
  persisted by the Rust core, exposed to React.
- **Calm view** as a second named saved layout, toggled via `defaultView`.
- A couple of **stub tiles** (Clock, Notes) to exercise the layout. Not real
  features.

**Out of scope** (later sub-projects): real terminals, worktree engine, any
integration/auth, the deduction agent, hotkeys, notifications, live-reload of
settings.

## Decisions locked

- **Layout engine: dockview** (buy, don't build). Purpose-built for VS Code-style
  dockable/tabbed/movable panels, React-native, serializes layout to JSON which
  doubles as our geometry store.
- **Settings split across two files** (below).
- **Apply-on-next-launch**: `cockpit.json` is read once at startup; hand-edits
  while running are picked up next launch. No file watching in this sub-project.
- **Rust = dumb persistence; React = single live store; 2-command IPC.**

## The tile contract

The central abstraction. Every future feature is a tile.

```ts
interface TileDefinition<Config = unknown> {
  type: string;                 // "terminal" | "slack" | "clock" ...
  displayName: string;          // shown in the "add tile" menu
  icon?: string;
  defaultConfig: Config;        // starting settings for a new instance
  component: React.FC<TileProps<Config>>;        // rendered for an instance
  settingsComponent?: React.FC<TileSettingsProps<Config>>; // shown in centre
}

interface TileInstance<Config = unknown> {
  id: string;          // stable, generated
  type: string;        // -> looks up the TileDefinition
  config: Config;      // this instance's settings
  // WHERE it lives (panel id / tab) is owned by dockview, NOT stored here
}
```

Two rules baked in:

1. **Definition vs instance split.** A `TileDefinition` is code, registered at
   startup. A `TileInstance` is data, lives in `cockpit.json`. Adding/removing/
   reconfiguring instances = editing JSON; adding a new *kind* of tile = a code
   change. This is exactly the "editable without changing code" line.
2. **Tiles are layout-dumb.** Dockview owns geometry/placement; a tile owns only
   its `config`. A tile cannot know whether it's in the left column or expanded
   in the centre — which is what lets tiles be freely moved/expanded.

## Settings model — two JSON files

Location: `~/Library/Application Support/cockpit/`.

**`cockpit.json`** — user-meaningful, portable, copyable (dotfiles-friendly).

```jsonc
{
  "version": 1,
  "tiles": [
    { "id": "clock-1", "type": "clock", "config": {} },
    { "id": "notes-1", "type": "notes", "config": { "text": "" } }
  ],
  "preferences": { "theme": "system", "defaultView": "main" }
}
```

**`layout.json`** — high-churn pixel geometry, owned/rewritten by dockview.
Disposable; `.gitignore` it.

```jsonc
{
  "version": 1,
  "views": {
    "main": { /* dockview serialized layout */ },
    "calm": { /* a second saved dockview layout */ }
  }
}
```

**Join + reconciliation (on load):** `layout.json` references tiles by `id` from
`cockpit.json`. On startup:

1. Read both files.
2. For each panel in the active view, look up its `TileInstance` + `TileDefinition`.
3. Any tile instance not placed in the active view → drop into a default spot.
4. Any panel referencing a missing tile id → discard.

This reconciliation is what makes hand-editing `cockpit.json` safe.

Two decisions: a **`version` field from day one** (cheap migrations later), and
**calm view is just a second named layout** (no special rendering path; toggling
= switch active dockview layout).

## Data flow & ownership

```
Startup:
  Rust core ── reads cockpit.json + layout.json
            └─ missing/corrupt → writes/loads defaults, continues
  React ───── invoke("load_settings") → { cockpit, layout }
            └─ builds dockview from layout.views[defaultView]
            └─ renders each panel via tileRegistry[type].component

Runtime (drag/resize/add/remove tile, or edit a tile's config):
  React ──── updates single in-memory store (e.g. Zustand)
        └─── debounced (~500ms) invoke("save_settings", { cockpit, layout })
  Rust ───── atomic write (temp file + rename) to disk
```

- **Rust core owns disk I/O only** — read, atomic-write, defaults-on-missing. No
  tile semantics. Keeps the Rust side tiny and stable.
- **React owns live state** — one store is the single source of truth in-session.
  Dockview layout-change events → update `layout`; tile config edits → update
  `cockpit`. Debounced save flushes both. No per-keystroke disk writes.
- **IPC surface for this sub-project is exactly two commands:** `load_settings`,
  `save_settings`. Later sub-projects add their own commands/events; they don't
  touch these.

## Error handling

| Failure | Behaviour |
|---------|-----------|
| `cockpit.json` missing | Rust writes defaults, continues (first-run path). |
| `cockpit.json` malformed | Back up to `cockpit.json.bak`, load defaults, show dismissible banner. Never silently overwrite the user's hand-edited file. |
| `layout.json` missing/corrupt | Regenerate from defaults silently (disposable). |
| Tile `type` has no registered definition | Render "Unknown tile: X" placeholder; keep the instance in data so a future version restores it. |
| Save fails (disk full/perms) | Keep in-memory state, log, non-blocking toast. Don't lose the session. |

Throughline: **never destroy the user's portable config; never let one bad tile
take down the layout.**

## Testing

- **Rust:** unit-test persistence — defaults-on-missing, atomic-write round-trip,
  malformed → backup + defaults. Pure functions over a temp dir.
- **React:** unit-test the reconciliation logic (join × drop orphans × place
  unplaced) — the riskiest logic, and pure. Unit-test registry lookup.
  Dockview drag/resize interaction tests are brittle → light/manual coverage.
- **Manual acceptance:** add a stub tile; move left→centre; resize; toggle calm
  view; quit + relaunch → layout restored; hand-edit `cockpit.json` to add a
  tile → appears next launch.

## Definition of done

- App launches to a 3-zone layout with stub tiles.
- Tiles can be moved between zones, resized, expanded into centre, tabbed.
- Layout + tile config survive quit/relaunch.
- Calm view toggles to a second saved layout.
- Hand-editing `cockpit.json` (valid) reflects next launch; malformed is backed
  up with defaults loaded, app still starts.
- Rust persistence + React reconciliation unit tests green.
