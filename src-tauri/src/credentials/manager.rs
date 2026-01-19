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
        #[serde(skip_serializing)]
        secret_access_key: String,
    },
    
    /// Custom S3-compatible endpoint (MinIO, Wasabi, etc.)
    CustomEndpoint {
        endpoint_url: String,
        access_key_id: String,
        #[serde(skip_serializing)]
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

#[derive(Debug, Serialize, Deserialize)]
struct ProfilesData {
    profiles: HashMap<String, Profile>,
    active_profile_id: Option<String>,
}

impl Default for ProfilesData {
    fn default() -> Self {
        Self {
            profiles: HashMap::new(),
            active_profile_id: None,
        }
    }
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
            match serde_json::from_str(&content) {
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
        
        Ok(Self {
            config_dir,
            data,
            keychain: super::KeychainStorage::new("brows3"),
        })
    }
    
    fn save(&self) -> Result<()> {
        let profiles_path = self.config_dir.join(PROFILES_FILE);
        let temp_path = profiles_path.with_extension("tmp");
        
        log::info!("Saving profiles atomically to {:?}", profiles_path);
        
        // 1. Write to temp file
        let content = serde_json::to_string_pretty(&self.data)?;
        std::fs::write(&temp_path, content)?;
        
        // 2. Rename to final destination (atomic on most OSs)
        std::fs::rename(temp_path, profiles_path)?;
        
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
        self.save()?;
        
        Ok(profile)
    }
    
    pub async fn update_profile(&mut self, id: &str, mut profile: Profile) -> Result<Profile> {
        if !self.data.profiles.contains_key(id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        
        profile.id = id.to_string();
        
        // Update secret in keychain if needed
        self.store_secret(&profile)?;
        
        profile.updated_at = Some(chrono::Utc::now());
        
        self.data.profiles.insert(id.to_string(), profile.clone());
        self.save()?;
        
        Ok(profile)
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
        
        self.save()?;
        Ok(())
    }
    
    pub async fn set_active_profile(&mut self, id: &str) -> Result<()> {
        if !self.data.profiles.contains_key(id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        
        self.data.active_profile_id = Some(id.to_string());
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
