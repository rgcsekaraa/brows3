pub mod download;
pub mod manager;
pub mod remote;
mod speed;
pub mod sync;

pub use manager::TransferManager;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

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
    pub profile_id: String,
    pub bucket: String,
    pub bucket_region: Option<String>,
    pub key: String,
    pub local_path: String,
    #[serde(default)]
    pub sync_source: Option<sync::SyncSource>,
    #[serde(default)]
    pub remote_source: Option<remote::RemoteSource>,
    #[serde(default)]
    pub restore_guard: Option<crate::s3::versions::RestoreGuard>,
    #[serde(skip)]
    pub download_destination: Option<std::sync::Arc<download::DownloadDestination>>,
    pub transfer_type: TransferType,
    pub status: TransferStatus,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    #[serde(default)]
    pub bytes_per_second: f64,
    #[serde(skip)]
    pub progress: std::sync::Arc<std::sync::Mutex<speed::Progress>>,
    pub created_at: i64,          // Timestamp (ms)
    pub finished_at: Option<i64>, // Timestamp (ms)
    // Grouping fields
    pub parent_group_id: Option<String>,
    pub group_name: Option<String>,
    pub is_group_root: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferEvent {
    pub job_id: String,
    pub bytes_per_second: f64,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub status: TransferStatus,
    pub finished_at: Option<i64>,
}

impl TransferJob {
    pub fn destination_etag(&self) -> Option<&str> {
        match &self.restore_guard {
            Some(guard) => guard.current_etag.as_deref(),
            None => self
                .sync_source
                .as_ref()
                .and_then(|s| s.expected_etag.as_deref()),
        }
    }
    pub fn new(
        transfer_type: TransferType,
        profile_id: String,
        bucket: String,
        bucket_region: Option<String>,
        key: String,
        local_path: PathBuf,
        total_bytes: u64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            profile_id,
            bucket,
            bucket_region,
            key,
            local_path: local_path.to_string_lossy().to_string(),
            sync_source: None,
            remote_source: None,
            restore_guard: None,
            download_destination: None,
            transfer_type,
            status: TransferStatus::Pending,
            total_bytes,
            processed_bytes: 0,
            bytes_per_second: 0.0,
            progress: Default::default(),
            created_at: Utc::now().timestamp_millis(),
            finished_at: None,
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

#[cfg(test)]
mod tests {
    use super::{TransferJob, TransferType};
    use std::path::PathBuf;

    #[test]
    fn transfer_job_keeps_the_profile_that_queued_it() {
        let job = TransferJob::new(
            TransferType::Download,
            "profile-a".to_string(),
            "bucket".to_string(),
            Some("ap-southeast-2".to_string()),
            "folder/file.txt".to_string(),
            PathBuf::from("/tmp/file.txt"),
            42,
        );

        assert_eq!(job.profile_id, "profile-a");
    }
}
