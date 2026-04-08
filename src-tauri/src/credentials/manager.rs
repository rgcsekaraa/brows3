use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use uuid::Uuid;

const PROFILES_FILE: &str = "profiles.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CredentialType {
    /// Use environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    Environment,
    
    /// Use AWS shared config file (~/.aws/credentials)
    SharedConfig {
        profile_name: Option<String>,
    },
    
    /// Manual entry with access key and secret (stored in keychain)
    Manual {
        access_key_id: String,
        #[serde(default, skip_serializing)]
        secret_access_key: String,
    },
    
    /// Custom S3-compatible endpoint (MinIO, Wasabi, etc.)
    CustomEndpoint {
        endpoint_url: String,
        access_key_id: String,
        #[serde(default, skip_serializing)]
        secret_access_key: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub credential_type: CredentialType,
    pub region: Option<String>,
    pub is_default: bool,
    #[serde(default)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl Profile {
    pub fn new(name: String, credential_type: CredentialType, region: Option<String>) -> Self {
        let now = chrono::Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            credential_type,
            region,
            is_default: false,
            created_at: Some(now),
            updated_at: Some(now),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
struct ProfilesData {
    profiles: HashMap<String, Profile>,
    active_profile_id: Option<String>,
}

pub struct ProfileManager {
    config_dir: PathBuf,
    data: ProfilesData,
    keychain: super::KeychainStorage,
}

impl ProfileManager {
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        let profiles_path = config_dir.join(PROFILES_FILE);
        log::info!("Initializing ProfileManager. Storage path: {:?}", profiles_path);
        
        let data = if profiles_path.exists() {
            log::info!("Found existing profiles file.");
            let content = std::fs::read_to_string(&profiles_path)?;
            match Self::load_profiles_data(&content) {
                Ok(d) => {
                    log::info!("Successfully loaded profiles data.");
                    d
                },
                Err(e) => {
                    log::error!("Failed to parse profiles.json: {}. Starting fresh.", e);
                    ProfilesData::default()
                }
            }
        } else {
            log::info!("No profiles file found. Creating new.");
            ProfilesData::default()
        };
        
        let keychain = super::KeychainStorage::new("brows3", &config_dir);

        Ok(Self {
            config_dir,
            data,
            keychain,
        })
    }

    fn load_profiles_data(content: &str) -> std::result::Result<ProfilesData, serde_json::Error> {
        if let Ok(data) = serde_json::from_str::<ProfilesData>(content) {
            return Ok(Self::normalize_profiles_data(data));
        }

        if let Ok(profiles) = serde_json::from_str::<Vec<Profile>>(content) {
            return Ok(Self::normalize_profiles_data(ProfilesData {
                profiles: profiles
                    .into_iter()
                    .map(|profile| (profile.id.clone(), profile))
                    .collect(),
                active_profile_id: None,
            }));
        }

        if let Ok(profiles) = serde_json::from_str::<HashMap<String, Profile>>(content) {
            return Ok(Self::normalize_profiles_data(ProfilesData {
                profiles,
                active_profile_id: None,
            }));
        }

        serde_json::from_str::<ProfilesData>(content).map(Self::normalize_profiles_data)
    }

    fn normalize_profiles_data(mut data: ProfilesData) -> ProfilesData {
        let mut normalized_profiles = HashMap::with_capacity(data.profiles.len());
        let mut first_profile_id: Option<String> = None;
        let mut default_profile_id: Option<String> = None;

        for (key, mut profile) in data.profiles.drain() {
            if profile.id.is_empty() {
                profile.id = if !key.is_empty() {
                    key
                } else {
                    Uuid::new_v4().to_string()
                };
            }

            if first_profile_id.is_none() {
                first_profile_id = Some(profile.id.clone());
            }
            if profile.is_default && default_profile_id.is_none() {
                default_profile_id = Some(profile.id.clone());
            }

            normalized_profiles.insert(profile.id.clone(), profile);
        }

        let mut active_profile_id = data.active_profile_id
            .filter(|id| normalized_profiles.contains_key(id));

        if active_profile_id.is_none() {
            active_profile_id = default_profile_id.or(first_profile_id.clone());
        }

        for profile in normalized_profiles.values_mut() {
            profile.is_default = active_profile_id.as_ref() == Some(&profile.id);
        }

        ProfilesData {
            profiles: normalized_profiles,
            active_profile_id,
        }
    }

    fn sync_default_flags(&mut self) {
        let active_profile_id = self.data.active_profile_id.clone();
        for profile in self.data.profiles.values_mut() {
            profile.is_default = active_profile_id.as_ref() == Some(&profile.id);
        }
    }
    
    fn save(&self) -> Result<()> {
        let profiles_path = self.config_dir.join(PROFILES_FILE);
        let temp_path = profiles_path.with_extension("tmp");
        
        log::info!("Saving profiles atomically to {:?}", profiles_path);
        
        // 1. Write to temp file
        let content = serde_json::to_string_pretty(&self.data)?;
        std::fs::write(&temp_path, content)?;

        #[cfg(unix)]
        {
            // On Unix, rename replaces the destination atomically.
            std::fs::rename(&temp_path, &profiles_path)?;
        }

        #[cfg(windows)]
        {
            // Windows rename does not replace an existing destination file.
            if profiles_path.exists() {
                std::fs::remove_file(&profiles_path)?;
            }
            std::fs::rename(&temp_path, &profiles_path)?;
        }
        
        Ok(())
    }
    
    pub async fn list_profiles(&self) -> Result<Vec<Profile>> {
        let mut profiles: Vec<Profile> = self.data.profiles.values().cloned().collect();
        profiles.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(profiles)
    }
    
    pub async fn get_profile(&self, id: &str) -> Result<Profile> {
        let profile = self.data.profiles
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))?;
        Ok(self.hydrate_profile(profile))
    }
    
    pub async fn add_profile(&mut self, mut profile: Profile) -> Result<Profile> {
        // Generate ID if not provided
        if profile.id.is_empty() {
            profile.id = Uuid::new_v4().to_string();
        }
        // Check for duplicate name
        if self.data.profiles.values().any(|p| p.name == profile.name) {
            return Err(AppError::ProfileExists(profile.name.clone()));
        }
        
        // Store secret in keychain for manual/custom endpoint credentials
        self.store_secret(&profile)?;
        
        // Set timestamps
        let now = chrono::Utc::now();
        profile.created_at = Some(now);
        profile.updated_at = Some(now);
        
        // If this is the first profile, make it default
        if self.data.profiles.is_empty() {
            profile.is_default = true;
            self.data.active_profile_id = Some(profile.id.clone());
        }
        
        self.data.profiles.insert(profile.id.clone(), profile.clone());
        self.sync_default_flags();
        self.save()?;
        
        Ok(self.hydrate_profile(
            self.data
                .profiles
                .get(&profile.id)
                .cloned()
                .ok_or_else(|| AppError::ProfileNotFound(profile.id.clone()))?
        ))
    }
    
    pub async fn update_profile(&mut self, id: &str, mut profile: Profile) -> Result<Profile> {
        let existing_profile = self.data.profiles
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))?;
        let hydrated_existing_profile = self.hydrate_profile(existing_profile.clone());

        if self.data.profiles.values().any(|p| p.id != id && p.name == profile.name) {
            return Err(AppError::ProfileExists(profile.name.clone()));
        }

        profile.id = id.to_string();
        profile.created_at = existing_profile.created_at;
        profile.is_default = self.data.active_profile_id.as_deref() == Some(id);
        profile.updated_at = Some(chrono::Utc::now());

        // Keep previous secret if the edit payload omitted it.
        match (&hydrated_existing_profile.credential_type, &mut profile.credential_type) {
            (
                CredentialType::Manual { secret_access_key: old_secret, .. },
                CredentialType::Manual { secret_access_key, .. }
            ) if secret_access_key.is_empty() => {
                *secret_access_key = old_secret.clone();
            }
            (
                CredentialType::CustomEndpoint { secret_access_key: old_secret, .. },
                CredentialType::CustomEndpoint { secret_access_key, .. }
            ) if secret_access_key.is_empty() => {
                *secret_access_key = old_secret.clone();
            }
            _ => {}
        }

        if matches!(existing_profile.credential_type, CredentialType::Manual { .. } | CredentialType::CustomEndpoint { .. }) {
            self.remove_secret(&existing_profile);
        }

        // Update secret in keychain if needed
        self.store_secret(&profile)?;

        self.data.profiles.insert(id.to_string(), profile.clone());
        self.sync_default_flags();
        self.save()?;

        Ok(self.hydrate_profile(profile))
    }
    
    pub async fn delete_profile(&mut self, id: &str) -> Result<()> {
        let profile = self.data.profiles
            .remove(id)
            .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))?;
        
        // Remove secret from keychain
        self.remove_secret(&profile);
        
        // If this was the active profile, clear it
        if self.data.active_profile_id.as_deref() == Some(id) {
            self.data.active_profile_id = self.data.profiles.keys().next().cloned();
        }

        self.sync_default_flags();
        
        self.save()?;
        Ok(())
    }
    
    pub async fn set_active_profile(&mut self, id: &str) -> Result<()> {
        if !self.data.profiles.contains_key(id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        
        self.data.active_profile_id = Some(id.to_string());
        self.sync_default_flags();
        self.save()?;
        Ok(())
    }
    
    pub async fn get_active_profile(&self) -> Result<Option<Profile>> {
        match &self.data.active_profile_id {
            Some(id) => {
                let profile = self.data.profiles.get(id).cloned();
                Ok(profile.map(|p| self.hydrate_profile(p)))
            }
            None => Ok(None),
        }
    }

    /// Get a profile and populate its secret from the keychain if applicable
    pub fn hydrate_profile(&self, mut profile: Profile) -> Profile {
        if let Some(secret) = self.load_secret(&profile).ok().flatten() {
            match &mut profile.credential_type {
                CredentialType::Manual { secret_access_key, .. } => {
                    *secret_access_key = secret;
                }
                CredentialType::CustomEndpoint { secret_access_key, .. } => {
                    *secret_access_key = secret;
                }
                _ => {}
            }
        }
        profile
    }
    
    fn store_secret(&self, profile: &Profile) -> Result<()> {
        match &profile.credential_type {
            CredentialType::Manual { access_key_id: _, secret_access_key } => {
                if !secret_access_key.is_empty() {
                    self.keychain.store(&profile.id, secret_access_key)?;
                }
            }
            CredentialType::CustomEndpoint { access_key_id: _, secret_access_key, .. } => {
                if !secret_access_key.is_empty() {
                    self.keychain.store(&profile.id, secret_access_key)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    
    fn remove_secret(&self, profile: &Profile) {
        match &profile.credential_type {
            CredentialType::Manual { .. } | CredentialType::CustomEndpoint { .. } => {
                let _ = self.keychain.delete(&profile.id);
            }
            _ => {}
        }
    }
    
    pub fn load_secret(&self, profile: &Profile) -> Result<Option<String>> {
        match &profile.credential_type {
            CredentialType::Manual { .. } | CredentialType::CustomEndpoint { .. } => {
                Ok(self.keychain.get(&profile.id).ok())
            }
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CredentialType, Profile, ProfileManager};
    use std::collections::HashMap;

    #[test]
    fn manual_profile_deserializes_without_secret_in_json() {
        let json = r#"{
            "id": "manual-1",
            "name": "Manual",
            "credential_type": {
                "type": "Manual",
                "access_key_id": "AKIA123"
            },
            "region": "us-east-1",
            "is_default": true
        }"#;

        let profile: Profile = serde_json::from_str(json).expect("profile should deserialize");
        match profile.credential_type {
            CredentialType::Manual { access_key_id, secret_access_key } => {
                assert_eq!(access_key_id, "AKIA123");
                assert!(secret_access_key.is_empty());
            }
            _ => panic!("expected manual credentials"),
        }
    }

    #[test]
    fn custom_endpoint_profile_deserializes_without_secret_in_json() {
        let json = r#"{
            "id": "custom-1",
            "name": "MinIO",
            "credential_type": {
                "type": "CustomEndpoint",
                "endpoint_url": "http://localhost:9000",
                "access_key_id": "minio"
            },
            "region": "us-east-1",
            "is_default": false
        }"#;

        let profile: Profile = serde_json::from_str(json).expect("profile should deserialize");
        match profile.credential_type {
            CredentialType::CustomEndpoint { endpoint_url, access_key_id, secret_access_key } => {
                assert_eq!(endpoint_url, "http://localhost:9000");
                assert_eq!(access_key_id, "minio");
                assert!(secret_access_key.is_empty());
            }
            _ => panic!("expected custom endpoint credentials"),
        }
    }

    #[test]
    fn profiles_data_deserializes_without_active_profile_id() {
        let json = r#"{
            "profiles": {
                "profile-1": {
                    "id": "profile-1",
                    "name": "MinIO",
                    "credential_type": {
                        "type": "CustomEndpoint",
                        "endpoint_url": "http://localhost:9000",
                        "access_key_id": "minio"
                    },
                    "region": "us-east-1",
                    "is_default": true
                }
            }
        }"#;

        let data = ProfileManager::load_profiles_data(json).expect("profiles data should deserialize");
        assert_eq!(data.active_profile_id.as_deref(), Some("profile-1"));
        assert_eq!(data.profiles.len(), 1);
    }

    #[test]
    fn profiles_data_deserializes_from_legacy_array() {
        let json = r#"[
            {
                "id": "profile-1",
                "name": "Legacy",
                "credential_type": {
                    "type": "Manual",
                    "access_key_id": "AKIA123"
                },
                "region": "us-east-1",
                "is_default": false
            }
        ]"#;

        let data = ProfileManager::load_profiles_data(json).expect("legacy array should deserialize");
        assert_eq!(data.active_profile_id.as_deref(), Some("profile-1"));
        assert!(data.profiles.contains_key("profile-1"));
    }

    #[test]
    fn normalize_profiles_data_repairs_missing_ids_and_default_flag() {
        let mut profiles = HashMap::new();
        profiles.insert(
            "legacy-key".to_string(),
            Profile {
                id: String::new(),
                name: "Legacy".to_string(),
                credential_type: CredentialType::Environment,
                region: None,
                is_default: false,
                created_at: None,
                updated_at: None,
            },
        );

        let data = ProfileManager::normalize_profiles_data(super::ProfilesData {
            profiles,
            active_profile_id: None,
        });

        assert_eq!(data.profiles.len(), 1);
        assert_eq!(data.active_profile_id.as_deref(), Some("legacy-key"));
        let profile = data.profiles.get("legacy-key").expect("profile should exist");
        assert_eq!(profile.id, "legacy-key");
        assert!(profile.is_default);
    }
}
