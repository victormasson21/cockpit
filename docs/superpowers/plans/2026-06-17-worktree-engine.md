# Worktree Engine (sub-project 2, manual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user manually create a connected git worktree (repo + branch → real `git worktree add`) and work in it via one composite tile that runs 3 live terminals (git / local host / Claude Code), editable links, and a recent-worktrees dropdown with status.

**Architecture:** Provider + panel. A Rust **PTY provider** owns a registry of live shells keyed by `(worktreeId, role)`, streaming output over Tauri events to xterm.js and replaying a bounded scrollback on re-attach. A Rust **git-worktree provider** runs `git worktree add`. A React **composite `worktree` tile** is a pure viewer over worktree *data* stored in `cockpit.json`; its config is just `{ worktreeId }`.

**Tech Stack:** Tauri v2, Rust (`portable-pty`), React 19 + TS, xterm.js (`@xterm/xterm`, `@xterm/addon-fit`), Zustand, dockview.

## Global Constraints

- **Learning project:** one-line role comment at the top of every file; one-line intent comment atop each significant block. High-signal only — explain intent, not syntax.
- **Minimalism:** smallest thing that works; no styling gold-plating; fewer files/deps/abstractions until one is needed.
- **Dual-definition discipline:** every persisted shape exists as a Rust serde struct AND a mirrored TS type (camelCase via `#[serde(rename)]`), exactly like sub-project 1.
- **Backward-compatible config:** new `cockpit.json` fields use `#[serde(default)]` so existing files without them still load. `version` stays `1`.
- **IPC untouched:** `load_settings` / `save_settings` keep working; new commands are added alongside.
- **Tauri arg casing:** JS passes camelCase params (`worktreeId`); Rust receives snake_case (`worktree_id`) — Tauri converts automatically.
- **Tests:** Rust `cd src-tauri && cargo test`; frontend `npm test` (Vitest). Headless build checks: `cargo build`, `npm run build`, `npx tsc --noEmit`. The GUI window the user eyeballs.
- **Bytes over IPC:** PTY output and scrollback travel as `Vec<u8>` (Rust) ↔ `number[]` (JS), reconstructed as `Uint8Array` for `term.write()`. No base64, no lossy UTF-8.

---

### Task 1: Rename `cockpit-scaffold` → `cockpit`

Isolated quick win, no dependencies. Bundle id `com.cockpit.app` is already correct — do not touch it.

**Files:**
- Modify: `src-tauri/Cargo.toml` (package `name`, `lib.name`)
- Modify: `src-tauri/src/main.rs:5` (crate ref)
- Modify: `src-tauri/tauri.conf.json` (`productName`, window `title`)
- Modify: `package.json` (`name`)

- [ ] **Step 1: Rename the Rust crate**

In `src-tauri/Cargo.toml` set `name = "cockpit"` under `[package]`, and `name = "cockpit_lib"` under `[lib]`.

- [ ] **Step 2: Update the binary entrypoint**

In `src-tauri/src/main.rs`, change the call to the renamed lib crate:

```rust
fn main() {
    cockpit_lib::run()
}
```

- [ ] **Step 3: Update app-facing names**

In `src-tauri/tauri.conf.json` set `"productName": "cockpit"` and the window `"title": "cockpit"`. In `package.json` set `"name": "cockpit"`.

- [ ] **Step 4: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: compiles; no reference to `cockpit_scaffold_lib` remains.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/tauri.conf.json package.json
git commit -m "chore: rename cockpit-scaffold -> cockpit"
```

---

### Task 2: Rust PTY provider (`pty.rs`)

The core new tech: a registry of live PTYs, streaming output over Tauri events, with a bounded replay buffer. Pure helpers (`pty_id`, `push_scrollback`) are unit-tested; live spawn is exercised manually later.

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (declare module, manage state, register commands)
- Modify: `src-tauri/Cargo.toml` (add `portable-pty`)

**Interfaces:**
- Produces (IPC commands, JS-callable):
  - `pty_ensure(worktreeId: string, role: string, cwd: string, autostartCmd?: string, cols: number, rows: number) -> string` (the ptyId; idempotent)
  - `pty_attach(ptyId: string) -> number[]` (scrollback bytes)
  - `pty_write(ptyId: string, bytes: number[])`
  - `pty_resize(ptyId: string, cols: number, rows: number)`
  - `pty_kill(ptyId: string)`
  - Output event per pty: name `pty://{ptyId}`, payload `number[]`.
- Produces (Rust): `pub fn pty_id(worktree_id: &str, role: &str) -> String`.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml` under `[dependencies]` add:

```toml
portable-pty = "0.8"
```

- [ ] **Step 2: Write failing unit tests for the pure helpers**

Create `src-tauri/src/pty.rs` with only the tests + the two pure helpers' signatures referenced. Start with the tests:

```rust
//! pty.rs — PTY provider: spawns real shells per (worktree, role), streams output to the webview, keeps replayable scrollback.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use portable_pty::{native_pty_system, CommandBuilder, Child, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

const SCROLLBACK_CAP: usize = 64 * 1024; // ~64 KB replay buffer per PTY

// Compose the stable id used as both the registry key and the output event channel name.
pub fn pty_id(worktree_id: &str, role: &str) -> String {
    format!("{worktree_id}:{role}")
}

