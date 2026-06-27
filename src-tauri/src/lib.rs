mod commands;
mod deduce;
mod github;
mod keychain;
mod pty;
mod settings;
mod worktree;

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
            pty::pty_kill,
            worktree::create_worktree,
            worktree::list_branches,
            deduce::deduce_worktree
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
