//! notepad.rs — the Notepad tab's file: one note.md under <config dir>/notepad, read with its mtime so the
//! frontend can tell an external edit (Claude's) from its own last write.
use crate::commands::config_dir;
use crate::settings::atomic_write;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const NOTE_FILE: &str = "note.md";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub text: String,
    pub mtime_ms: u64,
}

pub fn note_dir_path(config_dir: &Path) -> PathBuf {
    config_dir.join("notepad")
}

fn mtime_ms(path: &Path) -> std::io::Result<u64> {
    let modified = std::fs::metadata(path)?.modified()?;
    Ok(modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

// Missing file = empty note, mtime 0: the editor starts blank and nothing is created until the first save.
pub fn read_note(dir: &Path) -> Result<Note, String> {
    let path = dir.join(NOTE_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Note { text, mtime_ms: mtime_ms(&path).map_err(|e| e.to_string())? }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Note { text: String::new(), mtime_ms: 0 }),
        Err(e) => Err(e.to_string()),
    }
}

// Returns the mtime the write produced, so the frontend can treat that exact stamp as "mine".
pub fn write_note(dir: &Path, text: &str) -> Result<u64, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(NOTE_FILE);
    atomic_write(&path, text).map_err(|e| e.to_string())?;
    mtime_ms(&path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn note_read(app: tauri::AppHandle) -> Result<Note, String> {
    read_note(&note_dir_path(&config_dir(&app)))
}

#[tauri::command(async)]
pub fn note_write(app: tauri::AppHandle, text: String) -> Result<u64, String> {
    write_note(&note_dir_path(&config_dir(&app)), &text)
}

// The claude pane's cwd; created here because a PTY cannot start in a directory that does not exist.
#[tauri::command(async)]
pub fn note_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = note_dir_path(&config_dir(&app));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_note_reads_as_empty_with_mtime_zero() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_note(dir.path()).unwrap(), Note { text: String::new(), mtime_ms: 0 });
    }

    #[test]
    fn write_then_read_round_trips_with_a_real_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let notes = note_dir_path(dir.path());
        let written = write_note(&notes, "hello\n").unwrap();
        let note = read_note(&notes).unwrap();
        assert_eq!(note.text, "hello\n");
        assert_eq!(note.mtime_ms, written);
        assert!(written > 0);
    }

    #[test]
    fn write_creates_the_notepad_directory() {
        let dir = tempfile::tempdir().unwrap();
        let notes = note_dir_path(dir.path());
        assert!(!notes.exists());
        write_note(&notes, "").unwrap();
        assert!(notes.join(NOTE_FILE).is_file());
    }

    #[test]
    fn note_dir_is_the_notepad_folder_under_the_config_dir() {
        assert_eq!(note_dir_path(Path::new("/cfg")), PathBuf::from("/cfg/notepad"));
    }
}
