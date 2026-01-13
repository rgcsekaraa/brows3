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
    pub bucket_region: Option<String>,
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
                     .clone()
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
                     bucket_region: bucket_region,
                 });
            } else if let Some(obj) = s3_manager.get_object_from_cache(&active_profile.id, &bucket_name, &prefix_str) {
                 // Fallback: Check if the prefix is actually a file object itself
                 return Ok(ListObjectsResult {
                     objects: vec![obj],
                     common_prefixes: Vec::new(),
                     next_continuation_token: None,
                     is_truncated: false,
                     prefix: prefix_str,
                     bucket_region: bucket_region,
                 });
            } else {
                 // If bucket is cached but prefix is not found, it's an empty folder
                 return Ok(ListObjectsResult {
                     objects: Vec::new(),
                     common_prefixes: Vec::new(),
                     next_continuation_token: None,
                     is_truncated: false,
                     prefix: prefix_str,
                     bucket_region: bucket_region,
                 });
            }
        }
    }
    
    // If bypassing cache, we should invalidate the existing cache for this bucket
    if bypass_cache.unwrap_or(false) {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    // Check cache for bucket region first
    let mut bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    // 3. Perform network IO outside of locks, including retry logic
    let mut request = client
        .list_objects_v2()
        .bucket(&bucket_name)
        .prefix(&prefix_str)
        .delimiter(&delimiter_str);

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
                        log::info!("Detected correct region for bucket '{}': {}", bucket_name, region);
                        Some(region)
                    },
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
                    s3_manager.get_client_for_region(&active_profile, &new_region).await?.clone()
                };
                
                // Retry request
                let mut retry_req = new_client
                    .list_objects_v2()
                    .bucket(&bucket_name)
                    .prefix(&prefix_str)
                    .delimiter(&delimiter_str);
                    
                if let Some(token) = &continuation_token {
                    retry_req = retry_req.continuation_token(token);
                }
                if let Some(max) = max_keys {
                    retry_req = retry_req.max_keys(max);
                }
                
                // Update the region we will return and use for fallback
                bucket_region = Some(new_region.clone());
                
                // Cache the discovered region for future requests
                {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region);
                }
                
                retry_req.send().await
                    .map_err(|e| crate::error::AppError::S3Error(format!("Retry failed: {}", e)))?
            } else {
                return Err(crate::error::AppError::S3Error(err.to_string()));
            }
        }
    };

    // Map objects
    let mut objects: Vec<S3Object> = output
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

    // Fallback: If empty, try HeadObject to see if it's a direct file reference
    // We strip the trailing slash because some systems/users append it accidentally to files
    if objects.is_empty() && common_prefixes.is_empty() && !prefix_str.is_empty() {
        let clean_key = prefix_str.trim_end_matches('/').to_string();
        if !clean_key.is_empty() {
            let client = {
                let mut s3_manager = s3_state.write().await;
                if let Some(ref region) = bucket_region {
                    s3_manager.get_client_for_region(&active_profile, region).await?.clone()
                } else {
                    s3_manager.get_client(&active_profile).await?.clone()
                }
            };

            if let Ok(head_output) = client.head_object().bucket(&bucket_name).key(&clean_key).send().await {
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
        bucket_region,
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
) -> Result<Vec<S3Object>> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    
    let prefix_str = prefix.unwrap_or_default();
    
    // 1. Try Cache First
    {
        let s3_manager = s3_state.read().await;
        if s3_manager.has_cache(&active_profile.id, &bucket_name) {
            if let Some(all_objects) = s3_manager.get_cached_objects(&active_profile.id, &bucket_name) {
                 let q = query.to_lowercase();
                 let filtered: Vec<S3Object> = all_objects.iter()
                     // If searching from a prefix, only include objects starting with that prefix
                     .filter(|obj| obj.key.starts_with(&prefix_str) && obj.key.to_lowercase().contains(&q))
                     .cloned()
                     .collect();
                 return Ok(filtered);
            }
        }
    }

    // 2. Fallback to S3
    
    // Check cache for bucket region first
    let mut bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

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
    let max_search_api_calls = 50; // Increased from 10 to search deeper
    let result_limit = 1000; // Increased from 500
    let mut calls = 0;

    loop {
        let mut req = client.list_objects_v2()
            .bucket(&bucket_name)
            .prefix(&prefix_str); // Respect prefix context

        if let Some(token) = continuation_token {
            req = req.continuation_token(token);
        }

        let result = req.send().await;
        
        // implement region detection and retry on error
        let output = match result {
            Ok(out) => out,
            Err(err) => {
                log::warn!("Search list_objects failed: {}", err);
                if calls > 0 {
                    // If we already have some results, just return them instead of failing completely mid-stream
                    return Ok(objects);
                }
                
                // Attempt to detect region and retry (only if this is the first call)
                let detected_region = {
                    let retry_client = {
                       let mut s3_manager = s3_state.write().await;
                       s3_manager.get_client(&active_profile).await?.clone()
                    };
                    crate::s3::get_bucket_region(&retry_client, &bucket_name).await.ok()
                };

                if let Some(new_region) = detected_region {
                    let new_client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                        s3_manager.get_client_for_region(&active_profile, &new_region).await?.clone()
                    };
                    
                    let mut retry_req = new_client.list_objects_v2()
                        .bucket(&bucket_name)
                        .prefix(&prefix_str);
                    
                    bucket_region = Some(new_region);
                    retry_req.send().await
                        .map_err(|e| crate::error::AppError::S3Error(format!("Search retry failed: {}", e)))?
                } else {
                    return Err(crate::error::AppError::S3Error(err.to_string()));
                }
            }
        };
        
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
        
        if objects.len() >= result_limit {
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

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
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
        Ok(config) => get_obj_builder.presigned(config).await
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
                crate::s3::get_bucket_region(&retry_client, &bucket_name).await.ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager.get_client_for_region(&active_profile, &new_region).await?.clone()
                };

                let mut get_obj = new_client
                    .get_object()
                    .bucket(&bucket_name)
                    .key(&key)
                    .response_content_disposition("inline");

                if key.to_lowercase().ends_with(".pdf") {
                    get_obj = get_obj.response_content_type("application/pdf");
                }

                let presigning_config = PresigningConfig::expires_in(Duration::from_secs(expires_in))
                    .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

                let req = get_obj.presigned(presigning_config).await
                    .map_err(|e| crate::error::AppError::S3Error(format!("Retry presign failed: {}", e)))?;
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
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<String> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
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
            log::warn!("get_object_content failed, attempting region discovery: {}", err);
            let detected_region = {
                let retry_client = {
                   let mut s3_manager = s3_state.write().await;
                   s3_manager.get_client(&active_profile).await?.clone()
                };
                crate::s3::get_bucket_region(&retry_client, &bucket_name).await.ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager.get_client_for_region(&active_profile, &new_region).await?.clone()
                };
                new_client.get_object().bucket(&bucket_name).key(&key).send().await
                    .map_err(|e| crate::error::AppError::S3Error(format!("Retry get content failed: {}", e)))?
            } else {
                return Err(crate::error::AppError::S3Error(err.to_string()));
            }
        }
    };

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

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, region).await?.clone()
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
        Ok(_) => Ok(()),
        Err(err) => {
            log::warn!("put_object_content failed, attempting region discovery: {}", err);
            let detected_region = {
                let retry_client = {
                   let mut s3_manager = s3_state.write().await;
                   s3_manager.get_client(&active_profile).await?.clone()
                };
                crate::s3::get_bucket_region(&retry_client, &bucket_name).await.ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager.get_client_for_region(&active_profile, &new_region).await?.clone()
                };
                let retry_body = ByteStream::from(body_bytes);
                new_client.put_object().bucket(&bucket_name).key(&key).body(retry_body).send().await
                    .map_err(|e| crate::error::AppError::S3Error(format!("Retry put content failed: {}", e)))?;
                Ok(())
            } else {
                Err(crate::error::AppError::S3Error(err.to_string()))
            }
        }
    }
}
