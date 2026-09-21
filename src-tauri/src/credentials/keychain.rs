use crate::error::{AppError, Result};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const SERVICE_NAME: &str = "brows3-credentials";
const FALLBACK_SECRETS_FILE: &str = "secrets.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsData {
    #[serde(default)]
    secrets: HashMap<String, String>,
}

/// Secure credential storage using OS keychain
pub struct KeychainStorage {
    app_name: String,
    fallback_path: PathBuf,
    force_fallback: bool,
}

impl KeychainStorage {
    pub fn new(app_name: &str, config_dir: &Path, force_fallback: bool) -> Self {
        Self {
            app_name: app_name.to_string(),
            fallback_path: config_dir.join(FALLBACK_SECRETS_FILE),
            force_fallback,
        }
    }

    fn get_entry(&self, key: &str) -> Result<Entry> {
        Entry::new(SERVICE_NAME, &format!("{}-{}", self.app_name, key))
            .map_err(|e| AppError::KeychainError(e.to_string()))
    }

    #[cfg(target_os = "linux")]
    fn get_legacy_linux_entry(&self, key: &str) -> Result<Entry> {
        let credential = keyring::keyutils::KeyutilsCredential::new_with_target(
            None,
            SERVICE_NAME,
            &format!("{}-{}", self.app_name, key),
        )
        .map_err(|e| AppError::KeychainError(e.to_string()))?;

        Ok(Entry::new_with_credential(Box::new(credential)))
    }

    fn read_fallback_secrets(&self) -> Result<SecretsData> {
        if !self.fallback_path.exists() {
            return Ok(SecretsData::default());
        }

        let content = fs::read_to_string(&self.fallback_path)?;
        if content.trim().is_empty() {
            return Ok(SecretsData::default());
        }

        serde_json::from_str(&content).map_err(|e| {
            AppError::SerializationError(format!("Failed to parse fallback secrets store: {}", e))
        })
    }

    fn write_fallback_secrets(&self, data: &SecretsData) -> Result<()> {
        let content = serde_json::to_string_pretty(data)?;
        super::write_private_file(&self.fallback_path, content.as_bytes())
    }

    fn store_fallback(&self, key: &str, secret: &str) -> Result<()> {
        let mut data = self.read_fallback_secrets()?;
        data.secrets.insert(key.to_string(), secret.to_string());
        self.write_fallback_secrets(&data)
    }

    fn get_fallback(&self, key: &str) -> Result<String> {
        let data = self.read_fallback_secrets()?;
        data.secrets.get(key).cloned().ok_or_else(|| {
            AppError::KeychainError("Secret not found in fallback storage".to_string())
        })
    }

    fn delete_fallback(&self, key: &str) -> Result<()> {
        let mut data = self.read_fallback_secrets()?;
        data.secrets.remove(key);
        self.write_fallback_secrets(&data)
    }

    /// Store a secret in the OS keychain
    pub fn store(&self, key: &str, secret: &str) -> Result<()> {
        if self.force_fallback {
            return self.store_fallback(key, secret);
        }

        let entry = self.get_entry(key)?;
        match entry.set_password(secret) {
            Ok(()) => {
                self.delete_fallback(key)?;
                Ok(())
            }
            Err(err) => {
                log::warn!(
                    "Native keychain store failed for '{}', falling back to local secrets file: {}",
                    key,
                    err
                );
                self.store_fallback(key, secret)
            }
        }
    }

    /// Retrieve a secret from the OS keychain
    pub fn get(&self, key: &str) -> Result<String> {
        if self.force_fallback {
            return self.get_fallback(key);
        }

        // Fallback writes supersede native values left behind by a failed write.
        if let Some(secret) = self.read_fallback_secrets()?.secrets.get(key) {
            return Ok(secret.clone());
        }
        let entry = self.get_entry(key)?;
        match entry.get_password() {
            Ok(secret) => Ok(secret),
            Err(err) => {
                log::warn!("Native keychain read failed for '{}': {}", key, err);

                // v0.2.43 and older selected Linux kernel keyutils, whose
                // entries disappear on reboot. If an entry is still present
                // in this login session, migrate it immediately to Secret
                // Service (or the fallback file if Secret Service is down).
                #[cfg(target_os = "linux")]
                if let Ok(legacy_entry) = self.get_legacy_linux_entry(key) {
                    if let Ok(secret) = legacy_entry.get_password() {
                        if let Err(migration_err) = entry.set_password(&secret) {
                            log::warn!(
                                "Secret Service migration failed for '{}', using local fallback: {}",
                                key,
                                migration_err
                            );
                            self.store_fallback(key, &secret)?;
                        } else {
                            let _ = legacy_entry.delete_credential();
                            let _ = self.delete_fallback(key);
                        }
                        return Ok(secret);
                    }
                }

                log::warn!("Trying local secrets file for '{}'", key);
                self.get_fallback(key)
            }
        }
    }

    /// Delete a secret from the OS keychain
    pub fn delete(&self, key: &str) -> Result<()> {
        if self.force_fallback {
            return self.delete_fallback(key);
        }

        let entry = self.get_entry(key)?;
        if let Err(err) = entry.delete_credential() {
            if !matches!(err, keyring::Error::NoEntry) {
                return Err(AppError::KeychainError(err.to_string()));
            }
            log::warn!(
                "Native keychain delete failed for '{}', clearing local fallback if present: {}",
                key,
                err
            );
        }
        #[cfg(target_os = "linux")]
        if let Ok(legacy_entry) = self.get_legacy_linux_entry(key) {
            let _ = legacy_entry.delete_credential();
        }
        self.delete_fallback(key)
    }

    /// Check if a secret exists in the keychain
    pub fn exists(&self, key: &str) -> bool {
        self.get(key).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::KeychainStorage;

    #[test]
    fn fallback_value_is_authoritative_even_when_native_storage_is_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let storage = KeychainStorage::new("isolated-review-test", dir.path(), false);
        storage.store_fallback("revision", "new-value").unwrap();
        // Must return without touching the real OS keychain.
        assert_eq!(storage.get("revision").unwrap(), "new-value");
    }

    #[test]
    fn fallback_replacement_keeps_other_secrets_and_reports_corrupt_storage() {
        let directory = tempfile::tempdir().unwrap();
        let storage = KeychainStorage::new("test", directory.path(), true);
        storage.store("first", "first-secret").unwrap();
        storage.store("second", "second-secret").unwrap();
        assert_eq!(storage.get("first").unwrap(), "first-secret");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&storage.fallback_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::write(&storage.fallback_path, "{invalid").unwrap();
        assert!(storage.delete("first").is_err());
        assert_eq!(
            std::fs::read_to_string(&storage.fallback_path).unwrap(),
            "{invalid"
        );
    }

    #[test]
    fn failed_private_file_replacement_preserves_the_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("existing");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("keep"), "original").unwrap();
        assert!(crate::credentials::write_private_file(&destination, b"replacement").is_err());
        assert_eq!(
            std::fs::read_to_string(destination.join("keep")).unwrap(),
            "original"
        );
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn forced_fallback_stores_reads_and_deletes_secret() {
        let config_dir =
            std::env::temp_dir().join(format!("brows3-keychain-test-{}", uuid::Uuid::new_v4()));
        let storage = KeychainStorage::new("brows3-test", &config_dir, true);

        storage.store("profile-1", "secret-value").unwrap();
        assert_eq!(storage.get("profile-1").unwrap(), "secret-value");

        storage.delete("profile-1").unwrap();
        assert!(storage.get("profile-1").is_err());

        let _ = std::fs::remove_dir_all(config_dir);
    }
}
