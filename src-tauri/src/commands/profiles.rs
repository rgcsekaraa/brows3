use crate::credentials::{Profile, ProfileManager};
use aws_credential_types::provider::ProvideCredentials;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
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
pub async fn list_profiles(state: State<'_, ProfileState>) -> Result<Vec<Profile>, String> {
    let manager = state.read().await;
    manager.list_profiles().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_profile(id: String, state: State<'_, ProfileState>) -> Result<Profile, String> {
    let manager = state.read().await;
    manager.get_profile(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_profile(
    profile: Profile,
    state: State<'_, ProfileState>,
) -> Result<Profile, String> {
    let mut manager = state.write().await;
    manager
        .add_profile(profile)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_profile(
    id: String,
    profile: Profile,
    state: State<'_, ProfileState>,
) -> Result<Profile, String> {
    let mut manager = state.write().await;
    manager
        .update_profile(&id, profile)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_profile(id: String, state: State<'_, ProfileState>) -> Result<(), String> {
    let mut manager = state.write().await;
    manager.delete_profile(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_profile(id: String, state: State<'_, ProfileState>) -> Result<(), String> {
    let mut manager = state.write().await;
    manager
        .set_active_profile(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_profile(state: State<'_, ProfileState>) -> Result<Option<Profile>, String> {
    let manager = state.read().await;
    manager
        .get_active_profile()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    mut profile: Profile,
    state: State<'_, ProfileState>,
) -> Result<TestConnectionResult, String> {
    use aws_sdk_s3::error::ProvideErrorMetadata;

    // Hydrate profile secrets from keychain if they are empty
    {
        let manager = state.read().await;
        let needs_hydration = match &profile.credential_type {
            crate::credentials::CredentialType::Manual {
                secret_access_key, ..
            } => secret_access_key.is_empty(),
            crate::credentials::CredentialType::CustomEndpoint {
                secret_access_key, ..
            } => secret_access_key.is_empty(),
            _ => false,
        };

        if needs_hydration && !profile.id.is_empty() {
            profile = manager.hydrate_profile(profile);
        }
    }

    let sdk_config = crate::s3::client::load_sdk_config(&profile, None).await;

    if let Some(provider) = sdk_config.credentials_provider() {
        if let Err(err) = provider.provide_credentials().await {
            let message = match &profile.credential_type {
                crate::credentials::CredentialType::SharedConfig { profile_name } => {
                    let name = profile_name.as_deref().unwrap_or("default");
                    format!(
                        "Could not load credentials for AWS profile '{name}': {err}. If this is an IAM Identity Center (SSO) profile, choose Sign in with AWS SSO or run `aws sso login --profile {name}`, then retry."
                    )
                }
                _ => format!("Could not load AWS credentials: {err}"),
            };

            return Ok(TestConnectionResult {
                success: false,
                message,
                region: None,
                bucket_count: None,
            });
        }
    }

    let client = crate::s3::client::client_from_sdk_config(&sdk_config, &profile);

    // Test connection by listing buckets
    match client.list_buckets().send().await {
        Ok(response) => {
            let bucket_count = response.buckets().len();
            Ok(TestConnectionResult {
                success: true,
                message: format!("Connected successfully! Found {} bucket(s)", bucket_count),
                region: Some(
                    profile
                        .region
                        .clone()
                        .unwrap_or_else(|| "us-east-1".to_string()),
                ),
                bucket_count: Some(bucket_count),
            })
        }
        Err(e) => {
            let error_string = e.to_string();

            // Check for dispatch failure - common with S3-compatible providers
            // when the endpoint URL is malformed or unreachable
            if error_string.contains("dispatch failure") {
                return Ok(TestConnectionResult {
                    success: false,
                    message: "Connection failed: Could not reach the endpoint. Please verify the endpoint URL is correct (e.g., https://us-east-1.linodeobjects.com) and that your network can reach it.".to_string(),
                    region: None,
                    bucket_count: None,
                });
            }

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
    pub is_sso: bool,
}

#[derive(Debug, Clone, Copy)]
enum ProfileFileKind {
    Credentials,
    Config,
}

#[derive(Debug, Default)]
struct LocalProfileMetadata {
    region: Option<String>,
    is_sso: bool,
}

fn profile_name_from_section(section: &str, kind: ProfileFileKind) -> Option<String> {
    let section = section.trim();
    if section.is_empty() {
        return None;
    }

    match kind {
        ProfileFileKind::Credentials => Some(section.to_string()),
        ProfileFileKind::Config => {
            if section == "default" {
                Some(section.to_string())
            } else if let Some(name) = section.strip_prefix("profile ") {
                let name = name.trim();
                (!name.is_empty()).then(|| name.to_string())
            } else {
                // Sections such as [sso-session name] and [services name]
                // configure profiles but are not themselves selectable profiles.
                None
            }
        }
    }
}

fn parse_profile_file(
    content: &str,
    kind: ProfileFileKind,
    profiles: &mut HashMap<String, LocalProfileMetadata>,
) {
    let mut current_profile: Option<String> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        if let Some(section) = line
            .strip_prefix('[')
            .and_then(|value| value.split_once(']'))
            .map(|(section, _)| section)
        {
            current_profile = profile_name_from_section(section, kind);
            if let Some(name) = &current_profile {
                profiles.entry(name.clone()).or_default();
            }
            continue;
        }

        let Some(profile_name) = &current_profile else {
            continue;
        };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        let metadata = profiles.entry(profile_name.clone()).or_default();

        match key.as_str() {
            "region" if !value.is_empty() => metadata.region = Some(value.to_string()),
            "sso_session" | "sso_start_url" if !value.is_empty() => metadata.is_sso = true,
            _ => {}
        }
    }
}

fn local_profile_files() -> Result<Vec<(PathBuf, ProfileFileKind)>, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let credentials = std::env::var_os("AWS_SHARED_CREDENTIALS_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".aws").join("credentials"));
    let config = std::env::var_os("AWS_CONFIG_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".aws").join("config"));

    Ok(vec![
        (credentials, ProfileFileKind::Credentials),
        (config, ProfileFileKind::Config),
    ])
}

#[tauri::command]
pub async fn discover_local_profiles() -> Result<Vec<DiscoveredProfile>, String> {
    let mut profiles: HashMap<String, LocalProfileMetadata> = HashMap::new();

    for (path, kind) in local_profile_files()? {
        log::info!("Checking AWS credentials path: {:?}", path);
        if !path.exists() {
            log::info!("Path does not exist.");
            continue;
        }

        log::info!("Path exists, reading content...");
        match std::fs::read_to_string(&path) {
            Ok(content) => parse_profile_file(&content, kind, &mut profiles),
            Err(err) => log::warn!("Could not read AWS profile file {:?}: {}", path, err),
        }
    }

    if profiles.is_empty() {
        log::info!("No profiles found, defaulting to 'default'");
        profiles.insert("default".to_string(), LocalProfileMetadata::default());
    }

    let mut result: Vec<DiscoveredProfile> = profiles
        .into_iter()
        .map(|(name, metadata)| DiscoveredProfile {
            name,
            region: metadata.region,
            is_sso: metadata.is_sso,
        })
        .collect();

    result.sort_by(|a, b| a.name.cmp(&b.name));

    log::info!("Found total of {} profiles", result.len());

    Ok(result)
}

fn aws_cli_path() -> PathBuf {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramW6432"] {
            if let Some(root) = std::env::var_os(variable) {
                candidates.push(PathBuf::from(root).join("Amazon/AWSCLIV2/aws.exe"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/aws"));
        candidates.push(PathBuf::from("/usr/local/bin/aws"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/local/bin/aws"));
        candidates.push(PathBuf::from("/usr/bin/aws"));
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| {
            PathBuf::from(if cfg!(target_os = "windows") {
                "aws.exe"
            } else {
                "aws"
            })
        })
}

fn concise_cli_error(output: &[u8]) -> String {
    let message = String::from_utf8_lossy(output).trim().to_string();
    if message.chars().count() > 2_000 {
        format!("{}…", message.chars().take(2_000).collect::<String>())
    } else {
        message
    }
}

#[tauri::command]
pub async fn login_sso(profile_name: String) -> Result<String, String> {
    let profile_name = profile_name.trim();
    if profile_name.is_empty() {
        return Err("AWS profile name is required".to_string());
    }

    let mut command = tokio::process::Command::new(aws_cli_path());
    command
        .args(["sso", "login", "--profile", profile_name])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(10 * 60), command.output())
        .await
        .map_err(|_| "AWS SSO sign-in timed out after 10 minutes".to_string())?
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                "AWS CLI v2 was not found. Install it, then run `aws sso login --profile <name>` or try this button again.".to_string()
            } else {
                format!("Could not start AWS CLI: {err}")
            }
        })?;

    if output.status.success() {
        Ok(format!(
            "AWS SSO sign-in completed for profile '{profile_name}'"
        ))
    } else {
        let stderr = concise_cli_error(&output.stderr);
        let stdout = concise_cli_error(&output.stdout);
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        Err(if detail.is_empty() {
            format!("AWS SSO sign-in failed with status {}", output.status)
        } else {
            format!("AWS SSO sign-in failed: {detail}")
        })
    }
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
        region: std::env::var("AWS_REGION")
            .ok()
            .or_else(|| std::env::var("AWS_DEFAULT_REGION").ok()),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_profile_file, LocalProfileMetadata, ProfileFileKind};
    use std::collections::HashMap;

    #[test]
    fn discovery_marks_sso_profiles_and_skips_support_sections() {
        let config = r#"
            [profile engineering]
            sso_session = company
            sso_account_id = 123456789012
            sso_role_name = Developer
            region = ap-southeast-2

            [sso-session company]
            sso_start_url = https://example.awsapps.com/start
            sso_region = us-east-1

            [services local]
            s3 =
              endpoint_url = http://localhost:9000
        "#;
        let mut profiles: HashMap<String, LocalProfileMetadata> = HashMap::new();

        parse_profile_file(config, ProfileFileKind::Config, &mut profiles);

        assert_eq!(profiles.len(), 1);
        let engineering = profiles.get("engineering").unwrap();
        assert!(engineering.is_sso);
        assert_eq!(engineering.region.as_deref(), Some("ap-southeast-2"));
        assert!(!profiles.contains_key("sso-session company"));
        assert!(!profiles.contains_key("services local"));
    }

    #[test]
    fn discovery_merges_credentials_and_config_profile_data() {
        let mut profiles: HashMap<String, LocalProfileMetadata> = HashMap::new();
        parse_profile_file(
            "[archive]\naws_access_key_id = test",
            ProfileFileKind::Credentials,
            &mut profiles,
        );
        parse_profile_file(
            "[profile archive]\nregion = eu-west-1",
            ProfileFileKind::Config,
            &mut profiles,
        );

        assert_eq!(profiles.len(), 1);
        assert_eq!(
            profiles.get("archive").unwrap().region.as_deref(),
            Some("eu-west-1")
        );
    }
}