// Append output to the bounded buffer, dropping oldest bytes past the cap so replay stays small.
fn push_scrollback(buf: &Arc<Mutex<Vec<u8>>>, chunk: &[u8]) {
    let mut b = buf.lock().unwrap();
    b.extend_from_slice(chunk);
    if b.len() > SCROLLBACK_CAP {
        let overflow = b.len() - SCROLLBACK_CAP;
        b.drain(0..overflow);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_id_joins_worktree_and_role() {
        assert_eq!(pty_id("wt-1", "git"), "wt-1:git");
    }

    #[test]
    fn scrollback_is_bounded_keeping_newest() {
        let buf = Arc::new(Mutex::new(Vec::new()));
        push_scrollback(&buf, &vec![b'a'; SCROLLBACK_CAP + 10]);
        push_scrollback(&buf, b"END");
        let b = buf.lock().unwrap();
        assert_eq!(b.len(), SCROLLBACK_CAP);
        assert_eq!(&b[b.len() - 3..], b"END");
    }
}
```

- [ ] **Step 3: Run tests to verify they fail to compile/pass**

Run: `cd src-tauri && cargo test pty::`
Expected: FAIL — unused imports (`HashMap`, `Read`, etc.) cause warnings/errors until the provider below is added; the two tests themselves should pass once the file compiles. (If compile errors block, proceed to Step 4 which adds the consumers of those imports.)

- [ ] **Step 4: Add the registry + spawn + streaming**

Append to `src-tauri/src/pty.rs` (above the `#[cfg(test)]` block):

```rust
// One live terminal: master (resize), child (kill), writer (input), and a bounded replay buffer.
struct LivePty {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
    scrollback: Arc<Mutex<Vec<u8>>>,
}

// Registry of all live PTYs, keyed by "{worktreeId}:{role}". Tauri-managed shared state.
#[derive(Default)]
pub struct PtyManager {
    table: Mutex<HashMap<String, LivePty>>,
}

// Spawn a shell for (worktree, role) if one isn't already alive; idempotent so the tile can call it on every mount.
#[tauri::command]
pub fn pty_ensure(
    app: AppHandle,
    manager: State<PtyManager>,
    worktree_id: String,
    role: String,
    cwd: String,
    autostart_cmd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let id = pty_id(&worktree_id, &role);
    let mut table = manager.table.lock().unwrap();
    if table.contains_key(&id) {
        return Ok(id); // already alive — re-attach happens via pty_attach
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    // Login shell so it inherits the user's PATH (npm/claude must resolve even when launched from Finder).
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&cwd);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave); // master then sees EOF when the child exits
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    // Auto-start roles (host/claude) run their command as the first input line.
    if let Some(c) = autostart_cmd.as_ref().filter(|c| !c.is_empty()) {
        let _ = writeln!(writer, "{c}");
    }
    let scrollback = Arc::new(Mutex::new(Vec::new()));
    // Reader thread: stream master output to the webview + replay buffer until the child exits.
    let ev = format!("pty://{id}");
    let buf = scrollback.clone();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let bytes = chunk[..n].to_vec();
                    push_scrollback(&buf, &bytes);
                    let _ = app.emit(&ev, bytes);
                }
            }
        }
        // Child exited / pipe closed: tell the pane so the restart control is meaningful (spec §G).
        let _ = app.emit(&ev, b"\r\n[process exited]\r\n".to_vec());
    });
    table.insert(id.clone(), LivePty { master: pair.master, child, writer, scrollback });
    Ok(id)
}

// Return buffered scrollback so a re-attaching tile can replay recent output.
#[tauri::command]
pub fn pty_attach(manager: State<PtyManager>, pty_id: String) -> Vec<u8> {
    let table = manager.table.lock().unwrap();
    table.get(&pty_id).map(|p| p.scrollback.lock().unwrap().clone()).unwrap_or_default()
}

// Forward keystrokes to the child.
#[tauri::command]
pub fn pty_write(manager: State<PtyManager>, pty_id: String, bytes: Vec<u8>) -> Result<(), String> {
    let mut table = manager.table.lock().unwrap();
    let pty = table.get_mut(&pty_id).ok_or("no such pty")?;
    pty.writer.write_all(&bytes).map_err(|e| e.to_string())?;
    pty.writer.flush().map_err(|e| e.to_string())
}

// Resize the PTY when xterm refits.
#[tauri::command]
pub fn pty_resize(manager: State<PtyManager>, pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let table = manager.table.lock().unwrap();
    let pty = table.get(&pty_id).ok_or("no such pty")?;
    pty.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

// Kill the child and drop the entry (used by the per-pane restart/stop control).
#[tauri::command]
pub fn pty_kill(manager: State<PtyManager>, pty_id: String) -> Result<(), String> {
    if let Some(mut pty) = manager.table.lock().unwrap().remove(&pty_id) {
        let _ = pty.child.kill();
    }
    Ok(())
}
```

- [ ] **Step 5: Wire the module, state, and commands into the app**

In `src-tauri/src/lib.rs`: add `mod pty;` at the top alongside the existing modules, and update the builder:

```rust
mod commands;
mod pty;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            pty::pty_ensure,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Run tests + build**

Run: `cd src-tauri && cargo test pty:: && cargo build`
Expected: both `pty::tests` pass; crate builds clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat(pty): Rust PTY provider with per-worktree registry, streaming, scrollback"
```

---

### Task 3: Frontend terminal — `useTerminal` hook + `TerminalPane`

Wires one xterm.js instance to one ptyId via the Task 2 commands. GUI piece: verified by build/tsc here; live behaviour is confirmed in Task 8's manual check.

**Files:**
- Create: `src/worktrees/useTerminal.ts`
- Create: `src/worktrees/TerminalPane.tsx`
- Modify: `package.json` (add `@xterm/xterm`, `@xterm/addon-fit`)

**Interfaces:**
- Consumes: Task 2 commands `pty_ensure`, `pty_attach`, `pty_write`, `pty_resize`, `pty_kill`; event `pty://{ptyId}`.
- Produces:
  - `useTerminal(args: { worktreeId: string; role: string; cwd: string; autostartCmd?: string }): { containerRef: React.RefObject<HTMLDivElement>; restart: () => void }`
  - `<TerminalPane worktreeId role cwd autostartCmd title />` React component.

- [ ] **Step 1: Install xterm**

Run: `npm install @xterm/xterm @xterm/addon-fit`
Expected: both added to `dependencies`.

- [ ] **Step 2: Write the hook**

Create `src/worktrees/useTerminal.ts`:

```ts
// useTerminal.ts — binds one xterm.js instance to one Rust PTY: ensure -> attach (replay) -> stream -> input/resize.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export interface UseTerminalArgs {
  worktreeId: string;
  role: string;
  cwd: string;
  autostartCmd?: string;
}

// Mount an xterm into a div and keep it attached to the (worktree, role) PTY for the component's lifetime.
export function useTerminal({ worktreeId, role, cwd, autostartCmd }: UseTerminalArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string>(`${worktreeId}:${role}`);

  useEffect(() => {
    const ptyId = `${worktreeId}:${role}`;
    ptyIdRef.current = ptyId;
    const term = new Terminal({ convertEol: false, fontSize: 12 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    fit.fit();

    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    // ensure the PTY exists, replay its scrollback, then live-stream new output.
    // A failed spawn (e.g. missing worktree path / bad shell) rejects here and is shown in-pane (spec §G).
    (async () => {
      try {
        await invoke("pty_ensure", {
          worktreeId, role, cwd, autostartCmd, cols: term.cols, rows: term.rows,
        });
        const scrollback = await invoke<number[]>("pty_attach", { ptyId });
        if (disposed) return;
        term.write(new Uint8Array(scrollback));
        unlisten = await listen<number[]>(`pty://${ptyId}`, (e) => term.write(new Uint8Array(e.payload)));
      } catch (e) {
        if (!disposed) term.write(`\r\n[failed to start: ${String(e)}]\r\n`);
      }
    })();

    const onData = term.onData((data) =>
      invoke("pty_write", { ptyId, bytes: Array.from(new TextEncoder().encode(data)) })
    );
    const onResize = term.onResize(({ cols, rows }) => invoke("pty_resize", { ptyId, cols, rows }));
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current!);

    // detach (do NOT kill): switching worktrees leaves the process running in the background.
    return () => {
      disposed = true;
      unlisten?.();
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [worktreeId, role, cwd, autostartCmd]);

  // restart: kill then re-ensure for a wedged process.
  const restart = () => {
    const ptyId = ptyIdRef.current;
    invoke("pty_kill", { ptyId }).then(() =>
      invoke("pty_ensure", { worktreeId, role, cwd, autostartCmd, cols: 80, rows: 24 })
    );
  };

  return { containerRef, restart };
}
```

- [ ] **Step 3: Write the pane component**

Create `src/worktrees/TerminalPane.tsx`:

```tsx
// TerminalPane.tsx — one labelled terminal pane (title bar + restart) wrapping a single PTY-bound xterm.
import { useTerminal, type UseTerminalArgs } from "./useTerminal";

