use crate::commands::profiles::ProfileState;
use crate::error::Result;
use crate::s3::{FolderContent, S3Object, S3State};
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;

const MAX_SORTABLE_FOLDER_ITEMS: usize = 100_000;
const MAX_COMPLETE_LIST_REQUESTS: usize = 100;
const MAX_SEARCH_SCANNED_OBJECTS: u64 = 100_000;
const MAX_SEARCH_RESULTS: usize = 10_000;
const MAX_SEARCH_REQUESTS: usize = 100;
const DEFAULT_MAX_TEXT_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES: u64 = 100 * 1024 * 1024;

fn normalized_text_preview_limit(max_bytes: Option<u64>) -> u64 {
    max_bytes
        .unwrap_or(DEFAULT_MAX_TEXT_PREVIEW_BYTES)
        .clamp(1, MAX_TEXT_PREVIEW_BYTES)
}

fn text_preview_size_error(actual_bytes: Option<u64>, max_bytes: u64) -> crate::error::AppError {
    let limit_mb = max_bytes as f64 / 1024.0 / 1024.0;
    let message = if let Some(actual_bytes) = actual_bytes {
        format!(
            "Object is too large to preview as text ({:.2} MB; configured limit {:.0} MB). Increase the text preview limit in Settings or download it.",
            actual_bytes as f64 / 1024.0 / 1024.0,
            limit_mb
        )
    } else {
        format!(
            "Object exceeds the configured text preview limit of {:.0} MB. Increase the limit in Settings or download it.",
            limit_mb
        )
    };

    crate::error::AppError::InvalidContent(message)
}

fn preview_chunk_fits(current_bytes: usize, chunk_bytes: usize, max_bytes: u64) -> bool {
    (chunk_bytes as u64) <= max_bytes.saturating_sub(current_bytes as u64)
}

