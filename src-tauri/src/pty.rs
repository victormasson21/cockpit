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

impl PtyManager {
    // Stop every live PTY (app shutdown). `child.kill()` is portable-pty's unix ChildKiller impl for
    // std::process::Child: it sends SIGHUP directly to the shell's pid (escalating to SIGKILL only if
    // the shell is still alive after a short grace period), and the shell — a session leader — forwards
    // that HUP to its job-control children, which is what actually reaches grandchildren like `claude`
    // or a `npm run dev` server. Dropping the master here is incidental, not the mechanism: the master
    // fd is dup'd three times (this struct, the reader thread, the writer), so dropping one copy does
    // not hang up the line. Do not "simplify" this to an explicit SIGKILL — SIGKILL can't be handled,
    // so the shell would never get the chance to relay it and grandchild cleanup would break. Returns
    // the count killed.
    pub fn kill_all(&self) -> usize {
        let mut table = self.table.lock().unwrap();
        let n = table.len();
        for (_, mut pty) in table.drain() {
            let _ = pty.child.kill();
        }
        n
    }
}

// The environment Claude Code reads for display: advertise truecolor + a known TERM for capability
// detection, and CLAUDE_CODE_NO_FLICKER so it renders in its fullscreen alternate-screen TUI.
fn terminal_env() -> [(&'static str, &'static str); 3] {
    [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("CLAUDE_CODE_NO_FLICKER", "1"),
    ]
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
    for (k, v) in terminal_env() {
        cmd.env(k, v);
    }
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

// Which PTYs are actually alive, as their registry ids. Powers the slot picker's activity marker
// (displayed / running / paused). `try_wait` is the point: a key is only removed by pty_kill/kill_all,
// so a shell the user `exit`ed leaves its entry behind and `table.keys()` alone would report it as
// running. Read-only — dead entries are left in place, because removing them here would change
// pty_ensure's "already alive -> reattach" early return. Memory-only, so it stays a sync command.
fn live_ids(manager: &PtyManager) -> Vec<String> {
    let mut table = manager.table.lock().unwrap();
    table
        .iter_mut()
        .filter_map(|(id, pty)| matches!(pty.child.try_wait(), Ok(None)).then(|| id.clone()))
        .collect()
}

#[tauri::command]
pub fn pty_live_ids(manager: State<PtyManager>) -> Vec<String> {
    live_ids(&manager)
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

    #[test]
    fn terminal_env_advertises_truecolor_term_and_fullscreen() {
        let env = terminal_env();
        assert!(env.contains(&("TERM", "xterm-256color")));
        assert!(env.contains(&("COLORTERM", "truecolor")));
        assert!(env.contains(&("CLAUDE_CODE_NO_FLICKER", "1")));
    }

    // kill_all must both deregister and really kill: a reader cloned off the master only completes
    // (EOF, or EIO on macOS) once the child is gone, so a live child would time out here.
    #[test]
    fn kill_all_drains_the_registry_and_kills_the_child() {
        use std::time::Duration;
        let manager = PtyManager::default();
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = CommandBuilder::new("sleep");
        cmd.arg("60");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        manager.table.lock().unwrap().insert(
            pty_id("wt-test", "claude"),
            LivePty { master: pair.master, child, writer, scrollback: Arc::new(Mutex::new(Vec::new())) },
        );

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 64];
            // Err (EIO) and Ok(0) both mean "the pty is finished"; either ends the read.
            let _ = tx.send(reader.read(&mut buf).unwrap_or(0));
        });

        assert_eq!(manager.kill_all(), 1);
        assert!(manager.table.lock().unwrap().is_empty());
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 0, "child should be dead");
    }

    // Register a real spawned child under `id` so liveness can be probed as the command does.
    fn insert_child(manager: &PtyManager, id: &str, program: &str, args: &[&str]) {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = CommandBuilder::new(program);
        for a in args {
            cmd.arg(a);
        }
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let writer = pair.master.take_writer().unwrap();
        manager.table.lock().unwrap().insert(
            id.to_string(),
            LivePty { master: pair.master, child, writer, scrollback: Arc::new(Mutex::new(Vec::new())) },
        );
    }

    // The picker's "running" marker must not be fooled by a registry key whose child already exited
    // (only pty_kill/kill_all remove keys, so an exited shell leaves one behind).
    #[test]
    fn live_ids_lists_running_children_and_omits_exited_ones() {
        let manager = PtyManager::default();
        insert_child(&manager, &pty_id("wt-alive", "claude"), "sleep", &["60"]);
        insert_child(&manager, &pty_id("wt-dead", "claude"), "true", &[]);

        // Give the short-lived child time to exit and be reaped by try_wait.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let ids = live_ids(&manager);
            if !ids.contains(&pty_id("wt-dead", "claude")) {
                assert_eq!(ids, vec![pty_id("wt-alive", "claude")]);
                break;
            }
            assert!(std::time::Instant::now() < deadline, "exited child still reported live: {ids:?}");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        manager.kill_all();
    }
}
