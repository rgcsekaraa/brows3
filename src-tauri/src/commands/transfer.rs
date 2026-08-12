use crate::commands::profiles::ProfileState;
use crate::credentials::Profile;
use crate::error::Result;
use crate::s3::S3State;
use crate::transfer::{TransferJob, TransferManager, TransferType};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

// We need to store the TransferManager in Tauri state
pub type TransferState = Arc<TransferManager>;

async fn list_folder_objects(
    client: &aws_sdk_s3::Client,
    bucket_name: &str,
    prefix: &str,
) -> Result<Vec<(String, u64)>> {
    let mut all_objects = Vec::new();
    let mut continuation_token = None;

    loop {
        let mut req = client.list_objects_v2().bucket(bucket_name).prefix(prefix);

        if let Some(ref token) = continuation_token {
            req = req.continuation_token(token);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

        if let Some(contents) = resp.contents {
            for obj in contents {
                if let (Some(key), Some(size)) = (obj.key, obj.size) {
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

    Ok(all_objects)
}

fn validate_path(path: &std::path::Path) -> Result<()> {
    // Basic check for path traversal
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(crate::error::AppError::IoError(
                "Invalid path: contains parent directory reference".to_string(),
            ));
        }
    }
    Ok(())
}

fn safe_relative_download_path(key: &str) -> Result<PathBuf> {
    let invalid_path = || {
        crate::error::AppError::IoError(format!(
            "Invalid object key for folder download: '{}'",
            key
        ))
    };

    if key.is_empty() || key.starts_with('/') || key.starts_with('\\') {
        return Err(invalid_path());
    }

    let mut relative_path = PathBuf::new();
    for segment in key.split(['/', '\\']) {
        match segment {
            "" | "." => continue,
            ".." => return Err(invalid_path()),
            _ => {
                let bytes = segment.as_bytes();
                let is_windows_drive =
                    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
                if is_windows_drive || segment.contains('\0') {
                    return Err(invalid_path());
                }
                relative_path.push(segment);
            }
        }
    }

    if relative_path.as_os_str().is_empty() {
        return Err(invalid_path());
    }

    Ok(relative_path)
}

async fn require_active_profile(profile_state: &ProfileState) -> Result<Profile> {
    let profile_manager = profile_state.read().await;
    profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ConfigError("No active profile".to_string()))
}

#[allow(clippy::too_many_arguments)]
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
    let profile_id = require_active_profile(profile_state.inner()).await?.id;

    // Fallback for 0 bytes: try to get size from filesystem
    let mut actual_size = total_bytes;
    if actual_size == 0 {
        if let Ok(metadata) = std::fs::metadata(&path) {
            actual_size = metadata.len();
        }
    }

    let job = TransferJob::new(
        TransferType::Upload,
        profile_id,
        bucket_name,
        bucket_region,
        key,
        path,
        actual_size,
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
        t_state.process_queue(s_state, p_state).await;
    });

    Ok(job_id)
}

#[allow(clippy::too_many_arguments)]
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
    let profile_id = require_active_profile(profile_state.inner()).await?.id;

    let job = TransferJob::new(
        TransferType::Download,
        profile_id,
        bucket_name,
        bucket_region,
        key,
        path,
        total_bytes,
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
        t_state.process_queue(s_state, p_state).await;
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn list_transfers(transfer_state: State<'_, TransferState>) -> Result<Vec<TransferJob>> {
    Ok(transfer_state.list_jobs().await)
}

#[allow(clippy::too_many_arguments)]
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
    let profile_id = require_active_profile(profile_state.inner()).await?.id;
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
    })
    .await
    .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;

    let current_manager = transfer_state.clone();
    current_manager.set_app_handle(app_handle.clone()).await;

    let count = jobs_data.len() as u32;
    let group_id = uuid::Uuid::new_v4().to_string();
    let group_name = format!("s3://{}/{}", bucket_name, prefix);

    for (path, size, key) in jobs_data {
        let job = TransferJob::new(
            TransferType::Upload,
            profile_id.clone(),
            bucket_name.clone(),
            bucket_region.clone(),
            key,
            path,
            size,
        )
        .with_group(group_id.clone(), group_name.clone());

        current_manager.add_job(job).await;
    }

    // Trigger processing
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();

    tauri::async_runtime::spawn(async move {
        t_state.process_queue(s_state, p_state).await;
    });

    Ok(count)
}

