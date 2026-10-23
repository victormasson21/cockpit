//! claude_session.rs — the newest Claude Code conversation for a directory, read from Claude Code's own
//! transcript store: ~/.claude/projects/<encoded cwd>/<session id>.jsonl.
use std::path::Path;
use std::time::SystemTime;
use tauri::Manager;

// Claude Code's folder name for a cwd: every non-alphanumeric character becomes '-'. Its convention, not a
// documented contract — pinned against real folders (`/Application Support/com.cockpit.app` → `-Application-Support-com-cockpit-app`).
fn project_dir_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

// The id is typed into a shell as `claude --resume <id>`, so only uuid characters pass.
fn is_session_id(stem: &str) -> bool {
    !stem.is_empty() && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// Newest top-level transcript by mtime. A missing folder means Claude never ran there: no session, not an error.
fn latest_session_in(dir: &Path) -> Result<Option<String>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let newest = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let path = e.path();
            let stem = path.file_stem()?.to_str()?.to_owned();
            let transcript = path.extension().is_some_and(|x| x == "jsonl") && is_session_id(&stem);
            transcript.then_some((meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), stem))
        })
        .max_by_key(|(modified, _)| *modified);
    Ok(newest.map(|(_, stem)| stem))
}

#[tauri::command(async)]
pub fn latest_claude_session(app: tauri::AppHandle, cwd: String) -> Result<Option<String>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    latest_session_in(&home.join(".claude").join("projects").join(project_dir_name(&cwd)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::time::Duration;

    const OLD_ID: &str = "1b0250d1-022e-46ba-a088-c1a33f34b5da";
    const NEW_ID: &str = "be83c1b6-b9d7-4e0c-9498-16af432a9082";

    fn transcript(dir: &Path, name: &str, age_secs: u64) {
        let file = File::create(dir.join(name)).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(age_secs)).unwrap();
    }

    #[test]
    fn encodes_the_cwd_like_claude_code() {
        assert_eq!(project_dir_name("/Users/me/CockpitWorktrees/cockpit/notepad"), "-Users-me-CockpitWorktrees-cockpit-notepad");
        assert_eq!(project_dir_name("/Users/me/.claude"), "-Users-me--claude");
        assert_eq!(
            project_dir_name("/Users/me/Library/Application Support/com.cockpit.app/notepad"),
            "-Users-me-Library-Application-Support-com-cockpit-app-notepad",
        );
        assert_eq!(project_dir_name("/a/snake_case"), "-a-snake-case");
    }

    #[test]
    fn picks_the_most_recently_written_transcript() {
        let dir = tempfile::tempdir().unwrap();
        transcript(dir.path(), &format!("{OLD_ID}.jsonl"), 60);
        transcript(dir.path(), &format!("{NEW_ID}.jsonl"), 1);
        assert_eq!(latest_session_in(dir.path()).unwrap().as_deref(), Some(NEW_ID));
    }

    #[test]
    fn ignores_folders_other_files_and_unsafe_names() {
        let dir = tempfile::tempdir().unwrap();
        transcript(dir.path(), &format!("{OLD_ID}.jsonl"), 60);
        fs::create_dir(dir.path().join(format!("{NEW_ID}.jsonl"))).unwrap();
        transcript(dir.path(), "notes.txt", 1);
        transcript(dir.path(), "x;rm -rf ~.jsonl", 1);
        assert_eq!(latest_session_in(dir.path()).unwrap().as_deref(), Some(OLD_ID));
    }

    #[test]
    fn a_missing_or_empty_folder_has_no_session() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(latest_session_in(dir.path()).unwrap(), None);
        assert_eq!(latest_session_in(&dir.path().join("never-ran-here")).unwrap(), None);
    }
}
