pub mod commands;
pub mod credentials;
pub mod error;
pub mod s3;
pub mod transfer;

use commands::{profiles, buckets, objects, operations, transfer as transfer_cmd};
use s3::S3ClientManager;
use transfer::TransferManager;
use std::sync::Arc;
use tokio::sync::RwLock;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(RwLock::new(S3ClientManager::new())))
        .manage(Arc::new(RwLock::new(TransferManager::new())))
        .setup(|app| {
            // Add native menu on macOS to enable Copy/Paste/Cut/SelectAll/Undo/Redo shortcuts
            // Add native menu to enable standard shortcuts and window controls
            {
                use tauri::menu::{Menu, Submenu, PredefinedMenuItem};
                
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
                    &[
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
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
                let msg = format!("Panic: {:?}", info);
                log::error!("{}", msg);
                
                // Also try to write to a file in app data just in case logger is dead
                if let Ok(path) = handle.path().app_config_dir() {
                     let _ = std::fs::create_dir_all(&path);
                     let _ = std::fs::write(path.join("panic.log"), msg);
                }
            }));
            
            log::info!("Brows3 starting up...");
            
            // Initialize credentials manager
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = credentials::init(&app_handle).await {
                    log::error!("Failed to initialize credentials manager: {}", e);
                }
            });
            
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
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Error while running Tauri application: {}", e);
            eprintln!("Error while running Tauri application: {}", e);
        });
}