export function TerminalPane({ title, ...args }: UseTerminalArgs & { title: string }) {
  const { containerRef, restart } = useTerminal(args);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px", fontSize: 11, opacity: 0.7 }}>
        <span>{title}</span>
        <button style={{ marginLeft: "auto", fontSize: 11 }} onClick={restart}>restart</button>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; bundle builds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/worktrees/useTerminal.ts src/worktrees/TerminalPane.tsx
git commit -m "feat(terminal): xterm.js pane + useTerminal hook bound to the PTY provider"
```

---

### Task 4: Worktree data model — Rust structs, TS types, store actions, pure helpers

Adds the `worktrees` array to persisted config (backward-compatible) and the pure domain helpers the tile will use.

**Files:**
- Modify: `src-tauri/src/settings.rs` (structs + default + test)
- Modify: `src/settings/types.ts` (mirrored types)
- Modify: `src/settings/store.ts` (worktree actions)
- Create: `src/worktrees/model.ts` (pure helpers)
- Create: `src/worktrees/model.test.ts`

**Interfaces:**
- Produces (TS types): `HostConfig { startCmd; address }`, `WorktreeLink { label; url }`, `WorktreeStatus = "ongoing" | "completed"`, `Worktree { id; name; repoPath; branch; worktreePath; host; links; status }`; `CockpitConfig.worktrees: Worktree[]`.
- Produces (store actions): `addWorktree(wt)`, `updateWorktree(id, patch: Partial<Worktree>)`, `removeWorktree(id)`.
- Produces (model helpers): `makeWorktree(fields) -> Worktree`, `addLink(links, link)`, `updateLink(links, i, patch)`, `removeLink(links, i)`.

- [ ] **Step 1: Write failing Rust test for backward-compat load**

In `src-tauri/src/settings.rs`, add to the `tests` module:

```rust
#[test]
fn cockpit_without_worktrees_field_still_loads() {
    let json = r#"{"version":1,"tiles":[],"preferences":{"theme":"system","defaultView":"main"}}"#;
    let cfg: CockpitConfig = serde_json::from_str(json).unwrap();
    assert!(cfg.worktrees.is_empty());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test cockpit_without_worktrees`
Expected: FAIL to compile — `CockpitConfig` has no `worktrees` field yet.

- [ ] **Step 3: Add the Rust structs + field + default**

In `src-tauri/src/settings.rs`, add the new structs after `TileInstance`:

```rust
// Local dev server for a worktree: command to start it + the address it serves on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HostConfig {
    #[serde(rename = "startCmd")]
    pub start_cmd: String,
    pub address: String,
}

// A user-editable useful link attached to a worktree (ticket / design / preview).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorktreeLink {
    pub label: String,
    pub url: String,
}

