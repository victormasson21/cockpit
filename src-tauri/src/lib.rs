mod auth;
mod commands;
mod deduce;
mod github;
mod keychain;
mod pr_reviews;
mod pty;
mod settings;
mod shell_env;
mod slack;
mod worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything spawns: adopt the login shell's PATH so `claude`/`gh` resolve even on GUI launch.
    shell_env::fix_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::default())
        .manage(slack::SlackManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            pty::pty_ensure,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            worktree::create_worktree,
            worktree::list_branches,
            worktree::worktree_status,
            worktree::remove_worktree,
            worktree::delete_branch,
            worktree::worktree_diff,
            worktree::worktree_file_diff,
            worktree::resolve_repo_root,
            github::worktree_pr,
            deduce::deduce_worktree,
            slack::slack_set_credentials,
            slack::slack_set_watched,
            slack::slack_connect,
            slack::slack_disconnect,
            slack::slack_status,
            slack::slack_snapshot,
            slack::slack_refresh,
            slack::slack_list_conversations,
            slack::slack_init,
            slack::slack_permalink,
            pr_reviews::pr_reviews_fetch,
            auth::list_connections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
