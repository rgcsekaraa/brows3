use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tauri::{AppHandle, Emitter};
use crate::credentials::Profile;
use crate::s3::S3ClientManager;
use super::{TransferJob, TransferStatus, TransferType, TransferEvent};
// chrono::Utc removed - not needed
use aws_sdk_s3::primitives::ByteStream;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

// Define a safe shared state for the manager
pub struct TransferManager {
    jobs: Arc<RwLock<HashMap<String, TransferJob>>>,
    queue: Arc<Mutex<Vec<String>>>, // List of Job IDs
    app_handle: Option<AppHandle>,
}

impl TransferManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            queue: Arc::new(Mutex::new(Vec::new())),
            app_handle: None,
        }
    }

    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    pub async fn add_job(&self, job: TransferJob) {
        {
            let mut jobs = self.jobs.write().await;
            jobs.insert(job.id.clone(), job.clone());
        }
        
        let mut queue = self.queue.lock().await;
        queue.push(job.id.clone());
        
        // Emit added event
        if self.app_handle.is_some() {
            // Re-map to event to include finished_at? Or just emit job?
            // Job has changed, need to map it if we use strict types
            self.emit_update(&job);
        }
        
        // Emit initial status update
        self.emit_update(&job);
    }
    
    pub async fn get_job(&self, id: &str) -> Option<TransferJob> {
        let jobs = self.jobs.read().await;
        jobs.get(id).cloned()
    }
    
    pub async fn list_jobs(&self) -> Vec<TransferJob> {
        let jobs = self.jobs.read().await;
        let mut list: Vec<TransferJob> = jobs.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at)); // Newest first
        list
    }
    
    /// Cancel a transfer job
    pub async fn cancel_job(&self, id: &str) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(id) {
            // Can only cancel Pending or InProgress jobs
            match job.status {
                TransferStatus::Pending | TransferStatus::InProgress => {
                    job.status = TransferStatus::Cancelled;
                    let job_clone = job.clone();
                    drop(jobs);
                    self.emit_update(&job_clone);
                    return true;
                }
                _ => return false,
            }
        }
        false
    }
    
    /// Remove a specific transfer job from history
    pub async fn remove_job(&self, id: &str) -> bool {
        let mut jobs = self.jobs.write().await;
        jobs.remove(id).is_some()
    }
    
    /// Clear all completed/failed/cancelled transfers
    pub async fn clear_completed(&self) -> usize {
        let mut jobs = self.jobs.write().await;
        let initial_count = jobs.len();
        jobs.retain(|_, job| {
            matches!(job.status, TransferStatus::Pending | TransferStatus::InProgress)
        });
        initial_count - jobs.len()
    }
    
    /// Retry a failed transfer
    pub async fn retry_job(&self, id: &str) -> Option<String> {
        let jobs = self.jobs.read().await;
        if let Some(job) = jobs.get(id) {
            // Can only retry Failed or Cancelled jobs
            match &job.status {
                TransferStatus::Failed(_) | TransferStatus::Cancelled => {
                    // Create a new job with same details
                    let mut new_job = TransferJob::new(
                        job.transfer_type.clone(),
                        job.bucket.clone(),
                        job.bucket_region.clone(),
                        job.key.clone(),
                        std::path::PathBuf::from(&job.local_path),
                        job.total_bytes,
                    );
                    
                    // Preserve grouping info
                    new_job.parent_group_id = job.parent_group_id.clone();
                    new_job.group_name = job.group_name.clone();
                    new_job.is_group_root = job.is_group_root;
                    
                    let new_id = new_job.id.clone();
                    drop(jobs);
                    
                    // Add the new job to queue
                    self.add_job(new_job).await;
                    return Some(new_id);
                }
                _ => return None,
            }
        }
        None
    }

    fn emit_update(&self, job: &TransferJob) {
        if let Some(app) = &self.app_handle {
            let event = TransferEvent {
                job_id: job.id.clone(),
                processed_bytes: job.processed_bytes,
                total_bytes: job.total_bytes,
                status: job.status.clone(),
                finished_at: job.finished_at,
            };
            let _ = app.emit("transfer-update", event);
        }
    }
    
    // Process the queue - this would ideally be a background loop
    // For MVP, we'll trigger processing when a job is added
    pub async fn process_queue(&self, s3_manager: Arc<RwLock<S3ClientManager>>, profile: &Profile) {
        // Simplified processing: Pick one queued job
        let next_id = {
            let mut queue = self.queue.lock().await;
            if queue.is_empty() { return; }
            queue.remove(0)
        };

        // Update status to InProgress
        self.update_job_status(&next_id, TransferStatus::InProgress).await;
        
        // Run the job
        let job_opt = self.get_job(&next_id).await;
        if let Some(job) = job_opt {
             match self.execute_job(&job, s3_manager, profile).await {
                 Ok(_) => self.update_job_status(&next_id, TransferStatus::Completed).await,
                 Err(e) => self.update_job_status(&next_id, TransferStatus::Failed(e.to_string())).await,
             }
        }
    }
    
    async fn update_job_status(&self, id: &str, status: TransferStatus) {
        {
            let mut jobs = self.jobs.write().await;
            if let Some(job) = jobs.get_mut(id) {
                job.status = status.clone();
                // If final status, set finished_at
                match status {
                    TransferStatus::Completed | TransferStatus::Failed(_) | TransferStatus::Cancelled => {
                        job.finished_at = Some(chrono::Utc::now().timestamp_millis());
                    }
                    _ => {}
                }
            }
        }
        // Re-read or just emit from what we had? The previous code emitted from the ref.
        // Let's refetch to emit to be safe/clean or just emit inside scope.
        // Emitting inside scope is fine.
        if let Some(job) = self.get_job(id).await {
             self.emit_update(&job);
        }
    }
    
    async fn update_job_progress(&self, id: &str, processed: u64) {
        {
            let mut jobs = self.jobs.write().await;
            if let Some(job) = jobs.get_mut(id) {
                job.processed_bytes = processed;
            }
        }
        if let Some(job) = self.get_job(id).await {
            self.emit_update(&job);
        }
    }

    async fn execute_job(&self, job: &TransferJob, s3_manager: Arc<RwLock<S3ClientManager>>, profile: &Profile) -> crate::error::Result<()> {
        let mut s3 = s3_manager.write().await;
        
        let client = if let Some(ref region) = job.bucket_region {
            s3.get_client_for_region(profile, region).await?
        } else {
            s3.get_client(profile).await?
        };
        
        match job.transfer_type {
            TransferType::Upload => {
                 let body = ByteStream::from_path(&job.local_path).await
                    .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
                
                 client.put_object()
                    .bucket(&job.bucket)
                    .key(&job.key)
                    .body(body)
                    .send()
                    .await
                    .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;
            }
            TransferType::Download => {
                let mut output = client.get_object()
                    .bucket(&job.bucket)
                    .key(&job.key)
                    .send()
                    .await
                    .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

                if let Some(parent) = std::path::Path::new(&job.local_path).parent() {
                    tokio::fs::create_dir_all(parent).await
                        .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
                }

                let mut file = File::create(&job.local_path).await
                    .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;

                let mut downloaded: u64 = 0;
                
                // Emitting progress implies we need to intercept the stream
                // For MVP, chunking it manually or using a wrapper
                while let Some(bytes) = output.body.try_next().await
                    .map_err(|e| crate::error::AppError::S3Error(e.to_string()))? 
                {
                    file.write_all(&bytes).await
                         .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
                    
                    downloaded += bytes.len() as u64;
                    // Emit progress periodically? For now, every chunk
                    // In production, throttle this to avoid event spam
                    self.update_job_progress(&job.id, downloaded).await;
                }
            }
        }
        
        Ok(())
    }
}
