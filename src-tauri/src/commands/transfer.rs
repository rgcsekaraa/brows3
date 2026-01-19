use crate::commands::profiles::ProfileState;
use crate::s3::S3State;
use crate::transfer::{TransferJob, TransferManager, TransferType};
use crate::error::Result;
use tauri::{State, AppHandle};
use std::sync::Arc;
use std::path::PathBuf;

// We need to store the TransferManager in Tauri state
pub type TransferState = Arc<TransferManager>;

fn validate_path(path: &std::path::Path) -> Result<()> {
    // Basic check for path traversal
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(crate::error::AppError::IoError("Invalid path: contains parent directory reference".to_string()));
        }
    }
    Ok(())
}

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
    validate_path(&path)?;
    
    // Fallback for 0 bytes: try to get size from filesystem
    let mut actual_size = total_bytes;
    if actual_size == 0 {
        if let Ok(metadata) = std::fs::metadata(&path) {
            actual_size = metadata.len();
        }
    }
    
    let job = TransferJob::new(
        TransferType::Upload,
        bucket_name,
        bucket_region,
        key,
        path,
        actual_size
    );
    
    let job_id = job.id.clone();
    
    // Add to manager
    transfer_state.set_app_handle(app_handle.clone()).await;
    transfer_state.add_job(job).await;
    
    // Trigger processing (async)
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        // Get active profile
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
            drop(profile_manager);
            t_state.process_queue(s_state, profile).await;
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
    validate_path(&path)?;
    
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
    transfer_state.set_app_handle(app_handle.clone()).await;
    transfer_state.add_job(job).await;
    
    // Trigger processing
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
             drop(profile_manager);
             t_state.process_queue(s_state, profile).await;
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn list_transfers(
    transfer_state: State<'_, TransferState>,
) -> Result<Vec<TransferJob>> {
    Ok(transfer_state.list_jobs().await)
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
    validate_path(&root)?;
    // Calculate parent to determine relative key prefix
    let parent = root.parent().unwrap_or(&root).to_path_buf();
    
    let walker = WalkDir::new(&root).into_iter();
    
    // Blocking walk to gather files
    let prefix_clone = prefix.clone();
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
                let key = format!("{}{}", prefix_clone, rel_str);
                
                found.push((path, size, key));
            }
        }
        found
    }).await.map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
    
    let current_manager = transfer_state.clone();
    current_manager.set_app_handle(app_handle.clone()).await;
    
    let count = jobs_data.len() as u32;
    let group_id = uuid::Uuid::new_v4().to_string();
    let group_name = format!("s3://{}/{}", bucket_name, prefix);
    
    for (path, size, key) in jobs_data {
        let job = TransferJob::new(
            TransferType::Upload,
            bucket_name.clone(),
            bucket_region.clone(),
            key,
            path,
            size
        ).with_group(group_id.clone(), group_name.clone());
        
        current_manager.add_job(job).await;
    }
    
    // Trigger processing
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
            drop(profile_manager);
            t_state.process_queue(s_state, profile).await;
        }
    });

    Ok(count)
}

#[tauri::command]
pub async fn queue_folder_download(
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: String,
    local_path: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<u32> {
    let root_path = PathBuf::from(&local_path);
    validate_path(&root_path)?;
    
    // 1. List all objects in the prefix
    let profile_manager = profile_state.read().await;
    let profile = profile_manager.get_active_profile().await?
        .ok_or_else(|| crate::error::AppError::ConfigError("No active profile".to_string()))?;
        
    let objects = {
        let mut s3 = s3_state.write().await;
        
        let client = if let Some(ref region) = bucket_region {
            s3.get_client_for_region(&profile, region).await?
        } else {
            s3.get_client(&profile).await?
        };
        
        let mut all_objects = Vec::new();
        let mut continuation_token = None;
        
        loop {
            let mut req = client.list_objects_v2()
                .bucket(&bucket_name)
                .prefix(&prefix);
                
            if let Some(token) = continuation_token {
                req = req.continuation_token(token);
            }
            
            let resp = req.send().await
                .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;
                
            if let Some(contents) = resp.contents {
                for obj in contents {
                    if let (Some(key), Some(size)) = (obj.key, obj.size) {
                        // Skip folder markers (end with / and size 0)
                        if !key.ends_with('/') {
                             all_objects.push((key, size as u64));
                        }
                    }
                }
            }
            
            if resp.is_truncated.unwrap_or(false) {
                continuation_token = resp.next_continuation_token;
            } else {
                break;
            }
        }
        all_objects
    };
    
    let group_id = uuid::Uuid::new_v4().to_string();
    let group_name = format!("s3://{}/{}", bucket_name, prefix);
    let count = objects.len() as u32;
    let root_path = PathBuf::from(&local_path); // This is the destination folder
    
    transfer_state.set_app_handle(app_handle.clone()).await;
    
    for (key, size) in objects {
        let relative_key = if key.starts_with(&prefix) {
            &key[prefix.len()..]
        } else {
            &key
        };
        
        if relative_key.is_empty() { continue; }
        
        let file_path = root_path.join(relative_key);
        validate_path(&file_path)?;
        
        let job = TransferJob::new(
            TransferType::Download,
            bucket_name.clone(),
            bucket_region.clone(),
            key,
            file_path,
            size
        ).with_group(group_id.clone(), group_name.clone());
        
        transfer_state.add_job(job).await;
    }
    
    // Trigger processing
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();
    
    tauri::async_runtime::spawn(async move {
        let profile_manager = p_state.read().await;
        if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
            drop(profile_manager);
            t_state.process_queue(s_state, profile).await;
        }
    });

    Ok(count)
}

#[tauri::command]
pub async fn cancel_transfer(
    job_id: String,
    transfer_state: State<'_, TransferState>,
) -> Result<bool> {
    Ok(transfer_state.cancel_job(&job_id).await)
}

#[tauri::command]
pub async fn retry_transfer(
    job_id: String,
    _app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<Option<String>> {
    let new_id = transfer_state.retry_job(&job_id).await;
    
    // If retry created a new job, trigger processing
    if let Some(_id) = &new_id {
        let t_state = transfer_state.inner().clone();
        let p_state = profile_state.inner().clone();
        let s_state = s3_state.inner().clone();
        
        tauri::async_runtime::spawn(async move {
            let profile_manager = p_state.read().await;
            if let Ok(Some(profile)) = profile_manager.get_active_profile().await {
                drop(profile_manager);
                t_state.process_queue(s_state, profile).await;
            }
        });
    }
    
    Ok(new_id)
}

#[tauri::command]
pub async fn remove_transfer(
    job_id: String,
    transfer_state: State<'_, TransferState>,
) -> Result<bool> {
    Ok(transfer_state.remove_job(&job_id).await)
}

#[tauri::command]
pub async fn clear_completed_transfers(
    transfer_state: State<'_, TransferState>,
) -> Result<usize> {
    Ok(transfer_state.clear_completed().await)
}