fn is_likely_binary_text_mismatch(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    let mut control_count = 0usize;
    for &byte in bytes {
        if byte == 0 {
            return true;
        }

        if byte < 0x20 && !matches!(byte, b'\n' | b'\r' | b'\t' | 0x0c) {
            control_count += 1;
        }
    }

    control_count.saturating_mul(100) > bytes.len().saturating_mul(5)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListObjectsResult {
    pub objects: Vec<S3Object>,
    pub common_prefixes: Vec<String>,
    pub next_continuation_token: Option<String>,
    pub is_truncated: bool,
    pub prefix: String,
    pub bucket_region: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchObjectsResult {
    pub objects: Vec<S3Object>,
    pub scanned_objects: u64,
    pub is_truncated: bool,
}

fn normalize_sort_field(sort_field: Option<String>) -> Option<String> {
    match sort_field.as_deref() {
        Some("name") | Some("size") | Some("date") | Some("class") => sort_field,
        _ => None,
    }
}

fn normalize_sort_direction(sort_direction: Option<String>) -> String {
    match sort_direction.as_deref() {
        Some("desc") => "desc".to_string(),
        _ => "asc".to_string(),
    }
}

fn paginate_folder_content(
    content: &FolderContent,
    prefix: String,
    bucket_region: Option<String>,
    continuation_token: Option<String>,
    max_keys: Option<i32>,
) -> ListObjectsResult {
    let offset = continuation_token
        .and_then(|t| t.parse::<usize>().ok())
        .unwrap_or(0);
    let max = max_keys.unwrap_or(1000).max(1) as usize;
    let end = (offset + max).min(content.objects.len());
    let next_token = if end < content.objects.len() {
        Some(end.to_string())
    } else {
        None
    };

    ListObjectsResult {
        objects: content.objects[offset..end].to_vec(),
        common_prefixes: if offset == 0 {
            content.common_prefixes.clone()
        } else {
            Vec::new()
        },
        next_continuation_token: next_token.clone(),
        is_truncated: next_token.is_some(),
        prefix,
        bucket_region,
    }
}

async fn list_complete_folder_content(
    client: &Client,
    bucket_name: &str,
    prefix: &str,
    delimiter: &str,
) -> Result<FolderContent> {
    let mut objects = Vec::new();
    let mut common_prefixes = Vec::new();
    let mut seen_prefixes = HashSet::new();
    let mut continuation_token: Option<String> = None;
    let mut request_count = 0usize;

    loop {
        if request_count >= MAX_COMPLETE_LIST_REQUESTS {
            return Err(crate::error::AppError::ConfigError(format!(
                "This folder requires more than {} S3 LIST requests for complete-result sorting. Use name ascending or narrow the prefix.",
                MAX_COMPLETE_LIST_REQUESTS
            )));
        }

        let mut request = client
            .list_objects_v2()
            .bucket(bucket_name)
            .prefix(prefix)
            .max_keys(1000);

        if !delimiter.is_empty() {
            request = request.delimiter(delimiter);
        }

        if let Some(token) = &continuation_token {
            request = request.continuation_token(token);
        }

        let output = request
            .send()
            .await
            .map_err(|err| crate::error::AppError::S3Error(err.to_string()))?;
        request_count += 1;

        for obj in output.contents() {
            let key = obj.key().unwrap_or_default();
            let size = obj.size().unwrap_or(0);
            if !delimiter.is_empty() && key.ends_with('/') && size == 0 {
                continue;
            }

            objects.push(S3Object {
                key: key.to_string(),
                last_modified: obj.last_modified().map(|d| d.to_string()),
                size,
                storage_class: obj.storage_class().map(|s| s.as_str().to_string()),
            });
        }

        for common_prefix in output.common_prefixes() {
            let prefix = common_prefix.prefix().unwrap_or_default().to_string();
            if seen_prefixes.insert(prefix.clone()) {
                common_prefixes.push(prefix);
            }
        }

        if objects.len().saturating_add(common_prefixes.len()) > MAX_SORTABLE_FOLDER_ITEMS {
            return Err(crate::error::AppError::ConfigError(format!(
                "This folder exceeds the {}-item safety limit for complete-result sorting. Use name ascending or narrow the prefix.",
                MAX_SORTABLE_FOLDER_ITEMS
            )));
        }

        if output.is_truncated().unwrap_or(false) {
            continuation_token = Some(
                output
                    .next_continuation_token()
                    .ok_or_else(|| {
                        crate::error::AppError::S3Error(
                            "S3 returned a truncated sorted listing without a continuation token"
                                .to_string(),
                        )
                    })?
                    .to_string(),
            );
        } else {
            break;
        }
    }

    Ok(FolderContent {
        objects,
        common_prefixes,
    })
}

fn sort_folder_content(content: &mut FolderContent, sort_field: &str, sort_direction: &str) {
    content.common_prefixes.sort();
    if sort_direction == "desc" {
        content.common_prefixes.reverse();
    }

    content.objects.sort_by(|a, b| {
        let ordering = match sort_field {
            "size" => a.size.cmp(&b.size).then_with(|| a.key.cmp(&b.key)),
            "date" => a
                .last_modified
                .cmp(&b.last_modified)
                .then_with(|| a.key.cmp(&b.key)),
            "class" => a
                .storage_class
                .cmp(&b.storage_class)
                .then_with(|| a.key.cmp(&b.key)),
            _ => a.key.cmp(&b.key),
        };

        if sort_direction == "desc" {
            ordering.reverse()
        } else {
            ordering
        }
    });
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn list_objects(
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: Option<String>,
    delimiter: Option<String>,
    continuation_token: Option<String>,
    max_keys: Option<i32>,
    bypass_cache: Option<bool>,
    sort_field: Option<String>,
    sort_direction: Option<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<ListObjectsResult> {
    let prefix_str = prefix.clone().unwrap_or_default();
    let delimiter_str = delimiter.unwrap_or_else(|| "/".to_string());
    let requested_bucket_region = bucket_region.clone();
    let sort_field = normalize_sort_field(sort_field);
    let sort_direction = normalize_sort_direction(sort_direction);
    let uses_complete_sort = sort_field
        .as_deref()
        .map(|field| field != "name" || sort_direction == "desc")
        .unwrap_or(false)
        && !delimiter_str.is_empty();

    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // 1. Try Read Lock first for Cache (highly concurrent)
    {
        let s3_manager = s3_state.read().await;
        let cached_bucket_region = s3_manager
            .get_bucket_region(&bucket_name)
            .or(requested_bucket_region.clone());
        if uses_complete_sort && !bypass_cache.unwrap_or(false) {
            if let Some(field) = sort_field.as_deref() {
                if let Some(content) = s3_manager.get_sorted_folder_content(
                    &active_profile.id,
                    &bucket_name,
                    &prefix_str,
                    field,
                    &sort_direction,
                ) {
                    return Ok(paginate_folder_content(
                        content,
                        prefix_str,
                        cached_bucket_region,
                        continuation_token,
                        max_keys,
                    ));
                }
            }
        }
    }

    // If bypassing cache, we should invalidate the existing cache for this bucket
    if bypass_cache.unwrap_or(false) {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    // Check cache for bucket region first
    let mut resolved_bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = resolved_bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    if uses_complete_sort {
        let field = sort_field.clone().unwrap_or_else(|| "name".to_string());
        let mut content =
            match list_complete_folder_content(&client, &bucket_name, &prefix_str, &delimiter_str)
                .await
            {
                Ok(content) => content,
                Err(err) => {
                    if matches!(&err, crate::error::AppError::ConfigError(_)) {
                        return Err(err);
                    }

                    log::warn!(
                        "Sorted list_objects failed, attempting region discovery: {}",
                        err
                    );
                    let detected_region = {
                        let retry_client = {
                            let mut s3_manager = s3_state.write().await;
                            s3_manager.get_client(&active_profile).await?.clone()
                        };
                        crate::s3::get_bucket_region(&retry_client, &bucket_name)
                            .await
                            .ok()
                    };

                    if let Some(new_region) = detected_region {
                        let new_client = {
                            let mut s3_manager = s3_state.write().await;
                            s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                            s3_manager
                                .get_client_for_region(&active_profile, &new_region)
                                .await?
                                .clone()
                        };
                        resolved_bucket_region = Some(new_region);
                        list_complete_folder_content(
                            &new_client,
                            &bucket_name,
                            &prefix_str,
                            &delimiter_str,
                        )
                        .await?
                    } else {
                        return Err(err);
                    }
                }
            };

        sort_folder_content(&mut content, &field, &sort_direction);

        {
            let mut s3_manager = s3_state.write().await;
            s3_manager.set_sorted_folder_content(
                &active_profile.id,
                &bucket_name,
                &prefix_str,
                &field,
                &sort_direction,
                content.clone(),
            );
        }

        return Ok(paginate_folder_content(
            &content,
            prefix_str,
            resolved_bucket_region.or(requested_bucket_region),
            continuation_token,
            max_keys,
        ));
    }

    // 3. Perform network IO outside of locks, including retry logic
    let mut request = client
        .list_objects_v2()
        .bucket(&bucket_name)
        .prefix(&prefix_str);

    // Only set delimiter if it's non-empty - empty/omitted delimiter returns ALL nested objects (recursive)
    if !delimiter_str.is_empty() {
        request = request.delimiter(&delimiter_str);
    }

    if let Some(token) = &continuation_token {
        request = request.continuation_token(token);
    }
    if let Some(max) = max_keys {
        request = request.max_keys(max);
    }

    let result = request.send().await;

    // Handle the result, implementing retry logic on error
    let output = match result {
        Ok(out) => out,
        Err(err) => {
            log::warn!("Initial list_objects failed: {}", err);
            // Attempt to detect region and retry
            let detected_region = {
                // ... (Region detection logic remains the same, we trust get_bucket_region works on any client usually)
                let retry_client = {
                    let s3_manager = s3_state.read().await;
                    // Use default region client to ask about location
                    // We don't need write lock just to get a client that might already exist
                    // Wait, get_client requires &mut Self. Okay, we need write lock.
                    drop(s3_manager);
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.get_client(&active_profile).await?.clone()
                };

                match crate::s3::get_bucket_region(&retry_client, &bucket_name).await {
                    Ok(region) => {
                        log::info!(
                            "Detected correct region for bucket '{}': {}",
                            bucket_name,
                            region
                        );
                        Some(region)
                    }
                    Err(e) => {
                        log::error!("Failed to detect bucket region: {}", e);
                        None
                    }
                }
            };

            if let Some(new_region) = detected_region {
                // Get NEW client for this region
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager
                        .get_client_for_region(&active_profile, &new_region)
                        .await?
                        .clone()
                };

                // Retry request
                let mut retry_req = new_client
                    .list_objects_v2()
                    .bucket(&bucket_name)
                    .prefix(&prefix_str);

                // Only set delimiter if it's non-empty
                if !delimiter_str.is_empty() {
                    retry_req = retry_req.delimiter(&delimiter_str);
                }

                if let Some(token) = &continuation_token {
                    retry_req = retry_req.continuation_token(token);
                }
                if let Some(max) = max_keys {
                    retry_req = retry_req.max_keys(max);
                }

                // Update the region we will return and use for fallback
                resolved_bucket_region = Some(new_region.clone());

                // Cache the discovered region for future requests
                {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region);
                }

                retry_req
                    .send()
                    .await
                    .map_err(|e| crate::error::AppError::S3Error(format!("Retry failed: {}", e)))?
            } else {
                return Err(crate::error::AppError::S3Error(err.to_string()));
            }
        }
    };

    // Map objects, filtering out folder markers (zero-byte objects ending with /)
    let mut objects: Vec<S3Object> = output
        .contents()
        .iter()
        .filter(|obj| {
            let key = obj.key().unwrap_or_default();
            let size = obj.size().unwrap_or(0);

            // Exclude folder markers (zero-byte objects ending with '/') ONLY if we are using a delimiter (structured view).
            // In recursive view (no delimiter), we want ALL markers so they can be managed/deleted.
            if !delimiter_str.is_empty() && key.ends_with('/') && size == 0 {
                return false;
            }
            true
        })
        .map(|obj| S3Object {
            key: obj.key().unwrap_or_default().to_string(),
            last_modified: obj.last_modified().map(|d| d.to_string()),
            size: obj.size().unwrap_or(0),
            storage_class: obj.storage_class().map(|s| s.as_str().to_string()),
        })
        .collect();

    // Map common prefixes (folders)
    let common_prefixes: Vec<String> = output
        .common_prefixes()
        .iter()
        .map(|cp| cp.prefix().unwrap_or_default().to_string())
        .collect();

    // Fallback: If empty, try HeadObject to see if it's a direct file reference
    // We strip the trailing slash because some systems/users append it accidentally to files
    if objects.is_empty()
        && common_prefixes.is_empty()
        && !prefix_str.is_empty()
        && !prefix_str.ends_with('/')
    {
        let clean_key = prefix_str.trim_end_matches('/').to_string();
        if !clean_key.is_empty() {
            let client = {
                let mut s3_manager = s3_state.write().await;
                if let Some(ref region) = resolved_bucket_region {
                    s3_manager
                        .get_client_for_region(&active_profile, region)
                        .await?
                        .clone()
                } else {
                    s3_manager.get_client(&active_profile).await?.clone()
                }
            };

            if let Ok(head_output) = client
                .head_object()
                .bucket(&bucket_name)
                .key(&clean_key)
                .send()
                .await
            {
                objects.push(S3Object {
                    key: clean_key,
                    last_modified: head_output.last_modified().map(|d| d.to_string()),
                    size: head_output.content_length().unwrap_or(0),
                    storage_class: head_output.storage_class().map(|s| s.as_str().to_string()),
                });
            }
        }
    }

    Ok(ListObjectsResult {
        objects,
        common_prefixes,
        next_continuation_token: output.next_continuation_token().map(|s| s.to_string()),
        is_truncated: output.is_truncated().unwrap_or(false),
        prefix: prefix_str,
        bucket_region: resolved_bucket_region.or(requested_bucket_region),
    })
}

#[tauri::command]
pub async fn search_objects(
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: Option<String>,
    query: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<SearchObjectsResult> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let prefix_str = prefix.unwrap_or_default();
    let query_lower = query.to_lowercase();

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let mut client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let mut objects = Vec::new();
    let mut continuation_token = None;
    let mut calls = 0;
    let mut scanned_objects = 0u64;
    let mut is_truncated = false;

    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(&bucket_name)
            .prefix(&prefix_str)
            .max_keys(1000); // Respect prefix context

        if let Some(ref token) = continuation_token {
            req = req.continuation_token(token);
        }

        let result = req.send().await;

        // implement region detection and retry on error
        let output = match result {
            Ok(out) => out,
            Err(err) => {
                log::warn!("Search list_objects failed: {}", err);
                if calls > 0 {
                    return Err(crate::error::AppError::S3Error(format!(
                        "Search failed after reading {} S3 pages: {}",
                        calls, err
                    )));
                }

                // Attempt to detect region and retry (only if this is the first call)
                let detected_region = {
                    let retry_client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager.get_client(&active_profile).await?.clone()
                    };
                    crate::s3::get_bucket_region(&retry_client, &bucket_name)
                        .await
                        .ok()
                };

                if let Some(new_region) = detected_region {
                    let new_client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                        s3_manager
                            .get_client_for_region(&active_profile, &new_region)
                            .await?
                            .clone()
                    };
                    client = new_client.clone();

                    let mut retry_req = new_client
                        .list_objects_v2()
                        .bucket(&bucket_name)
                        .prefix(&prefix_str)
                        .max_keys(1000);

                    if let Some(token) = &continuation_token {
                        retry_req = retry_req.continuation_token(token);
                    }

                    retry_req.send().await.map_err(|e| {
                        crate::error::AppError::S3Error(format!("Search retry failed: {}", e))
                    })?
                } else {
                    return Err(crate::error::AppError::S3Error(err.to_string()));
                }
            }
        };

        calls += 1;

        for obj in output.contents() {
            if scanned_objects >= MAX_SEARCH_SCANNED_OBJECTS {
                is_truncated = true;
                break;
            }
            scanned_objects += 1;

            let key = obj.key().unwrap_or_default();
            let size = obj.size().unwrap_or(0);
            // Skip folder markers (zero-byte objects ending with /)
            if key.ends_with('/') && size == 0 {
                continue;
            }
            if key.to_lowercase().contains(&query_lower) {
                objects.push(S3Object {
                    key: key.to_string(),
                    size,
                    last_modified: obj.last_modified().map(|d| d.to_string()),
                    storage_class: obj.storage_class().map(|s| s.as_str().to_string()),
                });

                if objects.len() >= MAX_SEARCH_RESULTS {
                    is_truncated = true;
                    break;
                }
            }
        }

        if output.is_truncated().unwrap_or(false) && calls >= MAX_SEARCH_REQUESTS {
            is_truncated = true;
        }

        if is_truncated {
            log::warn!(
                "Deep search in bucket '{}' stopped at safety limits ({} scanned, {} results)",
                bucket_name,
                scanned_objects,
                objects.len()
            );
            break;
        }

        if !output.is_truncated().unwrap_or(false) {
            break;
        }
        continuation_token = Some(
            output
                .next_continuation_token()
                .ok_or_else(|| {
                    crate::error::AppError::S3Error(
                        "S3 returned a truncated search listing without a continuation token"
                            .to_string(),
                    )
                })?
                .to_string(),
        );
    }

    Ok(SearchObjectsResult {
        objects,
        scanned_objects,
        is_truncated,
    })
}

