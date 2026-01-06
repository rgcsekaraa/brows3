use crate::error::{AppError, Result};
use keyring::Entry;

const SERVICE_NAME: &str = "brows3-credentials";

/// Secure credential storage using OS keychain
pub struct KeychainStorage {
    app_name: String,
}

impl KeychainStorage {
    pub fn new(app_name: &str) -> Self {
        Self {
            app_name: app_name.to_string(),
        }
    }
    
    fn get_entry(&self, key: &str) -> Result<Entry> {
        Entry::new(SERVICE_NAME, &format!("{}-{}", self.app_name, key))
            .map_err(|e| AppError::KeychainError(e.to_string()))
    }
    
    /// Store a secret in the OS keychain
    pub fn store(&self, key: &str, secret: &str) -> Result<()> {
        let entry = self.get_entry(key)?;
        entry
            .set_password(secret)
            .map_err(|e| AppError::KeychainError(e.to_string()))?;
        Ok(())
    }
    
    /// Retrieve a secret from the OS keychain
    pub fn get(&self, key: &str) -> Result<String> {
        let entry = self.get_entry(key)?;
        entry
            .get_password()
            .map_err(|e| AppError::KeychainError(e.to_string()))
    }
    
    /// Delete a secret from the OS keychain
    pub fn delete(&self, key: &str) -> Result<()> {
        let entry = self.get_entry(key)?;
        entry
            .delete_credential()
            .map_err(|e| AppError::KeychainError(e.to_string()))?;
        Ok(())
    }
    
    /// Check if a secret exists in the keychain
    pub fn exists(&self, key: &str) -> bool {
        self.get(key).is_ok()
    }
}
