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
        .manage(Arc::new(RwLock::new(S3ClientManager::new())))
        .manage(Arc::new(RwLock::new(TransferManager::new())))
        .setup(|app| {
            
            // Initialize logging for both debug and release builds
            // This helps diagnose issues on Windows where crashes are silent
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            
            log::info!("Brows3 starting up...");
            
            // Initialize credentials manager
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = credentials::init(&app_handle).await {
                    log::error!("Failed to initialize credentials manager: {}", e);
                }
            });
            
            // Show the main window after initialization to prevent white flash
            // Window starts hidden (visible: false in config)
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
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
            objects::fetch_all_objects,
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
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Error while running Tauri application: {}", e);
            eprintln!("Error while running Tauri application: {}", e);
        });
}
