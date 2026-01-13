use crate::credentials::{Profile, ProfileManager};
use serde::{Deserialize, Serialize};
use tauri::State;
use std::sync::Arc;
use tokio::sync::RwLock;

pub type ProfileState = Arc<RwLock<ProfileManager>>;

#[derive(Debug, Serialize, Deserialize)]
pub struct TestConnectionResult {
    pub success: bool,
    pub message: String,
    pub region: Option<String>,
    pub bucket_count: Option<usize>,
}

#[tauri::command]
pub async fn list_profiles(
    state: State<'_, ProfileState>,
) -> Result<Vec<Profile>, String> {
    let manager = state.read().await;
    manager.list_profiles().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_profile(
    id: String,
    state: State<'_, ProfileState>,
) -> Result<Profile, String> {
    let manager = state.read().await;
    manager.get_profile(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_profile(
    profile: Profile,
    state: State<'_, ProfileState>,
) -> Result<Profile, String> {
    let mut manager = state.write().await;
    manager.add_profile(profile).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_profile(
    id: String,
    profile: Profile,
    state: State<'_, ProfileState>,
) -> Result<Profile, String> {
    let mut manager = state.write().await;
    manager.update_profile(&id, profile).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_profile(
    id: String,
    state: State<'_, ProfileState>,
) -> Result<(), String> {
    let mut manager = state.write().await;
    manager.delete_profile(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_profile(
    id: String,
    state: State<'_, ProfileState>,
) -> Result<(), String> {
    let mut manager = state.write().await;
    manager.set_active_profile(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_profile(
    state: State<'_, ProfileState>,
) -> Result<Option<Profile>, String> {
    let manager = state.read().await;
    manager.get_active_profile().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    mut profile: Profile,
    state: State<'_, ProfileState>,
) -> Result<TestConnectionResult, String> {
    use aws_config::Region;
    use aws_sdk_s3::Client;
    use aws_sdk_s3::error::ProvideErrorMetadata;

    // Hydrate profile secrets from keychain if they are empty
    {
        let manager = state.read().await;
        let needs_hydration = match &profile.credential_type {
            crate::credentials::CredentialType::Manual { secret_access_key, .. } => secret_access_key.is_empty(),
            crate::credentials::CredentialType::CustomEndpoint { secret_access_key, .. } => secret_access_key.is_empty(),
            _ => false,
        };
        
        if needs_hydration && !profile.id.is_empty() {
            profile = manager.hydrate_profile(profile);
        }
    }
    
    let region = Region::new(profile.region.clone().unwrap_or_else(|| "us-east-1".to_string()));
    
    let config = match &profile.credential_type {
        crate::credentials::CredentialType::Environment => {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(region)
                .load()
                .await
        }
        crate::credentials::CredentialType::SharedConfig { profile_name } => {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(region)
                .profile_name(profile_name.as_deref().unwrap_or("default"))
                .load()
                .await
        }
        crate::credentials::CredentialType::Manual { access_key_id, secret_access_key } => {
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
        crate::credentials::CredentialType::CustomEndpoint { endpoint_url: _, access_key_id, secret_access_key } => {
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
    
    // Build S3 client
    let mut s3_config_builder = aws_sdk_s3::config::Builder::from(&config);
    
    // Apply custom endpoint if specified
    if let crate::credentials::CredentialType::CustomEndpoint { endpoint_url, .. } = &profile.credential_type {
        s3_config_builder = s3_config_builder
            .endpoint_url(endpoint_url)
            .force_path_style(true);
    }
    
    let client = Client::from_conf(s3_config_builder.build());
    
    // Test connection by listing buckets
    match client.list_buckets().send().await {
        Ok(response) => {
            let bucket_count = response.buckets().len();
            Ok(TestConnectionResult {
                success: true,
                message: format!("Connected successfully! Found {} bucket(s)", bucket_count),
                region: Some(profile.region.clone().unwrap_or_else(|| "us-east-1".to_string())),
                bucket_count: Some(bucket_count),
            })
        }
        Err(e) => {
            let s3_err = e.as_service_error();
            let code = s3_err.and_then(|s| s.code()).unwrap_or("Unknown");
            let message = s3_err.and_then(|s| s.message()).unwrap_or("No message");

            // If it's an AccessDenied, it means the CREDENTIALS are correct, but the user
            // lacks permission to list all buckets. We can still consider this "connected".
            if code == "AccessDenied" || code == "403" {
                return Ok(TestConnectionResult {
                    success: true,
                    message: "Connected! (Note: You are authenticated, but lack permission to list all buckets. You may need to enter bucket names manually or use a direct link.)".to_string(),
                    region: Some(profile.region.clone().unwrap_or_else(|| "us-east-1".to_string())),
                    bucket_count: Some(0),
                });
            }

            Ok(TestConnectionResult {
                success: false,
                message: format!("Connection failed: {}: {}", code, message),
                region: None,
                bucket_count: None,
            })
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscoveredProfile {
    pub name: String,
    pub region: Option<String>,
}

#[tauri::command]
pub async fn discover_local_profiles() -> Result<Vec<DiscoveredProfile>, String> {
    use std::path::PathBuf;
    use std::collections::HashMap;
    
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    
    // Profiles to check
    let mut files_to_check = Vec::new();
    
    // Respect AWS environment variables for file locations
    if let Ok(val) = std::env::var("AWS_SHARED_CREDENTIALS_FILE") {
        files_to_check.push(PathBuf::from(val));
    } else {
        files_to_check.push(home.join(".aws").join("credentials"));
    }
    
    if let Ok(val) = std::env::var("AWS_CONFIG_FILE") {
        files_to_check.push(PathBuf::from(val));
    } else {
        files_to_check.push(home.join(".aws").join("config"));
    }

    // Map profile_name -> region (if found)
    let mut profiles: HashMap<String, Option<String>> = HashMap::new();

    for path in files_to_check {
        log::info!("Checking AWS credentials path: {:?}", path);
        if path.exists() {
            log::info!("Path exists, reading content...");
            if let Ok(content) = std::fs::read_to_string(&path) {
                let mut current_profile: Option<String> = None;

                for line in content.lines() {
                    let line = line.trim();
                    // Ignore comments
                    if line.starts_with('#') || line.starts_with(';') {
                        continue;
                    }
                    
                    if line.starts_with('[') {
                        // Extract EVERYTHING between []
                        if let Some(end_idx) = line.find(']') {
                            let mut profile_raw = &line[1..end_idx];
                            
                            // Handle [profile name] format in config file correctly
                            if let Some(stripped) = profile_raw.strip_prefix("profile") {
                                let trimmed = stripped.trim_start();
                                // Only strip if it was followed by whitespace or it's the end
                                if trimmed.len() < stripped.len() {
                                    profile_raw = trimmed;
                                }
                            }
                            
                            let profile_name = profile_raw.trim().to_string();
                            if !profile_name.is_empty() {
                                current_profile = Some(profile_name.clone());
                                // Ensure entry exists
                                profiles.entry(profile_name).or_insert(None);
                            }
                        }
                    } else if let Some(ref profile_name) = current_profile {
                        // Parse region = us-east-1
                        if let Some((key, value)) = line.split_once('=') {
                            let key = key.trim().to_lowercase();
                            if key == "region" {
                                let val = value.trim().to_string();
                                if !val.is_empty() {
                                    profiles.insert(profile_name.clone(), Some(val));
                                }
                            }
                        }
                    }
                }
            }
        } else {
            log::info!("Path does not exist.");
        }
    }

    if profiles.is_empty() {
        log::info!("No profiles found, defaulting to 'default'");
        profiles.insert("default".to_string(), None);
    } 
    
    let mut result: Vec<DiscoveredProfile> = profiles
        .into_iter()
        .map(|(name, region)| DiscoveredProfile { name, region })
        .collect();
        
    result.sort_by(|a, b| a.name.cmp(&b.name));
    
    log::info!("Found total of {} profiles", result.len());
    
    Ok(result)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvironmentCheck {
    pub has_access_key: bool,
    pub has_secret_key: bool,
    pub has_session_token: bool,
    pub region: Option<String>,
}

#[tauri::command]
pub async fn check_aws_environment() -> Result<EnvironmentCheck, String> {
    Ok(EnvironmentCheck {
        has_access_key: std::env::var("AWS_ACCESS_KEY_ID").is_ok(),
        has_secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").is_ok(),
        has_session_token: std::env::var("AWS_SESSION_TOKEN").is_ok(),
        region: std::env::var("AWS_REGION").ok().or_else(|| std::env::var("AWS_DEFAULT_REGION").ok()),
    })
}