#[tauri::command]
pub async fn get_presigned_url(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    expires_in: u64,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<String> {
    use aws_sdk_s3::presigning::PresigningConfig;
    use std::time::Duration;

    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let presigning_config_result = PresigningConfig::expires_in(Duration::from_secs(expires_in))
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()));

    let mut get_obj_builder = client
        .get_object()
        .bucket(&bucket_name)
        .key(&key)
        .response_content_disposition("inline");

    // Force PDF content type if extension matches, ensuring browser renders it
    if key.to_lowercase().ends_with(".pdf") {
        get_obj_builder = get_obj_builder.response_content_type("application/pdf");
    }

    let presigned_request_result = match presigning_config_result {
        Ok(config) => get_obj_builder
            .presigned(config)
            .await
            .map_err(|e| crate::error::AppError::S3Error(e.to_string())),
        Err(e) => Err(e),
    };

    match presigned_request_result {
        Ok(req) => Ok(req.uri().to_string()),
        Err(err) => {
            log::warn!("Presigning failed, attempting region discovery: {}", err);
            let detected_region = {
                let retry_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.get_client(&active_profile).await?.clone()
                };
                crate::s3::get_bucket_region(&retry_client, &bucket_name)
                    .await
                    .ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager
                        .get_client_for_region(&active_profile, &new_region)
                        .await?
                        .clone()
                };

                let mut get_obj = new_client
                    .get_object()
                    .bucket(&bucket_name)
                    .key(&key)
                    .response_content_disposition("inline");

                if key.to_lowercase().ends_with(".pdf") {
                    get_obj = get_obj.response_content_type("application/pdf");
                }

                let presigning_config =
                    PresigningConfig::expires_in(Duration::from_secs(expires_in))
                        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

                let req = get_obj.presigned(presigning_config).await.map_err(|e| {
                    crate::error::AppError::S3Error(format!("Retry presign failed: {}", e))
                })?;
                Ok(req.uri().to_string())
            } else {
                Err(err)
            }
        }
    }
}