// A worktree: a name + git location (repo/branch/worktree) + local host + links + status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Worktree {
    pub id: String,
    pub name: String,
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    pub branch: String,
    #[serde(rename = "worktreePath")]
    pub worktree_path: String,
    pub host: HostConfig,
    pub links: Vec<WorktreeLink>,
    pub status: String,
}
```

Add the field to `CockpitConfig` (with `#[serde(default)]` so old files load):

```rust
pub struct CockpitConfig {
    pub version: u32,
    pub tiles: Vec<TileInstance>,
    #[serde(default)]
    pub worktrees: Vec<Worktree>,
    pub preferences: Preferences,
}
```

In `impl Default for CockpitConfig`, add `worktrees: vec![],` to the constructed value (place it after `tiles`).

- [ ] **Step 4: Run Rust tests to verify pass**

Run: `cd src-tauri && cargo test settings::`
Expected: PASS — the new test plus the existing default/round-trip tests stay green (round-trip now includes an empty `worktrees`).

- [ ] **Step 5: Mirror the TS types**

In `src/settings/types.ts`, add above `CockpitConfig`:

```ts
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
```

And add the field to `CockpitConfig`:

```ts
export interface CockpitConfig {
  version: number;
  tiles: TileInstance[];
  worktrees: Worktree[];
  preferences: Preferences;
}
```

Update the store's initial state in `src/settings/store.ts` so the default `cockpit` includes `worktrees: []` (the `create(...)` default object): change it to
`cockpit: { version: 1, tiles: [], worktrees: [], preferences: { theme: "system", defaultView: "main" } }`.

- [ ] **Step 6: Add store actions**

In `src/settings/store.ts`, extend the `SettingsState` interface with:

```ts
  addWorktree: (wt: Worktree) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  removeWorktree: (id: string) => void;
```

Import `Worktree` from `./types`, and add the implementations inside `create(...)` (they reuse `setCockpit`, which already schedules the debounced save):

```ts
  addWorktree: (wt) => {
    const { cockpit, setCockpit } = get();
    setCockpit({ ...cockpit, worktrees: [...cockpit.worktrees, wt] });
  },
  updateWorktree: (id, patch) => {
    const { cockpit, setCockpit } = get();
    setCockpit({
      ...cockpit,
      worktrees: cockpit.worktrees.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    });
  },
  removeWorktree: (id) => {
    const { cockpit, setCockpit } = get();
    setCockpit({ ...cockpit, worktrees: cockpit.worktrees.filter((w) => w.id !== id) });
  },
```

- [ ] **Step 7: Write failing tests for the pure model helpers**

Create `src/worktrees/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeWorktree, addLink, updateLink, removeLink } from "./model";

describe("makeWorktree", () => {
  it("defaults status to ongoing and links to empty", () => {
    const wt = makeWorktree({
      id: "wt-1", name: "fix login", repoPath: "/r", branch: "b",
      worktreePath: "/wt", host: { startCmd: "npm run dev", address: "http://localhost:3000" },
    });
    expect(wt.status).toBe("ongoing");
    expect(wt.links).toEqual([]);
    expect(wt.name).toBe("fix login");
  });
});

describe("links reducers", () => {
  const base = [{ label: "Ticket", url: "u1" }];
  it("addLink appends", () => {
    expect(addLink(base, { label: "Design", url: "u2" })).toHaveLength(2);
  });
  it("updateLink patches by index", () => {
    expect(updateLink(base, 0, { url: "u9" })[0]).toEqual({ label: "Ticket", url: "u9" });
  });
  it("removeLink drops by index", () => {
    expect(removeLink(base, 0)).toEqual([]);
  });
  it("does not mutate the input array", () => {
    addLink(base, { label: "X", url: "y" });
    expect(base).toHaveLength(1);
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npm test -- model`
Expected: FAIL — `./model` does not exist.

