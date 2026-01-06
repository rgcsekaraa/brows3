use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Serialize, Deserialize)]
pub enum AppError {
    #[error("Profile not found: {0}")]
    ProfileNotFound(String),
    
    #[error("Profile already exists: {0}")]
    ProfileExists(String),
    
    #[error("Invalid credentials: {0}")]
    InvalidCredentials(String),
    
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    
    #[error("S3 error: {0}")]
    S3Error(String),
    #[error("Access Denied: {0}")]
    AccessDenied(String),
    
    #[error("Keychain error: {0}")]
    KeychainError(String),
    
    #[error("IO error: {0}")]
    IoError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("Configuration error: {0}")]
    ConfigError(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::SerializationError(err.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        AppError::KeychainError(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