#[allow(clippy::too_many_arguments)]
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
    let profile = require_active_profile(profile_state.inner()).await?;

    let objects = {
        let resolved_region = {
            let s3 = s3_state.read().await;
            s3.get_bucket_region(&bucket_name)
        }
        .or(bucket_region.clone());

        let client = {
            let mut s3 = s3_state.write().await;
            if let Some(ref region) = resolved_region {
                s3.get_client_for_region(&profile, region).await?.clone()
            } else {
                s3.get_client(&profile).await?.clone()
            }
        };

        match list_folder_objects(&client, &bucket_name, &prefix).await {
            Ok(objects) => objects,
            Err(err) => {
                log::warn!(
                    "queue_folder_download listing failed, attempting region discovery: {}",
                    err
                );
                let retry_client = {
                    let mut s3 = s3_state.write().await;
                    s3.get_client(&profile).await?.clone()
                };

                if let Ok(new_region) =
                    crate::s3::get_bucket_region(&retry_client, &bucket_name).await
                {
                    {
                        let mut s3 = s3_state.write().await;
                        s3.set_bucket_region(&bucket_name, new_region.clone());
                    }

                    let retry_client = {
                        let mut s3 = s3_state.write().await;
                        s3.get_client_for_region(&profile, &new_region)
                            .await?
                            .clone()
                    };

                    list_folder_objects(&retry_client, &bucket_name, &prefix)
                        .await
                        .map_err(|e| {
                            crate::error::AppError::S3Error(format!(
                                "Retry folder listing failed: {}",
                                e
                            ))
                        })?
                } else {
                    return Err(err);
                }
            }
        }
    };

    let group_id = uuid::Uuid::new_v4().to_string();
    let group_name = format!("s3://{}/{}", bucket_name, prefix);
    let root_path = PathBuf::from(&local_path); // This is the destination folder

    // Validate every object key before adding any jobs, so a malicious key cannot
    // leave a partially queued folder download behind.
    let mut jobs_data = Vec::with_capacity(objects.len());
    for (key, size) in objects {
        let relative_key = key.strip_prefix(&prefix).unwrap_or(&key);
        if relative_key.is_empty() {
            continue;
        }

        let relative_path = safe_relative_download_path(relative_key)?;
        let file_path = root_path.join(relative_path);
        validate_path(&file_path)?;
        jobs_data.push((key, size, file_path));
    }

    let count = jobs_data.len() as u32;

    transfer_state.set_app_handle(app_handle.clone()).await;

    for (key, size, file_path) in jobs_data {
        let job = TransferJob::new(
            TransferType::Download,
            profile.id.clone(),
            bucket_name.clone(),
            bucket_region.clone(),
            key,
            file_path,
            size,
        )
        .with_group(group_id.clone(), group_name.clone());

        transfer_state.add_job(job).await;
    }

    // Trigger processing
    let t_state = transfer_state.inner().clone();
    let p_state = profile_state.inner().clone();
    let s_state = s3_state.inner().clone();

    tauri::async_runtime::spawn(async move {
        t_state.process_queue(s_state, p_state).await;
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
            t_state.process_queue(s_state, p_state).await;
        });
    }

    Ok(new_id)
}

#[cfg(test)]
mod tests {
    use super::safe_relative_download_path;
    use std::path::PathBuf;

    #[test]
    fn folder_download_path_accepts_nested_object_keys() {
        assert_eq!(
            safe_relative_download_path("reports/2026/result.csv").unwrap(),
            PathBuf::from("reports/2026/result.csv")
        );
    }

    #[test]
    fn folder_download_path_rejects_parent_traversal() {
        assert!(safe_relative_download_path("reports/../../secret.txt").is_err());
        assert!(safe_relative_download_path("..\\secret.txt").is_err());
    }

    #[test]
    fn folder_download_path_rejects_absolute_paths() {
        assert!(safe_relative_download_path("/tmp/escaped.txt").is_err());
        assert!(safe_relative_download_path("\\\\server\\share\\escaped.txt").is_err());
        assert!(safe_relative_download_path("C:\\temp\\escaped.txt").is_err());
        assert!(safe_relative_download_path("safe/C:\\temp\\escaped.txt").is_err());
    }
}

#[tauri::command]
pub async fn remove_transfer(
    job_id: String,
    transfer_state: State<'_, TransferState>,
) -> Result<bool> {
    Ok(transfer_state.remove_job(&job_id).await)
}

#[tauri::command]
pub async fn clear_completed_transfers(transfer_state: State<'_, TransferState>) -> Result<usize> {
    Ok(transfer_state.clear_completed().await)
}

#[tauri::command]
pub async fn set_transfer_concurrency(
    max_concurrency: u32,
    transfer_state: State<'_, TransferState>,
) -> Result<()> {
    transfer_state.set_max_concurrency(max_concurrency as usize);
    Ok(())
}
