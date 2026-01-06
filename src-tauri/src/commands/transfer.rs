use crate::commands::profiles::ProfileState;
use crate::s3::S3State;
use crate::transfer::{TransferJob, TransferManager, TransferType};
use crate::error::Result;
use tauri::{State, AppHandle};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::path::PathBuf;

// We need to store the TransferManager in Tauri state
pub type TransferState = Arc<RwLock<TransferManager>>;

#[tauri::command]
pub async fn queue_upload(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    total_bytes: u64,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<String> {
    // Basic validation
    let path = PathBuf::from(&local_path);
    
    let job = TransferJob::new(
        TransferType::Upload,
        bucket_name,
        bucket_region,
        key,
        path,
        total_bytes
    );
    
    let job_id = job.id.clone();
    
    // Add to manager
    {
        let mut manager = transfer_state.write().await;
        // Ensure app handle is set
        manager.set_app_handle(app_handle.clone());
        manager.add_job(job).await;
    } // Drop lock
    
    // Trigger processing (async)
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        // Get active profile
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
            drop(profile_manager);
            let manager = t_state.read().await;
            manager.process_queue(s_state, &profile).await;
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn queue_download(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    total_bytes: u64,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<String> {
    let path = PathBuf::from(&local_path);
    
    let job = TransferJob::new(
        TransferType::Download,
        bucket_name,
        bucket_region,
        key,
        path,
        total_bytes
    );
    
    let job_id = job.id.clone();
    
    // Add to manager
    {
        let mut manager = transfer_state.write().await;
        manager.set_app_handle(app_handle.clone());
        manager.add_job(job).await;
    }
    
    // Trigger processing
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
             drop(profile_manager);
             let manager = t_state.read().await;
             manager.process_queue(s_state, &profile).await;
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn list_transfers(
    transfer_state: State<'_, TransferState>,
) -> Result<Vec<TransferJob>> {
    let manager = transfer_state.read().await;
    Ok(manager.list_jobs().await)
}

#[tauri::command]
pub async fn queue_folder_upload(
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: String,
    local_path: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<u32> {
    use walkdir::WalkDir;
    
    let root = PathBuf::from(&local_path);
    // Calculate parent to determine relative key prefix
    let parent = root.parent().unwrap_or(&root).to_path_buf();
    
    let walker = WalkDir::new(&root).into_iter();
    
    // Blocking walk to gather files
    let jobs_data = tauri::async_runtime::spawn_blocking(move || {
        let mut found = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            if entry.path().is_file() {
                let path = entry.path().to_path_buf();
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                
                // key = prefix + relative_path_from_parent
                // e.g. root=/foo/bar, file=/foo/bar/baz.txt. parent=/foo.
                // relative = bar/baz.txt
                let rel_path = path.strip_prefix(&parent).unwrap_or(&path);
                let rel_str = rel_path.to_string_lossy().replace("\\", "/");
                let key = format!("{}{}", prefix, rel_str);
                
                found.push((path, size, key));
            }
        }
        found
    }).await.map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
    
    let mut manager = transfer_state.write().await;
    manager.set_app_handle(app_handle.clone());
    
    let count = jobs_data.len() as u32;
    for (path, size, key) in jobs_data {
        let job = TransferJob::new(
            TransferType::Upload,
            bucket_name.clone(),
            bucket_region.clone(),
            key,
            path,
            size
        );
        manager.add_job(job).await;
    }
    
    // Spawn worker to process 'count' jobs sequentially
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
            drop(profile_manager);
            let manager = t_state.read().await;
            for _ in 0..count {
                 manager.process_queue(s_state.clone(), &profile).await;
            }
        }
    });

    Ok(count)
}
