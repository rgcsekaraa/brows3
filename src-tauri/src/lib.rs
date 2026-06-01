pub mod commands;
pub mod credentials;
pub mod error;
pub mod s3;
pub mod transfer;

use commands::{buckets, objects, operations, profiles, transfer as transfer_cmd};
use s3::S3ClientManager;
use serde::Serialize;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use transfer::TransferManager;

#[cfg(target_os = "linux")]
fn configure_linux_webkit_environment() {
    // WebKitGTK's DMABUF renderer can abort on some Arch/NVIDIA/Wayland systems
    // with "Could not create default EGL display: EGL_BAD_PARAMETER".
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[derive(Serialize)]
struct LogFileInfo {
    log_file_path: String,
    log_dir_path: String,
    panic_log_path: String,
    panic_log_exists: bool,
}

#[tauri::command]
fn get_log_file_info(app: tauri::AppHandle) -> std::result::Result<LogFileInfo, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    let log_file = log_dir.join(format!("{}.log", app.package_info().name));
    let panic_log = app
        .path()
        .app_config_dir()
        .map_err(|err| err.to_string())?
        .join("panic.log");

    Ok(LogFileInfo {
        log_file_path: log_file.to_string_lossy().into_owned(),
        log_dir_path: log_dir.to_string_lossy().into_owned(),
        panic_log_exists: panic_log.exists(),
        panic_log_path: panic_log.to_string_lossy().into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_webkit_environment();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(RwLock::new(S3ClientManager::new())))
        .manage(Arc::new(TransferManager::new()))
        .setup(|app| {
            // Add native menu on macOS to enable Copy/Paste/Cut/SelectAll/Undo/Redo shortcuts
            // Add native menu to enable standard shortcuts and window controls
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

                let handle = app.handle();

                // File Menu (Windows/Linux) or App Menu (macOS)
                #[cfg(target_os = "macos")]
                let app_menu = Submenu::with_items(
                    handle,
                    "Brows3",
                    true,
                    &[
                        &PredefinedMenuItem::about(handle, None, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::services(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::hide(handle, None)?,
                        &PredefinedMenuItem::hide_others(handle, None)?,
                        &PredefinedMenuItem::show_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
                )?;

                #[cfg(not(target_os = "macos"))]
                let file_menu = Submenu::with_items(
                    handle,
                    "File",
                    true,
                    &[&PredefinedMenuItem::quit(handle, None)?],
                )?;

                // Edit Menu (Common)
                let edit_menu = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(handle, None)?,
                        &PredefinedMenuItem::redo(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::cut(handle, None)?,
                        &PredefinedMenuItem::copy(handle, None)?,
                        &PredefinedMenuItem::paste(handle, None)?,
                        &PredefinedMenuItem::select_all(handle, None)?,
                    ],
                )?;

                // Window Menu (Common)
                let window_menu = Submenu::with_items(
                    handle,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(handle, None)?,
                        &PredefinedMenuItem::maximize(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::close_window(handle, None)?,
                    ],
                )?;

                #[cfg(target_os = "macos")]
                let menu = Menu::with_items(handle, &[&app_menu, &edit_menu, &window_menu])?;

                #[cfg(not(target_os = "macos"))]
                let menu = Menu::with_items(handle, &[&file_menu, &edit_menu, &window_menu])?;

                app.set_menu(menu)?;
            }

            // Initialize logging for both debug and release builds
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Panic Hook for silent crashes
            let handle = app.handle().clone();
            std::panic::set_hook(Box::new(move |info| {
                let location = info
                    .location()
                    .map(|location| {
                        format!(
                            "{}:{}:{}",
                            location.file(),
                            location.line(),
                            location.column()
                        )
                    })
                    .unwrap_or_else(|| "unknown location".to_string());
                let msg = format!(
                    "Panic at {location}: {info:?}\nBacktrace:\n{}",
                    std::backtrace::Backtrace::force_capture()
                );
                log::error!("{}", msg);

                // Also try to write to a file in app data just in case logger is dead
                if let Ok(path) = handle.path().app_config_dir() {
                    let _ = std::fs::create_dir_all(&path);
                    let _ = std::fs::write(path.join("panic.log"), msg);
                }
            }));

            let package_info = app.package_info();
            log::info!(
                "Brows3 starting up: version={}, platform={}-{}",
                package_info.version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            if let Ok(log_dir) = app.path().app_log_dir() {
                log::info!(
                    "Log file path: {}",
                    log_dir
                        .join(format!("{}.log", package_info.name))
                        .to_string_lossy()
                );
            }

            // Initialize credentials manager synchronously before any profile commands can run.
            credentials::init(&app.handle())?;

            // Show the main window after initialization to prevent white flash
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.maximize();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Profile management commands
            profiles::list_profiles,
            profiles::get_profile,
            profiles::add_profile,
            profiles::update_profile,
            profiles::delete_profile,
            profiles::set_active_profile,
            profiles::get_active_profile,
            profiles::test_connection,
            profiles::discover_local_profiles,
            profiles::check_aws_environment,
            // Bucket commands
            buckets::list_buckets,
            buckets::list_buckets_with_regions,
            buckets::get_bucket_region,
            buckets::refresh_s3_client,
            // Object commands
            objects::list_objects,
            objects::search_objects,
            objects::get_presigned_url,
            objects::get_object_content,
            objects::put_object_content,
            // File operations
            operations::put_object,
            operations::get_object,
            operations::delete_object,
            operations::copy_object,
            operations::move_object,
            operations::delete_objects,
            operations::get_object_metadata,
            // Transfer commands
            transfer_cmd::queue_upload,
            transfer_cmd::queue_download,
            transfer_cmd::list_transfers,
            transfer_cmd::queue_folder_upload,
            transfer_cmd::queue_folder_download,
            transfer_cmd::cancel_transfer,
            transfer_cmd::retry_transfer,
            transfer_cmd::remove_transfer,
            transfer_cmd::clear_completed_transfers,
            transfer_cmd::set_transfer_concurrency,
            get_log_file_info,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Error while running Tauri application: {}", e);
            eprintln!("Error while running Tauri application: {}", e);
        });
}
