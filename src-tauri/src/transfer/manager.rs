use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tauri::{AppHandle, Emitter};
use crate::credentials::Profile;
use crate::s3::S3ClientManager;
use super::{TransferJob, TransferStatus, TransferType, TransferEvent};
use aws_sdk_s3::primitives::ByteStream;
use tokio::io::AsyncWriteExt;
use tokio::fs::File;



// Define a safe shared state for the manager
pub struct TransferManager {
    jobs: Arc<RwLock<HashMap<String, TransferJob>>>,
    queue: Arc<Mutex<Vec<String>>>, // List of Job IDs
    abort_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
    concurrency_semaphore: Arc<tokio::sync::Semaphore>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl TransferManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            queue: Arc::new(Mutex::new(Vec::new())),
            abort_handles: Arc::new(RwLock::new(HashMap::new())),
            concurrency_semaphore: Arc::new(tokio::sync::Semaphore::new(5)),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        let mut handle = self.app_handle.write().await;
        *handle = Some(app_handle);
    }

    pub async fn add_job(&self, job: TransferJob) {
        {
            let mut jobs = self.jobs.write().await;
            jobs.insert(job.id.clone(), job.clone());
        }
        
        let mut queue = self.queue.lock().await;
        queue.push(job.id.clone());
        
        // Emit added event with full job data
        if let Some(app) = self.app_handle.read().await.as_ref() {
            let _ = app.emit("transfer-added", &job);
        }
        
        // Also emit initial status update
        self.emit_update(&job).await;
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
                    
                    // CRITICAL FIX: Abort the actual tokio task to stop Phantom I/O
                    let mut handles = self.abort_handles.write().await;
                    if let Some(handle) = handles.remove(id) {
                        handle.abort();
                        log::info!("Aborted job task: {}", id);
                    }
                    
                    drop(handles);
                    drop(jobs);
                    self.emit_update(&job_clone).await;
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

    async fn emit_update(&self, job: &TransferJob) {
        if let Some(app) = self.app_handle.read().await.as_ref() {
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
    
    // Process the queue using a worker pool that respects max concurrency
    pub async fn process_queue(self: Arc<Self>, s3_manager: Arc<RwLock<S3ClientManager>>, profile: Profile) {
        let manager = self.clone();
        
        tokio::spawn(async move {
            loop {
                // 1. Get next job from queue
                let next_id = {
                    let mut queue = manager.queue.lock().await;
                    if queue.is_empty() { break; }
                    queue.remove(0)
                };

                // 2. Wait for a slot in the concurrency limit
                let permit = match manager.concurrency_semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break, // Semaphore closed
                };

                // 3. Spawn the task
                let manager_inner = manager.clone();
                let s3_inner = s3_manager.clone();
                let profile_inner = profile.clone();
                let id_inner = next_id.clone();

                let handle = tokio::spawn(async move {
                    // Update status to InProgress
                    manager_inner.update_job_status(&id_inner, TransferStatus::InProgress).await;
                    
                    // Run the job
                    let job_opt = manager_inner.get_job(&id_inner).await;
                    if let Some(job) = job_opt {
                        match manager_inner.execute_job(&job, s3_inner, &profile_inner).await {
                            Ok(_) => {
                                // Double check if it was cancelled while we were working
                                if let Some(current_job) = manager_inner.get_job(&id_inner).await {
                                    if !matches!(current_job.status, TransferStatus::Cancelled) {
                                        manager_inner.update_job_status(&id_inner, TransferStatus::Completed).await;
                                    }
                                }
                            },
                            Err(e) => manager_inner.update_job_status(&id_inner, TransferStatus::Failed(e.to_string())).await,
                        }
                    }
                    
                    // Remove abort handle when done
                    let mut handles = manager_inner.abort_handles.write().await;
                    handles.remove(&id_inner);
                    
                    // Permit is dropped here, freeing a slot
                    drop(permit);
                });

                // 4. Store the abort handle so we can cancel it later
                let mut handles = manager.abort_handles.write().await;
                handles.insert(next_id, handle.abort_handle());
            }
        });
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
        if let Some(job) = self.get_job(id).await {
             self.emit_update(&job).await;
        }
    }
    
    async fn update_job_total_size(&self, id: &str, size: u64) {
        {
            let mut jobs = self.jobs.write().await;
            if let Some(job) = jobs.get_mut(id) {
                job.total_bytes = size;
            }
        }
        if let Some(job) = self.get_job(id).await {
            self.emit_update(&job).await;
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
            self.emit_update(&job).await;
        }
    }

    async fn execute_job(&self, job: &TransferJob, s3_manager: Arc<RwLock<S3ClientManager>>, profile: &Profile) -> crate::error::Result<()> {
        let client = {
            let mut s3 = s3_manager.write().await;
            let c = if let Some(ref region) = job.bucket_region {
                s3.get_client_for_region(profile, region).await?
            } else {
                s3.get_client(profile).await?
            };
            c.clone()
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

                 if let Ok(meta) = std::fs::metadata(&job.local_path) {
                     self.update_job_progress(&job.id, meta.len()).await;
                 }
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
                let mut last_update = std::time::Instant::now();
                

                while let Some(bytes) = output.body.try_next().await
                    .map_err(|e| crate::error::AppError::S3Error(e.to_string()))? 
                {
                    file.write_all(&bytes).await
                         .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
                    
                    downloaded += bytes.len() as u64;
                    
                    if last_update.elapsed() >= std::time::Duration::from_millis(100) {
                        self.update_job_progress(&job.id, downloaded).await;
                        last_update = std::time::Instant::now();
                    }
                }
                
                self.update_job_progress(&job.id, downloaded).await;
                if job.total_bytes == 0 {
                    self.update_job_total_size(&job.id, downloaded).await;
                }
            }
        }
        
        Ok(())
    }
}