- [ ] **Step 9: Implement the pure helpers**

Create `src/worktrees/model.ts`:

```ts
// model.ts — pure helpers for worktree domain data (creation defaults + immutable link editing). No IO.
import type { Worktree, WorktreeLink } from "../settings/types";

// Build a worktree model from resolved fields, applying defaults (ongoing, no links).
export function makeWorktree(
  fields: Omit<Worktree, "status" | "links"> & Partial<Pick<Worktree, "status" | "links">>,
): Worktree {
  return { status: "ongoing", links: [], ...fields };
}

// Append a link (returns a new array).
export function addLink(links: WorktreeLink[], link: WorktreeLink): WorktreeLink[] {
  return [...links, link];
}

// Patch the link at index i (returns a new array).
export function updateLink(links: WorktreeLink[], i: number, patch: Partial<WorktreeLink>): WorktreeLink[] {
  return links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
}

// Remove the link at index i (returns a new array).
export function removeLink(links: WorktreeLink[], i: number): WorktreeLink[] {
  return links.filter((_, idx) => idx !== i);
}
```

- [ ] **Step 10: Run all tests + type-check**

Run: `npm test && npx tsc --noEmit && cd src-tauri && cargo test settings::`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/settings.rs src/settings/types.ts src/settings/store.ts src/worktrees/model.ts src/worktrees/model.test.ts
git commit -m "feat(model): worktree data model (Rust+TS), store actions, pure helpers"
```

---

### Task 5: Git-worktree provider (`worktree.rs`) + frontend api wrapper

Real `git worktree add` (existing + new branch). Argv construction and managed-path derivation are pure and unit-tested; the actual git call is integration-ish (manual).

**Files:**
- Create: `src-tauri/src/worktree.rs`
- Modify: `src-tauri/src/lib.rs` (declare module + register command)
- Create: `src/worktrees/api.ts` (typed wrapper)

**Interfaces:**
- Produces (IPC): `create_worktree(repoPath: string, name: string, spec: BranchSpec) -> string` (resolved worktreePath). `BranchSpec` is a tagged union: `{ kind: "existing", branch }` or `{ kind: "new", branch, base }`.
- Produces (Rust, pure): `slug(&str) -> String`, `managed_path(home, repo_path, name) -> PathBuf`, `worktree_add_args(worktree_path, &BranchSpec) -> Vec<String>`.
- Produces (TS): `createWorktree(repoPath, name, spec): Promise<string>`, `type BranchSpec`.

- [ ] **Step 1: Write failing unit tests for the pure helpers**

Create `src-tauri/src/worktree.rs`:

```rust
//! worktree.rs — git-worktree provider: derives a managed path and runs `git worktree add` for a new or existing branch.
use std::path::{Path, PathBuf};
use std::process::Command;

// Existing branch checkout vs. a new branch cut from a base. Deserialized from the frontend's tagged JSON.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BranchSpec {
    Existing { branch: String },
    New { branch: String, base: String },
}

