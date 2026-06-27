//! auth.rs — connections registry: one row per integration's auth status. Backs the Settings "Connections" section.
use serde::Serialize;
use tauri::State;
use crate::slack::SlackManager;

// One service's connection status for the Settings UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Connection {
    pub service: String,
    pub connected: bool,
    pub label: String,
}

// Build the label shown beside a service ("Connected as <user>" / "Not connected").
pub fn connection_label(connected: bool, user: Option<&str>) -> String {
    match (connected, user) {
        (true, Some(u)) if !u.is_empty() => format!("Connected as {u}"),
        (true, _) => "Connected".into(),
        (false, _) => "Not connected".into(),
    }
}

// The full registry. One entry (Slack) today; later tiles push more rows.
#[tauri::command]
pub fn list_connections(manager: State<SlackManager>) -> Vec<Connection> {
    let st = manager.state.lock().unwrap();
    vec![Connection {
        service: "slack".into(),
        connected: st.connected,
        label: connection_label(st.connected, st.user_name.as_deref()),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_reflects_state() {
        assert_eq!(connection_label(true, Some("U123")), "Connected as U123");
        assert_eq!(connection_label(true, None), "Connected");
        assert_eq!(connection_label(false, None), "Not connected");
    }
}
