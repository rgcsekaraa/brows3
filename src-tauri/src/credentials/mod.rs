pub mod keychain;
pub mod manager;

pub use keychain::KeychainStorage;
pub use manager::{CredentialType, Profile, ProfileManager};

use crate::error::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;

fn portable_data_dir() -> Option<PathBuf> {
    let env_portable = std::env::var("BROWS3_PORTABLE")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))?;

    if env_portable || exe_dir.join("brows3.portable").exists() {
        Some(exe_dir.join("data"))
    } else {
        None
    }
}

/// Initialize the credentials manager and register it as app state.
/// This must happen during Tauri setup before frontend commands run.
pub fn init<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<()> {
    // When both Linux backends are compiled, make the persistent desktop
    // Secret Service selection explicit. Kernel keyutils is retained only so
    // KeychainStorage can migrate credentials written by older Brows3 builds.
    #[cfg(target_os = "linux")]
    keyring::set_default_credential_builder(keyring::secret_service::default_credential_builder());

    let portable_config_dir = portable_data_dir();
    let force_secret_fallback = portable_config_dir.is_some();
    let config_dir = match portable_config_dir {
        Some(path) => path,
        None => app
            .path()
            .app_config_dir()
            .map_err(|e: tauri::Error| crate::error::AppError::ConfigError(e.to_string()))?,
    };

    // Ensure config directory exists
    std::fs::create_dir_all(&config_dir)?;

    let manager = ProfileManager::new(config_dir, force_secret_fallback)?;
    let state = Arc::new(RwLock::new(manager));

    app.manage(state);

    log::info!(
        "Credentials manager initialized{}",
        if force_secret_fallback {
            " in portable mode"
        } else {
            ""
        }
    );
    Ok(())
}
