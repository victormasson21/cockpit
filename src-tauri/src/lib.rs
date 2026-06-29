mod auth;
mod commands;
mod deduce;
mod github;
mod keychain;
mod pty;
mod settings;
mod slack;
mod worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            auth::list_connections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
