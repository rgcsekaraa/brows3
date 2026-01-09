use crate::commands::profiles::ProfileState;
use crate::s3::{S3State, S3Object};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ListObjectsResult {
    pub objects: Vec<S3Object>,
    pub common_prefixes: Vec<String>,
    pub next_continuation_token: Option<String>,
    pub is_truncated: bool,
    pub prefix: String,
}

#[tauri::command]
pub async fn list_objects(
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: Option<String>,
    delimiter: Option<String>,
    continuation_token: Option<String>,
    max_keys: Option<i32>,
    bypass_cache: Option<bool>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<ListObjectsResult> {
    let prefix_str = prefix.clone().unwrap_or_default();
    let delimiter_str = delimiter.unwrap_or_else(|| "/".to_string());
    
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
        if !bypass_cache.unwrap_or(false) && s3_manager.has_cache(&active_profile.id, &bucket_name) {
            if let Some(content) = s3_manager.get_folder_content(&active_profile.id, &bucket_name, &prefix_str) {
                 // Paginate cached objects
                 let offset = continuation_token
                     .and_then(|t| t.parse::<usize>().ok())
                     .unwrap_or(0);
                 
                 let max = max_keys.unwrap_or(1000) as usize;
                 let end = (offset + max).min(content.objects.len());
                 
                 let page_objects = content.objects[offset..end].to_vec();
                 let next_token = if end < content.objects.len() {
                     Some(end.to_string())
                 } else {
                     None
                 };

                 // Only return common_prefixes on the first page
                 let prefixes = if offset == 0 {
                     content.common_prefixes.clone()
                 } else {
                     Vec::new()
                 };

                 let is_truncated = next_token.is_some();

                 return Ok(ListObjectsResult {
                     objects: page_objects,
                     common_prefixes: prefixes,
                     next_continuation_token: next_token,
                     is_truncated,
                     prefix: prefix_str,
                 });
            } else {
                 // If bucket is cached but prefix is not found, it's an empty folder
                 return Ok(ListObjectsResult {
                     objects: Vec::new(),
                     common_prefixes: Vec::new(),
                     next_continuation_token: None,
                     is_truncated: false,
                     prefix: prefix_str,
                 });
            }
        }
    }
    
    // If bypassing cache, we should invalidate the existing cache for this bucket
    // so subsequent load_more calls don't hit stale data.
    if bypass_cache.unwrap_or(false) {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    // 2. Cache miss or bypass: need Client (requires Write hold to potentially build Client)
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    // 3. Perform network IO outside of locks
    let mut request = client
        .list_objects_v2()
        .bucket(&bucket_name)
        .prefix(&prefix_str)
        .delimiter(&delimiter_str);

    if let Some(token) = continuation_token {
        request = request.continuation_token(token);
    }
    
    if let Some(max) = max_keys {
        request = request.max_keys(max);
    }

    let output = request.send().await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    // Map objects
    let objects: Vec<S3Object> = output
        .contents()
        .iter()
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

    Ok(ListObjectsResult {
        objects,
        common_prefixes,
        next_continuation_token: output.next_continuation_token().map(|s| s.to_string()),
        is_truncated: output.is_truncated().unwrap_or(false),
        prefix: prefix_str,
    })
}

#[tauri::command]
pub async fn search_objects(
    bucket_name: String,
    bucket_region: Option<String>,
    query: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<Vec<S3Object>> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    
    // Use read lock for search
    let s3_manager = s3_state.read().await;
    if s3_manager.has_cache(&active_profile.id, &bucket_name) {
        if let Some(all_objects) = s3_manager.get_cached_objects(&active_profile.id, &bucket_name) {
             let q = query.to_lowercase();
             let filtered: Vec<S3Object> = all_objects.iter()
                 .filter(|obj| obj.key.to_lowercase().contains(&q))
                 .cloned()
                 .collect();
             return Ok(filtered);
        }
    }
    drop(s3_manager);

    // Fallback to S3 if not cached
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let mut objects = Vec::new();
    let mut continuation_token = None;
    let max_search_api_calls = 10;
    let mut calls = 0;

    loop {
        let mut req = client.list_objects_v2().bucket(&bucket_name);
        if let Some(token) = continuation_token {
            req = req.continuation_token(token);
        }

        let output = req.send().await
            .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;
        calls += 1;

        for obj in output.contents() {
            let key = obj.key().unwrap_or_default();
            if key.to_lowercase().contains(&query.to_lowercase()) {
                objects.push(S3Object {
                    key: key.to_string(),
                    size: obj.size().unwrap_or(0),
                    last_modified: obj.last_modified().map(|d| d.to_string()),
                    storage_class: obj.storage_class().map(|s| s.as_str().to_string()),
                });
            }
        }
        
        if objects.len() >= 500 {
            break;
        }

        if !output.is_truncated().unwrap_or(false) || calls >= max_search_api_calls {
            break;
        }
        continuation_token = output.next_continuation_token().map(|s| s.to_string());
    }

    Ok(objects)
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

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let presigning_config = PresigningConfig::expires_in(Duration::from_secs(expires_in))
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    let mut get_obj = client
        .get_object()
        .bucket(&bucket_name)
        .key(&key)
        .response_content_disposition("inline");

    // Force PDF content type if extension matches, ensuring browser renders it
    if key.to_lowercase().ends_with(".pdf") {
        get_obj = get_obj.response_content_type("application/pdf");
    }

    let presigned_request = get_obj
        .presigned(presigning_config)
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    Ok(presigned_request.uri().to_string())
}

#[tauri::command]
pub async fn get_object_content(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<String> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let response = client
        .get_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    let body = response.body.collect().await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;
    
    let content = String::from_utf8_lossy(&body.into_bytes()).to_string();
    Ok(content)
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

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let body = ByteStream::from(content.into_bytes());

    client
        .put_object()
        .bucket(&bucket_name)
        .key(&key)
        .body(body)
        .send()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    Ok(())
}