#[tauri::command]
pub async fn get_object_content(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    max_bytes: Option<u64>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<String> {
    let max_bytes = normalized_text_preview_limit(max_bytes);
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let result = client
        .get_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await;

    let response = match result {
        Ok(res) => res,
        Err(err) => {
            log::warn!(
                "get_object_content failed, attempting region discovery: {}",
                err
            );
            let detected_region = {
                let retry_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.get_client(&active_profile).await?.clone()
                };
                crate::s3::get_bucket_region(&retry_client, &bucket_name)
                    .await
                    .ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager
                        .get_client_for_region(&active_profile, &new_region)
                        .await?
                        .clone()
                };
                new_client
                    .get_object()
                    .bucket(&bucket_name)
                    .key(&key)
                    .send()
                    .await
                    .map_err(|e| {
                        crate::error::AppError::S3Error(format!("Retry get content failed: {}", e))
                    })?
            } else {
                return Err(crate::error::AppError::S3Error(err.to_string()));
            }
        }
    };

    let content_length = response
        .content_length()
        .and_then(|length| u64::try_from(length).ok());
    if content_length.is_some_and(|length| length > max_bytes) {
        return Err(text_preview_size_error(content_length, max_bytes));
    }

    let initial_capacity = content_length
        .unwrap_or(0)
        .min(max_bytes)
        .try_into()
        .unwrap_or(0);
    let mut bytes = Vec::with_capacity(initial_capacity);
    let mut body = response.body;

    while let Some(chunk) = body
        .try_next()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?
    {
        if !preview_chunk_fits(bytes.len(), chunk.len(), max_bytes) {
            return Err(text_preview_size_error(None, max_bytes));
        }
        bytes.extend_from_slice(&chunk);
    }

    if is_likely_binary_text_mismatch(&bytes) {
        return Err(crate::error::AppError::InvalidContent(
            "This object appears to contain binary data and cannot be edited safely in the text editor. Download it to inspect locally.".to_string(),
        ));
    }

    String::from_utf8(bytes).map_err(|_| {
        crate::error::AppError::InvalidContent(
            "This object is not readable as UTF-8 text. Download it to inspect locally."
                .to_string(),
        )
    })
}

