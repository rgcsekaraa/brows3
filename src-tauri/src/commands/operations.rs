use crate::commands::profiles::ProfileState;
use crate::s3::S3State;
use crate::error::Result;
use aws_sdk_s3::primitives::ByteStream;
use tauri::State;
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

#[tauri::command]
pub async fn put_object(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: Option<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    // Get S3 client
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, d).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let mut request = client
        .put_object()
        .bucket(&bucket_name)
        .key(&key);

    if let Some(path) = local_path {
        // Upload file
        let body = ByteStream::from_path(Path::new(&path)).await
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
        request = request.body(body);
    } else {
        // Create empty object (folder)
        request = request.body(ByteStream::from_static(b""));
    }

    request
        .send()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub async fn get_object(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    // Get S3 client
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, d).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    // Get object
    let mut output = client
        .get_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    // Create local file
    let mut file = File::create(&local_path).await
        .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;

    // Stream to file
    while let Some(bytes) = output.body.try_next().await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))? 
    {
        file.write_all(&bytes).await
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_object(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    // Get S3 client
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, d).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    client
        .delete_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub async fn copy_object(
    source_bucket: String,
    _source_region: Option<String>,
    source_key: String,
    destination_bucket: String,
    destination_region: Option<String>,
    destination_key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let destination_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&destination_bucket)
    }.or(destination_region);

    let mut s3_manager = s3_state.write().await;
    // We need the client for the DESTINATION region to initiate copy
    let client = if let Some(ref d) = destination_region {
        s3_manager.get_client_for_region(&active_profile, d).await?
    } else {
        s3_manager.get_client(&active_profile).await?
    };

    // Copy source must be URL encoded
    // aws-sdk-s3 expects "bucket/key"
    // Simple URL encoding (basic chars) - for robust solution use a library
    // But aws-sdk might handle basic text. Let's send as is first or url-encode key if needed.
    // Correct format: bucket/url_encoded_key
    let key_encoded = urlencoding::encode(&source_key).into_owned();
    let final_source = format!("{}/{}", source_bucket, key_encoded);

    client
        .copy_object()
        .bucket(&destination_bucket)
        .key(&destination_key)
        .copy_source(final_source)
        .send()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_objects(
    bucket_name: String,
    bucket_region: Option<String>,
    keys: Vec<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    if keys.is_empty() {
        return Ok(());
    }

    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, d).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    // Delete in batches of 1000
    for chunk in keys.chunks(1000) {
        let mut delete_ids = Vec::new();
        for key in chunk {
            let obj_id = aws_sdk_s3::types::ObjectIdentifier::builder()
                .key(key)
                .build()
                .map_err(|e| crate::error::AppError::S3Error(format!("Invalid object key '{}': {}", key, e)))?;
            delete_ids.push(obj_id);
        }
        
        let delete = aws_sdk_s3::types::Delete::builder()
            .set_objects(Some(delete_ids))
            .build()
            .map_err(|e| crate::error::AppError::S3Error(format!("Failed to build delete request: {}", e)))?;

        let result = client
            .delete_objects()
            .bucket(&bucket_name)
            .delete(delete.clone())
            .send()
            .await;

        match result {
             Ok(_) => {},
             Err(err) => {
                 // Retry logic for bulk delete
                 log::warn!("delete_objects failed, attempting region discovery: {}", err);
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
                     
                     new_client.delete_objects()
                         .bucket(&bucket_name)
                         .delete(delete)
                         .send()
                         .await
                         .map_err(|e| crate::error::AppError::S3Error(format!("Retry delete failed: {}", e)))?;
                 } else {
                     return Err(crate::error::AppError::S3Error(err.to_string()));
                 }
             }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn move_object(
    source_bucket: String,
    source_region: Option<String>,
    source_key: String,
    destination_bucket: String,
    destination_region: Option<String>,
    destination_key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Check if this is a folder move (key ends with /)
    if source_key.ends_with('/') {
        // RECURSIVE FOLDER MOVE
        let profile_manager = profile_state.read().await;
        let active_profile = profile_manager
            .get_active_profile()
            .await?
            .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
        drop(profile_manager);
        
        // Get client for listing source bucket
        let client = {
            let mut s3_manager = s3_state.write().await;
            if let Some(ref r) = source_region {
                s3_manager.get_client_for_region(&active_profile, r).await?.clone()
            } else {
                s3_manager.get_client(&active_profile).await?.clone()
            }
        };
        
        // List all objects under the source prefix
        let mut continuation_token = None;
        let mut all_keys = Vec::new();
        
        loop {
            let mut req = client.list_objects_v2()
                .bucket(&source_bucket)
                .prefix(&source_key);
            
            if let Some(token) = continuation_token {
                req = req.continuation_token(token);
            }
            
            let resp = req.send().await
                .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;
            
            if let Some(contents) = resp.contents {
                for obj in contents {
                    if let Some(key) = obj.key {
                        all_keys.push(key);
                    }
                }
            }
            
            if resp.is_truncated.unwrap_or(false) {
                continuation_token = resp.next_continuation_token;
            } else {
                break;
            }
        }
        
        // Move each object individually
        for key in &all_keys {
            // Calculate destination key by replacing source prefix with destination prefix
            let relative_path = key.strip_prefix(&source_key).unwrap_or(key);
            let new_key = format!("{}{}", destination_key, relative_path);
            
            // Copy
            copy_object(
                source_bucket.clone(),
                source_region.clone(),
                key.clone(),
                destination_bucket.clone(),
                destination_region.clone(),
                new_key,
                profile_state.clone(),
                s3_state.clone()
            ).await?;
        }
        
        // Delete all source objects at once
        if !all_keys.is_empty() {
            delete_objects(
                source_bucket,
                source_region,
                all_keys,
                profile_state,
                s3_state
            ).await?;
        }
        
        Ok(())
    } else {
        // Single file move (original behavior)
        // 1. Copy
        copy_object(
            source_bucket.clone(),
            source_region.clone(),
            source_key.clone(),
            destination_bucket.clone(),
            destination_region.clone(),
            destination_key.clone(),
            profile_state.clone(),
            s3_state.clone()
        ).await?;
        
        // 2. Delete source
        delete_object(
            source_bucket,
            source_region,
            source_key,
            profile_state,
            s3_state
        ).await?;
        
        Ok(())
    }
}

#[derive(serde::Serialize)]
pub struct ObjectMetadata {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    pub e_tag: Option<String>,
    pub storage_class: Option<String>,
    pub user_metadata: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub async fn get_object_metadata(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<ObjectMetadata> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    
    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }.or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager.get_client_for_region(&active_profile, d).await?.clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let result = client.head_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await;

    let output = match result {
        Ok(out) => out,
        Err(err) => {
            let error_str = err.to_string();
            // If access denied (403), likely permissions, but could be region mismatch too in some cases.
            // But usually region mismatch is 301 or 400.
            if error_str.contains("403") || error_str.contains("Access Denied") {
                 return Err(crate::error::AppError::AccessDenied(error_str));
            }
            
            // Retry logic
            log::warn!("head_object failed, attempting region discovery: {}", err);
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
                new_client.head_object().bucket(&bucket_name).key(&key).send().await
                    .map_err(|e| {
                         let e_str = e.to_string();
                         if e_str.contains("403") || e_str.contains("Access Denied") {
                             crate::error::AppError::AccessDenied(e_str)
                         } else {
                             crate::error::AppError::S3Error(format!("Retry head failed: {}", e_str))
                         }
                    })?
            } else {
                return Err(crate::error::AppError::S3Error(error_str));
            }
        }
    };

    let last_modified = output.last_modified.map(|d| d.to_string());
    
    // Convert HashMap<String, String> from SDK to standard HashMap
    let user_metadata = output.metadata.unwrap_or_default();

    Ok(ObjectMetadata {
        key,
        size: output.content_length.unwrap_or(0),
        last_modified,
        content_type: output.content_type,
        e_tag: output.e_tag,
        storage_class: output.storage_class.map(|s| s.as_str().to_string()),
        user_metadata: user_metadata.into_iter().collect(),
    })
}