// Lowercase dash-separated slug so a worktree name maps to a safe directory name.
pub fn slug(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

// Managed location: ~/CockpitWorktrees/<repo-basename>/<slug>.
pub fn managed_path(home: &Path, repo_path: &str, name: &str) -> PathBuf {
    let repo_base = Path::new(repo_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".into());
    home.join("CockpitWorktrees").join(repo_base).join(slug(name))
}

// Build the `git worktree add` argv for a branch spec (pure; tested without invoking git).
pub fn worktree_add_args(worktree_path: &str, spec: &BranchSpec) -> Vec<String> {
    match spec {
        BranchSpec::Existing { branch } => {
            vec!["worktree".into(), "add".into(), worktree_path.into(), branch.clone()]
        }
        BranchSpec::New { branch, base } => vec![
            "worktree".into(), "add".into(), "-b".into(), branch.clone(),
            worktree_path.into(), base.clone(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalizes_case_and_separators() {
        assert_eq!(slug("Fix Login Bug"), "fix-login-bug");
        assert_eq!(slug("  Weird__Name!! "), "weird-name");
    }

    #[test]
    fn managed_path_uses_repo_basename_and_slug() {
        let p = managed_path(Path::new("/home/me"), "/Users/me/Repos/elder-api", "Fix Login");
        assert_eq!(p, PathBuf::from("/home/me/CockpitWorktrees/elder-api/fix-login"));
    }

    #[test]
    fn add_args_existing_branch() {
        let a = worktree_add_args("/wt", &BranchSpec::Existing { branch: "fex".into() });
        assert_eq!(a, vec!["worktree", "add", "/wt", "fex"]);
    }

    #[test]
    fn add_args_new_branch_from_base() {
        let a = worktree_add_args(
            "/wt",
            &BranchSpec::New { branch: "victor/fix".into(), base: "main".into() },
        );
        assert_eq!(a, vec!["worktree", "add", "-b", "victor/fix", "/wt", "main"]);
    }
}
```

- [ ] **Step 2: Run tests to verify they pass (pure logic only)**

Run: `cd src-tauri && cargo test worktree::`
Expected: PASS — but the file has an unused `Command` import + no command yet (warnings only). Proceed to add the command.

- [ ] **Step 3: Add the `create_worktree` command**

Append to `src-tauri/src/worktree.rs` (above `#[cfg(test)]`):

```rust
// Run `git worktree add` into the managed location; returns the resolved worktree path or git's stderr.
#[tauri::command]
pub fn create_worktree(
    app: tauri::AppHandle,
    repo_path: String,
    name: String,
    spec: BranchSpec,
) -> Result<String, String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let wt = managed_path(&home, &repo_path, &name);
    let wt_str = wt.to_string_lossy().to_string();
    let args = worktree_add_args(&wt_str, &spec);
    let out = Command::new("git")
        .current_dir(&repo_path)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(wt_str)
}
```

- [ ] **Step 4: Register the module + command**

In `src-tauri/src/lib.rs`, add `mod worktree;` with the other modules and add `worktree::create_worktree` to the `generate_handler!` list (after the pty commands).

- [ ] **Step 5: Write the frontend api wrapper**

Create `src/worktrees/api.ts`:

```ts
// api.ts — typed wrappers over the worktree IPC commands.
import { invoke } from "@tauri-apps/api/core";

// Mirrors the Rust BranchSpec tagged union.
export type BranchSpec =
  | { kind: "existing"; branch: string }
  | { kind: "new"; branch: string; base: string };

// Run `git worktree add`; resolves to the created worktree path, rejects with git's stderr.
export const createWorktree = (repoPath: string, name: string, spec: BranchSpec) =>
  invoke<string>("create_worktree", { repoPath, name, spec });
```

- [ ] **Step 6: Build + test**

Run: `cd src-tauri && cargo test worktree:: && cargo build && cd .. && npx tsc --noEmit`
Expected: tests pass, both build/type-check clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/worktree.rs src-tauri/src/lib.rs src/worktrees/api.ts
git commit -m "feat(worktree): git worktree add provider (existing + new branch) + api wrapper"
```

---

### Task 6: Worktree composite tile — skeleton, dropdown, status, links

The viewer shell: resolves the active worktree from `config.worktreeId`, renders the recent-worktrees dropdown (with status toggle) and the editable links list. Terminals (Task 8) and the form (Task 7) slot in next. Registered so it renders in the layout.

**Files:**
- Create: `src/tiles/worktree/WorktreeTile.tsx`
- Create: `src/tiles/worktree/LinksList.tsx`
- Modify: `src/tiles/index.ts` (register the tile)

**Interfaces:**
- Consumes: store (`useSettings`: `cockpit.worktrees`, `updateWorktree`, `removeWorktree`), `pty_kill` (Task 2) for remove, `model.ts` link reducers, `tauri-plugin-opener` `open`.
- Produces: tile `type: "worktree"`, config shape `{ worktreeId?: string }`; `<LinksList worktreeId links />`.

- [ ] **Step 1: Write the links list component**

Create `src/tiles/worktree/LinksList.tsx`:

```tsx
// LinksList.tsx — editable list of a worktree's useful links; clicking opens in the default browser.
import { open } from "@tauri-apps/plugin-opener";
import type { WorktreeLink } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { addLink, updateLink, removeLink } from "../../worktrees/model";

export function LinksList({ worktreeId, links }: { worktreeId: string; links: WorktreeLink[] }) {
  const { updateWorktree } = useSettings();
  const commit = (next: WorktreeLink[]) => updateWorktree(worktreeId, { links: next });
  return (
    <div style={{ padding: 6, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <strong>Links</strong>
        <button style={{ marginLeft: "auto" }} onClick={() => commit(addLink(links, { label: "New", url: "" }))}>+ link</button>
      </div>
      {links.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <input value={l.label} placeholder="label" style={{ width: 90 }}
            onChange={(e) => commit(updateLink(links, i, { label: e.target.value }))} />
          <input value={l.url} placeholder="https://…" style={{ flex: 1 }}
            onChange={(e) => commit(updateLink(links, i, { url: e.target.value }))} />
          <button disabled={!l.url} onClick={() => open(l.url)}>open</button>
          <button onClick={() => commit(removeLink(links, i))}>✕</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the tile skeleton**

Create `src/tiles/worktree/WorktreeTile.tsx`:

```tsx
// WorktreeTile.tsx — composite viewer for one worktree: recent dropdown + status + links (terminals/form added in later tasks).
import { invoke } from "@tauri-apps/api/core";
import type { TileProps } from "../registry";
import { useSettings } from "../../settings/store";
import { LinksList } from "./LinksList";

// This instance's config: which worktree to display.
interface WorktreeConfig { worktreeId?: string }

const ROLES = ["git", "host", "claude"] as const;

export function WorktreeTile({ config, updateConfig }: TileProps<WorktreeConfig>) {
  const { cockpit, updateWorktree, removeWorktree } = useSettings();
  const worktrees = cockpit.worktrees;
  const active = worktrees.find((w) => w.id === config.worktreeId);

  // remove: kill the worktree's 3 PTYs, drop the model, clear the selection (spec §C remove_worktree).
  const removeActive = async () => {
    if (!active) return;
    for (const role of ROLES) await invoke("pty_kill", { ptyId: `${active.id}:${role}` });
    removeWorktree(active.id);
    updateConfig({ worktreeId: undefined });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* recent-worktrees dropdown + status toggle + remove */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderBottom: "1px solid #eee" }}>
        <select value={config.worktreeId ?? ""} onChange={(e) => updateConfig({ worktreeId: e.target.value || undefined })}>
          <option value="">— select worktree —</option>
          {worktrees.map((w) => (
            <option key={w.id} value={w.id}>{w.name} [{w.status}]</option>
          ))}
        </select>
        {active && (
          <>
            <button onClick={() => updateWorktree(active.id, { status: active.status === "ongoing" ? "completed" : "ongoing" })}>
              mark {active.status === "ongoing" ? "completed" : "ongoing"}
            </button>
            <button onClick={removeActive}>remove</button>
          </>
        )}
      </div>

      {!active ? (
        <div style={{ padding: 12, opacity: 0.6 }}>No worktree selected.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ padding: "4px 6px", fontSize: 12, opacity: 0.7 }}>
            {active.branch} · {active.worktreePath}
          </div>
          {/* terminals slot in here in Task 8 */}
          <LinksList worktreeId={active.id} links={active.links} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register the tile**

In `src/tiles/index.ts`, import and register:

```ts
import { WorktreeTile } from "./worktree/WorktreeTile";
```

Add inside `registerBuiltinTiles()`:

```ts
  registerTile({ type: "worktree", displayName: "Worktree", defaultConfig: {}, component: WorktreeTile });
```

- [ ] **Step 4: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/tiles/worktree/WorktreeTile.tsx src/tiles/worktree/LinksList.tsx src/tiles/index.ts
git commit -m "feat(tile): worktree composite tile skeleton — dropdown, status, links"
```

---

### Task 7: Collapsible new-worktree form

Manual create flow: a collapsible form that calls `create_worktree`, builds the model, stores it, and selects it. Collapsible is the sub-project-3 seam.

**Files:**
- Create: `src/tiles/worktree/NewWorktreeForm.tsx`
- Modify: `src/tiles/worktree/WorktreeTile.tsx` (mount the form)

**Interfaces:**
- Consumes: `createWorktree` + `BranchSpec` (Task 5 api), `makeWorktree` (Task 4), store `addWorktree`.
- Produces: `<NewWorktreeForm onCreated={(worktreeId) => void} />`.

- [ ] **Step 1: Write the form component**

Create `src/tiles/worktree/NewWorktreeForm.tsx`:

```tsx
// NewWorktreeForm.tsx — collapsible manual form: runs git worktree add, stores the model, selects it. Collapsible = sub-project-3 inference seam.
import { useState } from "react";
import { createWorktree, type BranchSpec } from "../../worktrees/api";
import { makeWorktree } from "../../worktrees/model";
import { useSettings } from "../../settings/store";

export function NewWorktreeForm({ onCreated }: { onCreated: (worktreeId: string) => void }) {
  const { addWorktree } = useSettings();
  const [open, setOpen] = useState(true); // expanded by default while fields are empty
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("main");
  const [startCmd, setStartCmd] = useState("npm run dev");
  const [address, setAddress] = useState("http://localhost:3000");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // submit: create the git worktree, then persist + select the model.
  const submit = async () => {
    setError(null);
    setBusy(true);
    const spec: BranchSpec = mode === "existing" ? { kind: "existing", branch } : { kind: "new", branch, base };
    try {
      const worktreePath = await createWorktree(repoPath, name, spec);
      const id = `wt-${Date.now()}`;
      addWorktree(makeWorktree({
        id, name, repoPath, branch, worktreePath,
        host: { startCmd, address },
      }));
      onCreated(id);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <div style={{ padding: 6 }}><button onClick={() => setOpen(true)}>+ new worktree</button></div>;
  }

  return (
    <div style={{ padding: 8, borderBottom: "1px solid #eee", fontSize: 12, display: "grid", gap: 4 }}>
      <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="repo path (/Users/…/repo)" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <label><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> new branch</label>
        <label><input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> existing</label>
      </div>
      <input placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
      {mode === "new" && <input placeholder="base branch" value={base} onChange={(e) => setBase(e.target.value)} />}
      <input placeholder="start command" value={startCmd} onChange={(e) => setStartCmd(e.target.value)} />
      <input placeholder="host address" value={address} onChange={(e) => setAddress(e.target.value)} />
      {error && <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button disabled={busy || !name || !repoPath || !branch} onClick={submit}>{busy ? "creating…" : "create"}</button>
        <button disabled={busy} onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the form in the tile**

In `src/tiles/worktree/WorktreeTile.tsx`, import the form (`import { NewWorktreeForm } from "./NewWorktreeForm";`) and render it directly under the dropdown row, wiring create→select:

```tsx
      <NewWorktreeForm onCreated={(id) => updateConfig({ worktreeId: id })} />
```

(Place it between the dropdown `</div>` and the `{!active ? …}` block.)

- [ ] **Step 3: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/tiles/worktree/NewWorktreeForm.tsx src/tiles/worktree/WorktreeTile.tsx
git commit -m "feat(tile): collapsible new-worktree form wired to create_worktree"
```

---

### Task 8: Wire the 3 terminal panes into the tile

Render git / host / claude `TerminalPane`s for the active worktree. Re-keying by worktree id makes switching tear down + re-attach cleanly (processes survive in Rust).

**Files:**
- Modify: `src/tiles/worktree/WorktreeTile.tsx`

**Interfaces:**
- Consumes: `<TerminalPane>` (Task 3); active worktree's `worktreePath` + `host.startCmd`.

- [ ] **Step 1: Render the three panes**

In `src/tiles/worktree/WorktreeTile.tsx`, import the pane (`import { TerminalPane } from "../../worktrees/TerminalPane";`) and replace the `{/* terminals slot in here in Task 8 */}` comment with a re-keyed terminals stack:

```tsx
          <div key={active.id} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <TerminalPane title="git" worktreeId={active.id} role="git" cwd={active.worktreePath} />
            <TerminalPane title="host" worktreeId={active.id} role="host" cwd={active.worktreePath} autostartCmd={active.host.startCmd} />
            <TerminalPane title="claude" worktreeId={active.id} role="claude" cwd={active.worktreePath} autostartCmd="claude" />
          </div>
```

The `key={active.id}` is deliberate: changing the dropdown remounts the panes for the new worktree (detach old, attach new) without killing the old worktree's processes.

- [ ] **Step 2: Verify build + type-check**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/tiles/worktree/WorktreeTile.tsx
git commit -m "feat(tile): render git/host/claude terminals for the active worktree"
```

---

### Task 9: First-run default + acceptance + docs

Make the worktree tile appear on first launch, run the full headless verification, do the manual GUI acceptance, and update the as-built docs.

**Files:**
- Modify: `src-tauri/src/settings.rs` (default tiles + test)
- Modify: `CLAUDE.md` (as-built notes + status)
- Modify: `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md` (mark item 2 status)

- [ ] **Step 1: Add a worktree tile to the default config (failing test first)**

In `src-tauri/src/settings.rs`, update `cockpit_default_has_two_stub_tiles` to expect the new tile — rename it and assert three tiles:

```rust
#[test]
fn cockpit_default_includes_worktree_tile() {
    let c = CockpitConfig::default();
    assert_eq!(c.tiles.len(), 3);
    assert_eq!(c.tiles[2].tile_type, "worktree");
    assert!(c.worktrees.is_empty());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test cockpit_default_includes_worktree`
Expected: FAIL — default still has 2 tiles.

- [ ] **Step 3: Add the tile to the default**

In `impl Default for CockpitConfig`, append to the `tiles` vec a third entry:

```rust
                TileInstance { id: "worktree-1".into(), tile_type: "worktree".into(), config: serde_json::json!({}) },
```

- [ ] **Step 4: Full headless verification**

Run:
```bash
cd src-tauri && cargo test && cargo build && cd .. && npm test && npx tsc --noEmit && npm run build
```
Expected: all Rust + JS tests green; both builds succeed.

- [ ] **Step 5: Manual GUI acceptance (ask the user to eyeball)**

Run: `npm run tauri dev` (blocking, opens the native window). Ask the user to confirm:
1. The worktree tile renders with the dropdown + collapsible form.
2. Create a worktree (new branch, a real local repo) → form collapses, dropdown selects it, 3 terminals appear; **host** and **claude** panes auto-run their commands; the **git** pane is an interactive shell at the worktree path.
3. Add a second worktree, switch the dropdown to it and back → the first worktree's dev server is still running (scrollback replays, no restart).
4. Edit a link → `open` launches the browser; toggle status ongoing↔completed.
5. Quit + relaunch → the active worktree's 3 terminals respawn.

- [ ] **Step 6: Update as-built docs**

In `CLAUDE.md`: under "As-built notes" record the PTY provider (`pty.rs`, registry keyed by `worktreeId:role`, `pty://{id}` events, 64 KB scrollback), the git provider (`worktree.rs`, managed root `~/CockpitWorktrees/<repo>/<name>`), the worktree composite tile + `worktrees` array in `cockpit.json`, and the new IPC commands. Note the scaffold rename is done. Under "Status", mark sub-project 2 complete and point "Next" at sub-project 3 (smart new-worktree). In `docs/superpowers/specs/2026-06-16-cockpit-product-spec.md`, mark decomposition item 2 as ✅.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/settings.rs CLAUDE.md docs/superpowers/specs/2026-06-16-cockpit-product-spec.md
git commit -m "feat: worktree tile in default layout; docs + status for sub-project 2"
```

---

## Notes for the implementer

- **No new capability entries needed.** Custom `invoke` commands and Rust-side event emit/listen are covered by the existing `core:default`. Don't edit `src-tauri/capabilities/default.json`.
- **PTY processes are background-owned by Rust.** Never kill on tile unmount — only on the explicit `restart` control. This is what lets a dev server survive a worktree switch.
- **`git worktree add` needs a clean state.** When testing manually, use a real repo and a branch name that doesn't already have a worktree, or git will (correctly) error into the form.
- **Bytes, not strings, over IPC** for PTY output — preserves non-UTF-8 and avoids codepoint splitting.
