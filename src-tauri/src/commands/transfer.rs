use crate::commands::profiles::ProfileState;
use crate::credentials::Profile;
use crate::error::Result;
use crate::s3::S3State;
use crate::transfer::download::DownloadDestination;
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
    Ok(
        crate::s3::listing::list_recursive(client, bucket_name, prefix)
            .await?
            .into_iter()
            .filter_map(|object| {
                let key = object.key?;
                if key.ends_with('/') {
                    return None;
                }
                Some((key, object.size.unwrap_or(0).max(0) as u64))
            })
            .collect(),
    )
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

    if key.is_empty() || key.starts_with('/') || key.contains('\\') {
        return Err(invalid_path());
    }

    let mut relative_path = PathBuf::new();
    for segment in key.split('/') {
        match segment {
            "" | "." | ".." => return Err(invalid_path()),
            _ => {
                let bytes = segment.as_bytes();
                let is_windows_drive =
                    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
                if is_windows_drive || segment.contains('\0') {
                    return Err(invalid_path());
                }
                #[cfg(windows)]
                {
                    let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
                    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                        || ["COM", "LPT"].iter().any(|prefix| {
                            stem.strip_prefix(prefix).is_some_and(|suffix| {
                                matches!(
                                    suffix,
                                    "1" | "2"
                                        | "3"
                                        | "4"
                                        | "5"
                                        | "6"
                                        | "7"
                                        | "8"
                                        | "9"
                                        | "¹"
                                        | "²"
                                        | "³"
                                )
                            })
                        });
                    if reserved
                        || segment.ends_with(['.', ' '])
                        || segment
                            .chars()
                            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                    {
                        return Err(invalid_path());
                    }
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

async fn require_active_profile(profile_state: &ProfileState, expected: &str) -> Result<Profile> {
    let profile_manager = profile_state.read().await;
    let profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ConfigError("No active profile".to_string()))?;
    super::operations::validate_operation_profile(Some(expected), &profile.id)?;
    Ok(profile)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn queue_upload(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    total_bytes: u64,
    expected_profile_id: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<String> {
    // Basic validation
    let path = PathBuf::from(&local_path);
    validate_path(&path)?;
    let profile_id = require_active_profile(profile_state.inner(), &expected_profile_id)
        .await?
        .id;

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
    overwrite: Option<bool>,
    expected_profile_id: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<String> {
    let path = PathBuf::from(&local_path);
    validate_path(&path)?;
    let profile_id = require_active_profile(profile_state.inner(), &expected_profile_id)
        .await?
        .id;

    let destination = DownloadDestination::from_path(&path, overwrite.unwrap_or(false))?;
    let mut job = TransferJob::new(
        TransferType::Download,
        profile_id,
        bucket_name,
        bucket_region,
        key,
        path,
        total_bytes,
    );

    job.download_destination = Some(Arc::new(destination));
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
fn collect_upload_files(
    root: &std::path::Path,
    prefix: &str,
) -> Result<Vec<(PathBuf, u64, String)>> {
    let parent = root
        .parent()
        .ok_or_else(|| crate::error::AppError::ConfigError("Choose a folder".into()))?;
    let mut files = Vec::new();
    let mut keys = std::collections::HashSet::new();
    for entry in walkdir::WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| {
            crate::error::AppError::IoError(format!("Folder upload was not queued: {error}"))
        })?;
        if entry.path_is_symlink() {
            return Err(crate::error::AppError::IoError(format!(
                "Folder upload contains a symbolic link: {}. Select its target explicitly instead.",
                entry.path().display()
            )));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(parent)
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
        let parts: Option<Vec<_>> = relative
            .components()
            .map(|part| part.as_os_str().to_str())
            .collect();
        let key = format!(
            "{}{}",
            prefix,
            parts
                .ok_or_else(|| crate::error::AppError::IoError(format!(
                    "Filename is not valid Unicode: {}",
                    entry.path().display()
                )))?
                .join("/")
        );
        if !keys.insert(key.clone()) {
            return Err(crate::error::AppError::IoError(format!(
                "Multiple files map to {key}"
            )));
        }
        let size = entry
            .metadata()
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))?
            .len();
        files.push((entry.path().to_path_buf(), size, key));
        if files.len() > 100_000 {
            return Err(crate::error::AppError::ConfigError(
                "Folder upload exceeds 100,000 files. Select smaller folders.".into(),
            ));
        }
    }
    Ok(files)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn queue_folder_upload(
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: String,
    local_path: String,
    expected_profile_id: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<u32> {
    let root = PathBuf::from(&local_path);
    validate_path(&root)?;
    let profile_id = require_active_profile(profile_state.inner(), &expected_profile_id)
        .await?
        .id;
    let upload_prefix = prefix.clone();
    let jobs_data =
        tauri::async_runtime::spawn_blocking(move || collect_upload_files(&root, &upload_prefix))
            .await
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))??;

    let current_manager = transfer_state.clone();
    current_manager.set_app_handle(app_handle.clone()).await;

    let count = jobs_data.len() as u32;
    let group_id = uuid::Uuid::new_v4().to_string();
    let group_name = format!("s3://{}/{}", bucket_name, prefix);

    let mut queued = Vec::with_capacity(jobs_data.len());
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

        queued.push(job);
    }
    current_manager.add_jobs(queued).await;

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
    expected_profile_id: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<u32> {
    let root_path = PathBuf::from(&local_path);
    validate_path(&root_path)?;

    // 1. List all objects in the prefix
    let profile = require_active_profile(profile_state.inner(), &expected_profile_id).await?;

    let objects = {
        let resolved_region = {
            let s3 = s3_state.read().await;
            s3.get_bucket_region(&profile, &bucket_name)
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
                        s3.set_bucket_region(&profile, &bucket_name, new_region.clone());
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
    let root_path = PathBuf::from(&local_path);
    let selected_root = root_path.parent().ok_or_else(|| {
        crate::error::AppError::IoError("Choose a download directory".to_string())
    })?;
    let download_root = DownloadDestination::open_root(selected_root)?;

    // Validate every object key before adding any jobs, so a malicious key cannot
    // leave a partially queued folder download behind.
    let mut jobs_data = Vec::with_capacity(objects.len());
    let mut destinations = std::collections::HashSet::new();
    for (key, size) in objects {
        let relative_key = key.strip_prefix(&prefix).unwrap_or(&key);
        if relative_key.is_empty() {
            continue;
        }

        let relative_path = safe_relative_download_path(relative_key)?;
        let file_path = root_path.join(relative_path);
        validate_path(&file_path)?;
        if !destinations.insert(file_path.clone()) {
            return Err(crate::error::AppError::IoError(format!(
                "Multiple objects would download to {}",
                file_path.display()
            )));
        }
        jobs_data.push((key, size, file_path));
    }

    let count = jobs_data.len() as u32;

    transfer_state.set_app_handle(app_handle.clone()).await;

    let mut queued = Vec::with_capacity(jobs_data.len());
    for (key, size, file_path) in jobs_data {
        let relative_path = file_path
            .strip_prefix(selected_root)
            .map_err(|error| crate::error::AppError::IoError(error.to_string()))?
            .to_path_buf();
        let destination = DownloadDestination::new(download_root.clone(), relative_path, false)?;
        let mut job = TransferJob::new(
            TransferType::Download,
            profile.id.clone(),
            bucket_name.clone(),
            bucket_region.clone(),
            key,
            file_path,
            size,
        )
        .with_group(group_id.clone(), group_name.clone());
        job.download_destination = Some(Arc::new(destination));

        queued.push(job);
    }
    transfer_state.add_jobs(queued).await;

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
    if transfer_state.get_job(&job_id).await.is_some_and(|job| {
        matches!(job.transfer_type, TransferType::Download) && job.download_destination.is_none()
    }) {
        return Err(crate::error::AppError::ConfigError(
            "Queue this download again to choose its destination after restarting.".into(),
        ));
    }
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

    #[test]
    fn missing_upload_folder_fails_instead_of_queuing_zero_files() {
        let root = tempfile::tempdir().unwrap();
        assert!(super::collect_upload_files(&root.path().join("missing"), "").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn upload_preflight_rejects_symlinks_and_preserves_literal_backslashes() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("a\\b"), "content").unwrap();
        let files = super::collect_upload_files(&folder, "").unwrap();
        assert_eq!(files[0].2, "folder/a\\b");
        std::os::unix::fs::symlink(folder.join("a\\b"), folder.join("link")).unwrap();
        assert!(super::collect_upload_files(&folder, "").is_err());
    }

    #[test]
    fn folder_download_rejects_keys_that_would_be_normalized() {
        for key in ["a//b.txt", "a/./b.txt", "a\\b.txt", "a/"] {
            assert!(safe_relative_download_path(key).is_err(), "{key}");
        }
        assert!(safe_relative_download_path("a/b.txt").is_ok());
    }
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
