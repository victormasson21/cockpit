//! notepad.rs — the notepads' files: one <name>.md per note under <config dir>/notepad, read with its mtime
//! so the frontend can tell an external edit (Claude's) from its own last write.
use crate::commands::config_dir;
use crate::settings::atomic_write;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;


#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub text: String,
    pub mtime_ms: u64,
}

pub fn note_dir_path(config_dir: &Path) -> PathBuf {
    config_dir.join("notepad")
}

// The name becomes a file name, so only [a-z0-9-] passes: no separators, no dots, no way out of the dir.
fn note_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let valid = !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(format!("invalid note name: {name:?}"));
    }
    Ok(dir.join(format!("{name}.md")))
}

fn mtime_ms(path: &Path) -> std::io::Result<u64> {
    let modified = std::fs::metadata(path)?.modified()?;
    Ok(modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

// Missing file = empty note, mtime 0: the editor starts blank and nothing is created until the first save.
pub fn read_note(dir: &Path, name: &str) -> Result<Note, String> {
    let path = note_path(dir, name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Note { text, mtime_ms: mtime_ms(&path).map_err(|e| e.to_string())? }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Note { text: String::new(), mtime_ms: 0 }),
        Err(e) => Err(e.to_string()),
    }
}

// Returns the mtime the write produced, so the frontend can treat that exact stamp as "mine".
pub fn write_note(dir: &Path, name: &str, text: &str) -> Result<u64, String> {
    let path = note_path(dir, name)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    atomic_write(&path, text).map_err(|e| e.to_string())?;
    mtime_ms(&path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn note_read(app: tauri::AppHandle, name: String) -> Result<Note, String> {
    read_note(&note_dir_path(&config_dir(&app)), &name)
}

#[tauri::command(async)]
pub fn note_write(app: tauri::AppHandle, name: String, text: String) -> Result<u64, String> {
    write_note(&note_dir_path(&config_dir(&app)), &name, &text)
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
        assert_eq!(read_note(dir.path(), "note").unwrap(), Note { text: String::new(), mtime_ms: 0 });
    }

    #[test]
    fn write_then_read_round_trips_with_a_real_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let notes = note_dir_path(dir.path());
        let written = write_note(&notes, "note", "hello\n").unwrap();
        let note = read_note(&notes, "note").unwrap();
        assert_eq!(note.text, "hello\n");
        assert_eq!(note.mtime_ms, written);
        assert!(written > 0);
    }

    #[test]
    fn write_creates_the_notepad_directory() {
        let dir = tempfile::tempdir().unwrap();
        let notes = note_dir_path(dir.path());
        assert!(!notes.exists());
        write_note(&notes, "note-1", "").unwrap();
        assert!(notes.join("note-1.md").is_file());
    }

    #[test]
    fn names_that_could_leave_the_notepad_dir_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["", "../x", "a/b", "note.md", "Note"] {
            assert!(write_note(dir.path(), name, "").is_err(), "{name:?} was accepted");
            assert!(read_note(dir.path(), name).is_err(), "{name:?} was accepted");
        }
    }

    #[test]
    fn note_dir_is_the_notepad_folder_under_the_config_dir() {
        assert_eq!(note_dir_path(Path::new("/cfg")), PathBuf::from("/cfg/notepad"));
    }
}
