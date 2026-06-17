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
