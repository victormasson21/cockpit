//! keychain.rs — generic secure token store; provider-agnostic so every integration reuses it.
use std::collections::HashMap;
use std::sync::Mutex;

// One secret store scoped to a service name; accounts are arbitrary keys (e.g. "user_token").
pub trait TokenStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

// Real macOS Keychain backing via the `keyring` crate.
pub struct KeyringStore {
    pub service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }
    fn entry(&self, account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, account).map_err(|e| e.to_string())
    }
}

impl TokenStore for KeyringStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.entry(account)?.set_password(secret).map_err(|e| e.to_string())
    }
    // Missing entry is a normal "not set yet" state, not an error.
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match self.entry(account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// In-memory store for unit tests (and a safe fallback off macOS).
#[derive(Default)]
pub struct MemoryStore {
    map: Mutex<HashMap<String, String>>,
}

impl TokenStore for MemoryStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.map.lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.map.lock().unwrap().get(account).cloned())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.map.lock().unwrap().remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_set_get_delete_round_trip() {
        let s = MemoryStore::default();
        assert_eq!(s.get("user_token").unwrap(), None);
        s.set("user_token", "xoxp-abc").unwrap();
        assert_eq!(s.get("user_token").unwrap(), Some("xoxp-abc".into()));
        s.delete("user_token").unwrap();
        assert_eq!(s.get("user_token").unwrap(), None);
    }

    #[test]
    fn delete_missing_is_ok() {
        let s = MemoryStore::default();
        assert!(s.delete("nope").is_ok());
    }
}
