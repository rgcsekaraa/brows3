pub mod manager;

pub use manager::TransferManager;

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransferType {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransferStatus {
    Pending,
    InProgress,
    Completed,
    Failed(String),
    Paused,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferJob {
    pub id: String,
    pub bucket: String,
    pub bucket_region: Option<String>,
    pub key: String,
    pub local_path: String,
    pub transfer_type: TransferType,
    pub status: TransferStatus,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    pub created_at: i64, // Timestamp
    // Grouping fields
    pub parent_group_id: Option<String>,
    pub group_name: Option<String>,
    pub is_group_root: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferEvent {
    pub job_id: String,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub status: TransferStatus,
}

impl TransferJob {
    pub fn new(
        transfer_type: TransferType,
        bucket: String,
        bucket_region: Option<String>,
        key: String,
        local_path: PathBuf,
        total_bytes: u64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            bucket,
            bucket_region,
            key,
            local_path: local_path.to_string_lossy().to_string(),
            transfer_type,
            status: TransferStatus::Pending,
            total_bytes,
            processed_bytes: 0,
            created_at: Utc::now().timestamp(),
            parent_group_id: None,
            group_name: None,
            is_group_root: false,
        }
    }

    pub fn with_group(mut self, group_id: String, name: String) -> Self {
        self.parent_group_id = Some(group_id);
        self.group_name = Some(name);
        self
    }
}
