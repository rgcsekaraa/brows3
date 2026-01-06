pub mod keychain;
pub mod manager;

pub use keychain::KeychainStorage;
pub use manager::{Profile, ProfileManager, CredentialType};

use crate::error::Result;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

/// Initialize the credentials manager and register it as app state
pub async fn init<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<()> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e: tauri::Error| crate::error::AppError::ConfigError(e.to_string()))?;
    
    // Ensure config directory exists
    std::fs::create_dir_all(&config_dir)?;
    
    let manager = ProfileManager::new(config_dir)?;
    let state = Arc::new(RwLock::new(manager));
    
    app.manage(state);
    
    log::info!("Credentials manager initialized");
    Ok(())
}