#[tauri::command]
pub async fn put_object_content(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    content: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    use aws_sdk_s3::primitives::ByteStream;

    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let body_bytes = content.into_bytes();
    let body = ByteStream::from(body_bytes.clone());

    let result = client
        .put_object()
        .bucket(&bucket_name)
        .key(&key)
        .body(body)
        .send()
        .await;

    match result {
        Ok(_) => {}
        Err(err) => {
            log::warn!(
                "put_object_content failed, attempting region discovery: {}",
                err
            );
            let detected_region = {
                let retry_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.get_client(&active_profile).await?.clone()
                };
                crate::s3::get_bucket_region(&retry_client, &bucket_name)
                    .await
                    .ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager
                        .get_client_for_region(&active_profile, &new_region)
                        .await?
                        .clone()
                };
                let retry_body = ByteStream::from(body_bytes);
                new_client
                    .put_object()
                    .bucket(&bucket_name)
                    .key(&key)
                    .body(retry_body)
                    .send()
                    .await
                    .map_err(|e| {
                        crate::error::AppError::S3Error(format!("Retry put content failed: {}", e))
                    })?;
            } else {
                return Err(crate::error::AppError::S3Error(err.to_string()));
            }
        }
    }

    {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    Ok(())
}

#[cfg(test)]
mod preview_tests {
    use super::{
        normalized_text_preview_limit, preview_chunk_fits, DEFAULT_MAX_TEXT_PREVIEW_BYTES,
        MAX_TEXT_PREVIEW_BYTES,
    };

    #[test]
    fn text_preview_limit_has_a_safe_default_and_upper_bound() {
        assert_eq!(
            normalized_text_preview_limit(None),
            DEFAULT_MAX_TEXT_PREVIEW_BYTES
        );
        assert_eq!(normalized_text_preview_limit(Some(0)), 1);
        assert_eq!(
            normalized_text_preview_limit(Some(MAX_TEXT_PREVIEW_BYTES + 1)),
            MAX_TEXT_PREVIEW_BYTES
        );
    }

    #[test]
    fn streamed_preview_never_crosses_the_configured_limit() {
        assert!(preview_chunk_fits(6, 4, 10));
        assert!(!preview_chunk_fits(6, 5, 10));
        assert!(!preview_chunk_fits(usize::MAX, 1, 10));
    }
}
