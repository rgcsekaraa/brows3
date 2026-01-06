use crate::credentials::{CredentialType, Profile};
use crate::error::{AppError, Result};
use aws_config::Region;
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};

use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Object {
    pub key: String,
    pub last_modified: Option<String>,
    pub size: i64,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderContent {
    pub objects: Vec<S3Object>,
    pub common_prefixes: Vec<String>,
}

/// S3 Client Manager - creates and caches S3 clients per profile and region
pub struct S3ClientManager {
    clients: HashMap<(String, String), Client>,
    object_cache: HashMap<(String, String), Vec<S3Object>>, // (profile_id, bucket_name) -> objects
    folder_cache: HashMap<(String, String, String), FolderContent>, // (profile_id, bucket_name, prefix) -> children
}

impl S3ClientManager {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            object_cache: HashMap::new(),
            folder_cache: HashMap::new(),
        }
    }

    /// Get or create an S3 client for the given profile's default region
    pub async fn get_client(&mut self, profile: &Profile) -> Result<&Client> {
        let region = profile.region.clone().unwrap_or_else(|| "us-east-1".to_string());
        self.get_client_for_region(profile, &region).await
    }

    /// Get or create an S3 client for the given profile and specific region
    pub async fn get_client_for_region(&mut self, profile: &Profile, region: &str) -> Result<&Client> {
        let key = (profile.id.clone(), region.to_string());
        
        if !self.clients.contains_key(&key) {
            let client = self.build_client(profile, Some(region.to_string())).await?;
            self.clients.insert(key.clone(), client);
        }

        Ok(self.clients.get(&key).unwrap())
    }

    /// Build a new S3 client for the given profile
    async fn build_client(&self, profile: &Profile, override_region: Option<String>) -> Result<Client> {
        let region_str = override_region
            .or_else(|| profile.region.clone())
            .unwrap_or_else(|| "us-east-1".to_string());
            
        let region = Region::new(region_str);

        let sdk_config = match &profile.credential_type {
            CredentialType::Environment => {
                aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region(region)
                    .load()
                    .await
            }
            CredentialType::SharedConfig { profile_name } => {
                aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region(region)
                    .profile_name(profile_name.as_deref().unwrap_or("default"))
                    .load()
                    .await
            }
            CredentialType::Manual {
                access_key_id,
                secret_access_key,
            } => {
                let creds = aws_credential_types::Credentials::new(
                    access_key_id,
                    secret_access_key,
                    None,
                    None,
                    "manual",
                );
                aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region(region)
                    .credentials_provider(creds)
                    .load()
                    .await
            }
            CredentialType::CustomEndpoint {
                access_key_id,
                secret_access_key,
                ..
            } => {
                let creds = aws_credential_types::Credentials::new(
                    access_key_id,
                    secret_access_key,
                    None,
                    None,
                    "custom_endpoint",
                );
                aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region(region)
                    .credentials_provider(creds)
                    .load()
                    .await
            }
        };

        // Build S3 client with custom endpoint if specified
        let mut s3_config_builder = aws_sdk_s3::config::Builder::from(&sdk_config);

        if let CredentialType::CustomEndpoint { endpoint_url, .. } = &profile.credential_type {
            s3_config_builder = s3_config_builder
                .endpoint_url(endpoint_url)
                .force_path_style(true);
        }

        Ok(Client::from_conf(s3_config_builder.build()))
    }

    /// Clear the cached clients and objects
    pub fn clear_cache(&mut self) {
        self.clients.clear();
        self.object_cache.clear();
        self.folder_cache.clear();
    }

    /// Get cached objects for a bucket
    pub fn get_cached_objects(&self, profile_id: &str, bucket_name: &str) -> Option<&Vec<S3Object>> {
        self.object_cache.get(&(profile_id.to_string(), bucket_name.to_string()))
    }

    /// Get cached folder content
    pub fn get_folder_content(&self, profile_id: &str, bucket_name: &str, prefix: &str) -> Option<&FolderContent> {
        self.folder_cache.get(&(profile_id.to_string(), bucket_name.to_string(), prefix.to_string()))
    }

    /// Set cached objects for a bucket
    pub fn set_cached_objects(&mut self, profile_id: &str, bucket_name: &str, objects: Vec<S3Object>) {
        let profile_id_str = profile_id.to_string();
        let bucket_name_str = bucket_name.to_string();
        
        // Build folder cache
        let mut folders: HashMap<String, FolderContent> = HashMap::new();
        // Ensure root exists
        folders.insert("".to_string(), FolderContent { objects: Vec::new(), common_prefixes: Vec::new() });
        
        for obj in &objects {
            let key = &obj.key;
            let parts: Vec<&str> = key.split('/').collect();
            
            let mut current_prefix = "".to_string();
            // Up to the last part (which is the file name or empty if key ends with /)
            for i in 0..parts.len() - 1 {
                let next_part = parts[i];
                let parent_prefix = current_prefix.clone();
                current_prefix = format!("{}{}/", current_prefix, next_part);
                
                // Add this folder to its parent's common_prefixes
                let parent_content = folders.entry(parent_prefix).or_insert(FolderContent { 
                    objects: Vec::new(), 
                    common_prefixes: Vec::new() 
                });
                
                if !parent_content.common_prefixes.contains(&current_prefix) {
                    parent_content.common_prefixes.push(current_prefix.clone());
                }
            }
            
            // If it's not a folder placeholder, add it to objects
            if !key.ends_with('/') {
                let folder_content = folders.entry(current_prefix).or_insert(FolderContent { 
                    objects: Vec::new(), 
                    common_prefixes: Vec::new() 
                });
                folder_content.objects.push(obj.clone());
            }
        }
        
        // Store in the manager's folder_cache
        for (prefix, mut content) in folders {
            content.objects.sort_by(|a, b| a.key.cmp(&b.key));
            content.common_prefixes.sort();
            self.folder_cache.insert((profile_id_str.clone(), bucket_name_str.clone(), prefix), content);
        }
        
        self.object_cache.insert((profile_id_str, bucket_name_str), objects);
    }

    /// Check if a bucket is cached
    pub fn has_cache(&self, profile_id: &str, bucket_name: &str) -> bool {
        self.object_cache.contains_key(&(profile_id.to_string(), bucket_name.to_string()))
    }
}

