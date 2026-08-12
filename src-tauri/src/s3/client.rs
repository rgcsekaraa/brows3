use crate::credentials::{CredentialType, Profile};
use crate::error::{AppError, Result};
use aws_config::Region;
use aws_sdk_s3::config::{RequestChecksumCalculation, ResponseChecksumValidation};
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};

use std::collections::{HashMap, VecDeque};

type SortedFolderCacheKey = (String, String, String, String, String);

const MAX_SORTED_CACHE_ENTRIES: usize = 32;
const MAX_SORTED_CACHE_ITEMS: usize = 100_000;

/// Normalize an endpoint URL to ensure it has a scheme.
/// Many S3-compatible providers (Linode, DigitalOcean, etc.) may be configured
/// without a scheme, causing the AWS SDK to fail with "dispatch failure".
pub(crate) fn normalize_endpoint_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Object {
    pub key: String,
    pub last_modified: Option<String>,
    pub size: i64,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FolderContent {
    pub objects: Vec<S3Object>,
    pub common_prefixes: Vec<String>,
}

/// S3 Client Manager - creates and caches S3 clients per profile and region
pub struct S3ClientManager {
    clients: HashMap<(String, String), Client>,
    sorted_folder_cache: HashMap<SortedFolderCacheKey, FolderContent>,
    sorted_folder_cache_order: VecDeque<SortedFolderCacheKey>,
    sorted_folder_cache_items: usize,
    bucket_regions: HashMap<String, String>, // bucket_name -> region
}

impl S3ClientManager {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            sorted_folder_cache: HashMap::new(),
            sorted_folder_cache_order: VecDeque::new(),
            sorted_folder_cache_items: 0,
            bucket_regions: HashMap::new(),
        }
    }

    /// Get or create an S3 client for the given profile's default region
    pub async fn get_client(&mut self, profile: &Profile) -> Result<&Client> {
        let region = profile
            .region
            .clone()
            .unwrap_or_else(|| "us-east-1".to_string());
        self.get_client_for_region(profile, &region).await
    }

    /// Get or create an S3 client for the given profile and specific region
    pub async fn get_client_for_region(
        &mut self,
        profile: &Profile,
        region: &str,
    ) -> Result<&Client> {
        let key = (profile.id.clone(), region.to_string());

        if !self.clients.contains_key(&key) {
            let client = self.build_client(profile, Some(region.to_string())).await?;
            self.clients.insert(key.clone(), client);
        }

        Ok(self.clients.get(&key).unwrap())
    }

    /// Build a new S3 client for the given profile
    async fn build_client(
        &self,
        profile: &Profile,
        override_region: Option<String>,
    ) -> Result<Client> {
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
            let normalized_url = normalize_endpoint_url(endpoint_url);
            s3_config_builder = s3_config_builder
                .endpoint_url(&normalized_url)
                .force_path_style(true)
                .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
                .response_checksum_validation(ResponseChecksumValidation::WhenRequired);
        }

        Ok(Client::from_conf(s3_config_builder.build()))
    }

    /// Clear cached clients, sorted folder results, and discovered regions.
    pub fn clear_cache(&mut self) {
        self.clients.clear();
        self.sorted_folder_cache.clear();
        self.sorted_folder_cache_order.clear();
        self.sorted_folder_cache_items = 0;
        self.bucket_regions.clear();
    }

    /// Get cached region for a bucket
    pub fn get_bucket_region(&self, bucket_name: &str) -> Option<String> {
        self.bucket_regions.get(bucket_name).cloned()
    }

    /// Cache the region for a bucket
    pub fn set_bucket_region(&mut self, bucket_name: &str, region: String) {
        self.bucket_regions.insert(bucket_name.to_string(), region);
    }

    /// Cache the same region for a set of buckets.
    pub fn set_bucket_regions<I>(&mut self, bucket_names: I, region: &str)
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        for bucket_name in bucket_names {
            self.set_bucket_region(bucket_name.as_ref(), region.to_string());
        }
    }

    pub fn get_sorted_folder_content(
        &self,
        profile_id: &str,
        bucket_name: &str,
        prefix: &str,
        sort_field: &str,
        sort_direction: &str,
    ) -> Option<&FolderContent> {
        self.sorted_folder_cache.get(&(
            profile_id.to_string(),
            bucket_name.to_string(),
            prefix.to_string(),
            sort_field.to_string(),
            sort_direction.to_string(),
        ))
    }

    pub fn set_sorted_folder_content(
        &mut self,
        profile_id: &str,
        bucket_name: &str,
        prefix: &str,
        sort_field: &str,
        sort_direction: &str,
        content: FolderContent,
    ) {
        let key = (
            profile_id.to_string(),
            bucket_name.to_string(),
            prefix.to_string(),
            sort_field.to_string(),
            sort_direction.to_string(),
        );
        let item_count = content
            .objects
            .len()
            .saturating_add(content.common_prefixes.len());

        if let Some(previous) = self.sorted_folder_cache.remove(&key) {
            self.sorted_folder_cache_items = self.sorted_folder_cache_items.saturating_sub(
                previous
                    .objects
                    .len()
                    .saturating_add(previous.common_prefixes.len()),
            );
            self.sorted_folder_cache_order
                .retain(|cached_key| cached_key != &key);
        }

        if item_count > MAX_SORTED_CACHE_ITEMS {
            return;
        }

        while self.sorted_folder_cache.len() >= MAX_SORTED_CACHE_ENTRIES
            || self.sorted_folder_cache_items.saturating_add(item_count) > MAX_SORTED_CACHE_ITEMS
        {
            let Some(oldest_key) = self.sorted_folder_cache_order.pop_front() else {
                break;
            };
            if let Some(evicted) = self.sorted_folder_cache.remove(&oldest_key) {
                self.sorted_folder_cache_items = self.sorted_folder_cache_items.saturating_sub(
                    evicted
                        .objects
                        .len()
                        .saturating_add(evicted.common_prefixes.len()),
                );
            }
        }

        self.sorted_folder_cache_items = self.sorted_folder_cache_items.saturating_add(item_count);
        self.sorted_folder_cache_order.push_back(key.clone());
        self.sorted_folder_cache.insert(key, content);
    }

    /// Remove cached sorted results for a specific profile and bucket.
    pub fn remove_bucket_cache(&mut self, profile_id: &str, bucket_name: &str) {
        let pid = profile_id.to_string();
        let bname = bucket_name.to_string();

        self.sorted_folder_cache
            .retain(|(p, b, _, _, _), _| p != &pid || b != &bname);
        self.sorted_folder_cache_order
            .retain(|(p, b, _, _, _)| p != &pid || b != &bname);
        self.sorted_folder_cache_items = self
            .sorted_folder_cache
            .values()
            .map(|content| {
                content
                    .objects
                    .len()
                    .saturating_add(content.common_prefixes.len())
            })
            .sum();
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

/// Get the region for a specific bucket.
/// Note: GetBucketLocation is not supported by all S3-compatible providers
/// (e.g., Linode Object Storage, DigitalOcean Spaces). Callers should handle
/// errors gracefully and fall back to the profile's configured region.
pub async fn get_bucket_region(client: &Client, bucket_name: &str) -> Result<String> {
    // Use a timeout to prevent hanging on providers that don't support this API
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.get_bucket_location().bucket(bucket_name).send(),
    )
    .await;

    let response = match result {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => {
            return Err(AppError::S3Error(format!(
                "GetBucketLocation failed for '{}': {}",
                bucket_name, e
            )));
        }
        Err(_) => {
            return Err(AppError::S3Error(format!(
                "GetBucketLocation timed out for '{}'",
                bucket_name
            )));
        }
    };

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

#[cfg(test)]
mod tests {
    use super::{
        normalize_endpoint_url, FolderContent, S3ClientManager, S3Object, MAX_SORTED_CACHE_ENTRIES,
    };

    #[test]
    fn normalize_endpoint_url_preserves_existing_scheme() {
        assert_eq!(
            normalize_endpoint_url("https://us-east-1.linodeobjects.com"),
            "https://us-east-1.linodeobjects.com"
        );
        assert_eq!(
            normalize_endpoint_url("http://localhost:9000"),
            "http://localhost:9000"
        );
    }

    #[test]
    fn normalize_endpoint_url_defaults_to_https() {
        assert_eq!(
            normalize_endpoint_url("us-east-1.linodeobjects.com"),
            "https://us-east-1.linodeobjects.com"
        );
    }

    #[test]
    fn normalize_endpoint_url_trims_whitespace() {
        assert_eq!(
            normalize_endpoint_url("  us-east-1.linodeobjects.com  "),
            "https://us-east-1.linodeobjects.com"
        );
    }

    #[test]
    fn sorted_folder_cache_evicts_the_oldest_entry_at_its_limit() {
        let mut manager = S3ClientManager::new();

        for index in 0..=MAX_SORTED_CACHE_ENTRIES {
            manager.set_sorted_folder_content(
                "profile",
                "bucket",
                &format!("prefix-{index}/"),
                "size",
                "desc",
                FolderContent {
                    objects: vec![S3Object {
                        key: format!("object-{index}"),
                        last_modified: None,
                        size: index as i64,
                        storage_class: None,
                    }],
                    common_prefixes: Vec::new(),
                },
            );
        }

        assert!(manager
            .get_sorted_folder_content("profile", "bucket", "prefix-0/", "size", "desc")
            .is_none());
        assert!(manager
            .get_sorted_folder_content(
                "profile",
                "bucket",
                &format!("prefix-{MAX_SORTED_CACHE_ENTRIES}/"),
                "size",
                "desc"
            )
            .is_some());
        assert_eq!(manager.sorted_folder_cache.len(), MAX_SORTED_CACHE_ENTRIES);
    }
}
