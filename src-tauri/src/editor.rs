//! editor.rs — the one place that launches VS Code. Sibling of `git.rs::run`, `github.rs::run_gh`,
//! `deduce.rs::run_claude` and `slack.rs::api_get`: the binary path and the spawn policy live here once.
use std::process::Command;

use crate::commands::config_dir;
use crate::settings::atomic_write;

// The CLI inside the app bundle, not a bare `code`: the login-shell PATH fix finds tools a package
// manager installed, but VS Code's `code` shim is only on PATH if the user ran "Install 'code' command
// in PATH" — this one is there as soon as the app is.
const VSCODE_CLI: &str = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";

// Hand the CLI one target — a folder, or a workspace file. It returns as soon as the running app has
// taken the request, so this reads the exit status rather than spawning and forgetting.
fn launch(target: &str) -> Result<(), String> {
    let out = Command::new(VSCODE_CLI)
        .arg(target)
        .output()
        .map_err(|e| format!("couldn't launch VS Code ({VSCODE_CLI}): {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

// Open one folder, or several as a single multi-root window. `name` only titles the generated workspace
// file, which lives beside the config files rather than in any repo — nothing to gitignore.
#[tauri::command(async)]
pub fn open_in_editor(app: tauri::AppHandle, name: String, paths: Vec<String>) -> Result<(), String> {
    let target = match paths.as_slice() {
        [] => return Err("no folder to open".to_string()),
        [only] => only.clone(),
        many => {
            let file = config_dir(&app).join(workspace_file_name(&name));
            atomic_write(&file, &workspace_json(many))
                .map_err(|e| format!("couldn't write the workspace file: {e}"))?;
            file.to_string_lossy().to_string()
        }
    };
    launch(&target)
}

// A multi-root window is a generated `.code-workspace` file — VS Code has no argv form for "open these
// folders as one window", and `--add` would target whichever window happens to be frontmost.
fn workspace_json(paths: &[String]) -> String {
    let folders: Vec<serde_json::Value> = paths.iter().map(|p| serde_json::json!({ "path": p })).collect();
    serde_json::json!({ "folders": folders }).to_string()
}

// Worktree names are free text ("Sentry round-up"), so slug them before they become a filename.
fn workspace_file_name(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let parts: Vec<&str> = slug.split('-').filter(|p| !p.is_empty()).collect();
    let stem = if parts.is_empty() { "worktree".to_string() } else { parts.join("-") };
    format!("{stem}.code-workspace")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_json_lists_every_folder() {
        let json = workspace_json(&["/a".to_string(), "/b".to_string()]);
        assert_eq!(json, r#"{"folders":[{"path":"/a"},{"path":"/b"}]}"#);
    }

    #[test]
    fn workspace_file_name_slugs_the_worktree_name() {
        assert_eq!(workspace_file_name("Sentry round-up"), "sentry-round-up.code-workspace");
    }

    #[test]
    fn workspace_file_name_collapses_runs_of_punctuation() {
        assert_eq!(workspace_file_name("ENG-2255 / social — signup!"), "eng-2255-social-signup.code-workspace");
    }

    #[test]
    fn workspace_file_name_falls_back_when_the_name_has_no_usable_characters() {
        assert_eq!(workspace_file_name("///"), "worktree.code-workspace");
    }
}