impl Default for S3ClientManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Bucket information returned from S3
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketInfo {
    pub name: String,
    pub region: Option<String>,
    pub creation_date: Option<String>,
    pub object_count: Option<u64>,
    pub total_size: Option<u64>,
    pub total_size_formatted: Option<String>,
}

/// List all buckets accessible by the current credentials
pub async fn list_buckets(client: &Client) -> Result<Vec<BucketInfo>> {
    let response = client
        .list_buckets()
        .send()
        .await
        .map_err(|e| AppError::S3Error(e.to_string()))?;

    let buckets = response
        .buckets()
        .iter()
        .map(|b| BucketInfo {
            name: b.name().unwrap_or_default().to_string(),
            region: None, // Will be fetched separately if needed
            creation_date: b.creation_date().map(|d| d.to_string()),
            object_count: None,
            total_size: None,
            total_size_formatted: None,
        })
        .collect();

    Ok(buckets)
}

/// Get the region for a specific bucket
pub async fn get_bucket_region(client: &Client, bucket_name: &str) -> Result<String> {
    let response = client
        .get_bucket_location()
        .bucket(bucket_name)
        .send()
        .await
        .map_err(|e| AppError::S3Error(e.to_string()))?;

    // Empty string means us-east-1
    let region = response
        .location_constraint()
        .map(|l| l.as_str().to_string())
        .unwrap_or_else(|| "us-east-1".to_string());

    let region = if region.is_empty() {
        "us-east-1".to_string()
    } else {
        region
    };

    Ok(region)
}

/// List all objects in a bucket recursively
pub async fn list_all_objects_recursive(client: &Client, bucket: &str) -> Result<Vec<S3Object>> {
    let mut objects = Vec::new();
    let mut token = None;

    loop {
        let mut builder = client.list_objects_v2().bucket(bucket);
        if let Some(t) = token {
            builder = builder.continuation_token(t);
        }

        let response = builder
            .send()
            .await
            .map_err(|e| AppError::S3Error(e.to_string()))?;

        for obj in response.contents() {
            objects.push(S3Object {
                key: obj.key().unwrap_or_default().to_string(),
                last_modified: obj.last_modified().map(|d: &aws_sdk_s3::primitives::DateTime| d.to_string()),
                size: obj.size().unwrap_or_default(),
                storage_class: obj.storage_class().map(|s: &aws_sdk_s3::types::ObjectStorageClass| s.as_str().to_string()),
            });
        }

        if response.is_truncated().unwrap_or(false) {
            token = response.next_continuation_token().map(|t| t.to_string());
        } else {
            break;
        }
    }

    Ok(objects)
}

/// Format bytes to human-readable size
pub fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
