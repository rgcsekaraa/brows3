use super::{TransferEvent, TransferJob, TransferStatus, TransferType};
use crate::credentials::{Profile, ProfileManager};
use crate::s3::{
    plan_multipart_upload, MultipartUploadGuard, S3ClientManager, MULTIPART_UPLOAD_THRESHOLD,
};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::Client;
use aws_smithy_types::byte_stream::Length;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Notify, RwLock};

// Define a safe shared state for the manager
pub struct TransferManager {
    jobs: Arc<RwLock<HashMap<String, TransferJob>>>,
    queue: Arc<Mutex<Vec<String>>>, // List of Job IDs
    abort_handles: Arc<RwLock<HashMap<String, tokio::task::AbortHandle>>>,
    max_concurrency: Arc<AtomicUsize>,
    active_count: Arc<AtomicUsize>,
    slot_notify: Arc<Notify>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

struct ActiveSlotGuard {
    active_count: Arc<AtomicUsize>,
    slot_notify: Arc<Notify>,
}

impl Drop for ActiveSlotGuard {
    fn drop(&mut self) {
        self.active_count.fetch_sub(1, Ordering::AcqRel);
        self.slot_notify.notify_waiters();
    }
}

impl Default for TransferManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TransferManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            queue: Arc::new(Mutex::new(Vec::new())),
            abort_handles: Arc::new(RwLock::new(HashMap::new())),
            max_concurrency: Arc::new(AtomicUsize::new(5)),
            active_count: Arc::new(AtomicUsize::new(0)),
            slot_notify: Arc::new(Notify::new()),
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

    pub fn set_max_concurrency(&self, max: usize) {
        let clamped = max.clamp(1, 20);
        self.max_concurrency.store(clamped, Ordering::Release);
        self.slot_notify.notify_waiters();
    }

    pub async fn get_job(&self, id: &str) -> Option<TransferJob> {
        let jobs = self.jobs.read().await;
        jobs.get(id).cloned()
    }

    pub async fn list_jobs(&self) -> Vec<TransferJob> {
        let jobs = self.jobs.read().await;
        let mut list: Vec<TransferJob> = jobs.values().cloned().collect();
        list.sort_by_key(|job| std::cmp::Reverse(job.created_at)); // Newest first
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
                    let needs_graceful_cleanup = Self::is_multipart_upload_job(job);

                    {
                        let mut queue = self.queue.lock().await;
                        queue.retain(|job_id| job_id != id);
                    }

                    // Multipart uploads finish their current bounded part and
                    // abort by upload ID. Other transfers can stop immediately.
                    let mut handles = self.abort_handles.write().await;
                    if let Some(handle) = handles.remove(id) {
                        if needs_graceful_cleanup {
                            log::info!(
                                "Cancellation requested for multipart job {}; waiting for the current part so the server-side upload can be aborted cleanly",
                                id
                            );
                        } else {
                            handle.abort();
                            log::info!("Aborted job task: {}", id);
                        }
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
        let needs_graceful_cleanup = self
            .get_job(id)
            .await
            .as_ref()
            .is_some_and(Self::is_multipart_upload_job);

        {
            let mut queue = self.queue.lock().await;
            queue.retain(|job_id| job_id != id);
        }

        let mut handles = self.abort_handles.write().await;
        if let Some(handle) = handles.remove(id) {
            if !needs_graceful_cleanup {
                handle.abort();
            }
        }
        drop(handles);

        let mut jobs = self.jobs.write().await;
        jobs.remove(id).is_some()
    }

    /// Clear all completed/failed/cancelled transfers
    pub async fn clear_completed(&self) -> usize {
        let mut jobs = self.jobs.write().await;
        let initial_count = jobs.len();
        jobs.retain(|_, job| {
            matches!(
                job.status,
                TransferStatus::Pending | TransferStatus::InProgress
            )
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
                        job.profile_id.clone(),
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

    fn is_multipart_upload_job(job: &TransferJob) -> bool {
        if !matches!(job.transfer_type, TransferType::Upload) {
            return false;
        }

        job.total_bytes >= MULTIPART_UPLOAD_THRESHOLD
            || std::fs::metadata(&job.local_path)
                .map(|metadata| metadata.len() >= MULTIPART_UPLOAD_THRESHOLD)
                .unwrap_or(false)
    }

    async fn ensure_multipart_job_active(&self, id: &str) -> crate::error::Result<()> {
        match self.get_job(id).await.map(|job| job.status) {
            Some(TransferStatus::InProgress) => Ok(()),
            Some(TransferStatus::Cancelled) | None => Err(crate::error::AppError::ConfigError(
                "Multipart upload was cancelled".to_string(),
            )),
            Some(status) => Err(crate::error::AppError::ConfigError(format!(
                "Multipart upload stopped because the transfer is no longer active ({status:?})"
            ))),
        }
    }

    async fn acquire_slot(&self) -> ActiveSlotGuard {
        loop {
            let max = self.max_concurrency.load(Ordering::Acquire).max(1);
            let active = self.active_count.load(Ordering::Acquire);

            if active < max {
                if self
                    .active_count
                    .compare_exchange_weak(active, active + 1, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    return ActiveSlotGuard {
                        active_count: self.active_count.clone(),
                        slot_notify: self.slot_notify.clone(),
                    };
                }
                continue;
            }

            self.slot_notify.notified().await;
        }
    }

    // Process the queue using a worker pool that respects max concurrency
    pub async fn process_queue(
        self: Arc<Self>,
        s3_manager: Arc<RwLock<S3ClientManager>>,
        profile_manager: Arc<RwLock<ProfileManager>>,
    ) {
        let manager = self.clone();

        tokio::spawn(async move {
            loop {
                // 1. Get next job from queue
                let next_id = {
                    let mut queue = manager.queue.lock().await;
                    if queue.is_empty() {
                        break;
                    }
                    queue.remove(0)
                };

                // 2. Wait for a slot in the concurrency limit
                let slot_guard = manager.acquire_slot().await;

                // 3. Spawn the task
                let manager_inner = manager.clone();
                let s3_inner = s3_manager.clone();
                let profiles_inner = profile_manager.clone();
                let id_inner = next_id.clone();

                let handle = tokio::spawn(async move {
                    let _slot_guard = slot_guard;
                    let should_run = matches!(
                        manager_inner.get_job(&id_inner).await.map(|job| job.status),
                        Some(TransferStatus::Pending)
                    );

                    if !should_run {
                        return;
                    }

                    // Update status to InProgress
                    manager_inner
                        .update_job_status(&id_inner, TransferStatus::InProgress)
                        .await;

                    // Run the job
                    let job_opt = manager_inner.get_job(&id_inner).await;
                    if let Some(job) = job_opt {
                        let profile_result = {
                            let profiles = profiles_inner.read().await;
                            profiles.get_profile(&job.profile_id).await
                        };

                        let result = match profile_result {
                            Ok(profile) => {
                                manager_inner.execute_job(&job, s3_inner, &profile).await
                            }
                            Err(err) => Err(err),
                        };

                        match result {
                            Ok(_) => {
                                // Double check if it was cancelled while we were working
                                if let Some(current_job) = manager_inner.get_job(&id_inner).await {
                                    if !matches!(current_job.status, TransferStatus::Cancelled) {
                                        manager_inner
                                            .update_job_status(&id_inner, TransferStatus::Completed)
                                            .await;
                                    }
                                }
                            }
                            Err(e) => {
                                let was_cancelled = matches!(
                                    manager_inner.get_job(&id_inner).await.map(|job| job.status),
                                    Some(TransferStatus::Cancelled) | None
                                );
                                if !was_cancelled {
                                    manager_inner
                                        .update_job_status(
                                            &id_inner,
                                            TransferStatus::Failed(e.to_string()),
                                        )
                                        .await;
                                }
                            }
                        }
                    }

                    // Remove abort handle when done
                    let mut handles = manager_inner.abort_handles.write().await;
                    handles.remove(&id_inner);
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
                    TransferStatus::Completed
                    | TransferStatus::Failed(_)
                    | TransferStatus::Cancelled => {
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

    async fn upload_file(
        &self,
        client: &Client,
        job: &TransferJob,
        content_type: &str,
    ) -> crate::error::Result<()> {
        let metadata = tokio::fs::metadata(&job.local_path)
            .await
            .map_err(|error| {
                crate::error::AppError::IoError(format!(
                    "Cannot read upload file '{}': {error}",
                    job.local_path
                ))
            })?;
        if !metadata.is_file() {
            return Err(crate::error::AppError::IoError(format!(
                "Upload source '{}' is not a regular file",
                job.local_path
            )));
        }

        let file_size = metadata.len();
        if job.total_bytes != file_size {
            self.update_job_total_size(&job.id, file_size).await;
        }

        if file_size < MULTIPART_UPLOAD_THRESHOLD {
            let body = ByteStream::from_path(&job.local_path)
                .await
                .map_err(|error| crate::error::AppError::IoError(error.to_string()))?;
            client
                .put_object()
                .bucket(&job.bucket)
                .key(&job.key)
                .content_type(content_type)
                .body(body)
                .send()
                .await
                .map_err(|error| {
                    crate::error::AppError::S3Error(format!(
                        "Single-part upload failed for s3://{}/{}: {error}",
                        job.bucket, job.key
                    ))
                })?;
            self.update_job_progress(&job.id, file_size).await;
            return Ok(());
        }

        self.multipart_upload_file(client, job, content_type, file_size)
            .await
    }

    async fn multipart_upload_file(
        &self,
        client: &Client,
        job: &TransferJob,
        content_type: &str,
        file_size: u64,
    ) -> crate::error::Result<()> {
        self.ensure_multipart_job_active(&job.id).await?;
        let plan = plan_multipart_upload(file_size)?;
        let created = client
            .create_multipart_upload()
            .bucket(&job.bucket)
            .key(&job.key)
            .content_type(content_type)
            .send()
            .await
            .map_err(|error| {
                crate::error::AppError::S3Error(format!(
                    "Could not start multipart upload for s3://{}/{}: {error}",
                    job.bucket, job.key
                ))
            })?;
        let upload_id = created.upload_id().ok_or_else(|| {
            crate::error::AppError::S3Error(format!(
                "S3 did not return an upload ID for s3://{}/{}",
                job.bucket, job.key
            ))
        })?;
        let mut guard =
            MultipartUploadGuard::new(client.clone(), &job.bucket, &job.key, upload_id.to_string());

        let upload_result: crate::error::Result<()> = async {
            self.ensure_multipart_job_active(&job.id).await?;
            let mut completed_parts = Vec::with_capacity(plan.parts.len());
            let mut uploaded_bytes = 0_u64;

            for part in &plan.parts {
                self.ensure_multipart_job_active(&job.id).await?;
                let body = ByteStream::read_from()
                    .path(&job.local_path)
                    .offset(part.offset)
                    .length(Length::Exact(part.length))
                    .buffer_size(1024 * 1024)
                    .build()
                    .await
                    .map_err(|error| {
                        crate::error::AppError::IoError(format!(
                            "Could not read part {} from '{}': {error}",
                            part.number, job.local_path
                        ))
                    })?;

                let output = client
                    .upload_part()
                    .bucket(&job.bucket)
                    .key(&job.key)
                    .upload_id(guard.upload_id())
                    .part_number(part.number)
                    .content_length(part.length as i64)
                    .body(body)
                    .send()
                    .await
                    .map_err(|error| {
                        crate::error::AppError::S3Error(format!(
                            "Multipart upload failed at part {} of {} for s3://{}/{}: {error}",
                            part.number,
                            plan.parts.len(),
                            job.bucket,
                            job.key
                        ))
                    })?;
                self.ensure_multipart_job_active(&job.id).await?;
                let e_tag = output.e_tag().ok_or_else(|| {
                    crate::error::AppError::S3Error(format!(
                        "S3 did not return an ETag for multipart part {} of s3://{}/{}",
                        part.number, job.bucket, job.key
                    ))
                })?;

                completed_parts.push(
                    CompletedPart::builder()
                        .part_number(part.number)
                        .e_tag(e_tag)
                        .build(),
                );
                uploaded_bytes += part.length;
                self.update_job_progress(&job.id, uploaded_bytes).await;
            }

            self.ensure_multipart_job_active(&job.id).await?;
            let completed_upload = CompletedMultipartUpload::builder()
                .set_parts(Some(completed_parts))
                .build();
            client
                .complete_multipart_upload()
                .bucket(&job.bucket)
                .key(&job.key)
                .upload_id(guard.upload_id())
                .multipart_upload(completed_upload)
                .send()
                .await
                .map_err(|error| {
                    crate::error::AppError::S3Error(format!(
                        "Could not complete multipart upload for s3://{}/{}: {error}",
                        job.bucket, job.key
                    ))
                })?;

            Ok(())
        }
        .await;

        if let Err(error) = upload_result {
            if let Err(abort_error) = guard.abort().await {
                log::error!("{}", abort_error);
            }
            return Err(error);
        }

        guard.disarm();
        Ok(())
    }

    async fn execute_job(
        &self,
        job: &TransferJob,
        s3_manager: Arc<RwLock<S3ClientManager>>,
        profile: &Profile,
    ) -> crate::error::Result<()> {
        let resolved_region = {
            let s3 = s3_manager.read().await;
            s3.get_bucket_region(&job.bucket)
        }
        .or(job.bucket_region.clone());

        let client = {
            let mut s3 = s3_manager.write().await;
            let c = if let Some(ref region) = resolved_region {
                s3.get_client_for_region(profile, region).await?
            } else {
                s3.get_client(profile).await?
            };
            c.clone()
        };

        let detect_region = async {
            let retry_client = {
                let mut s3 = s3_manager.write().await;
                s3.get_client(profile).await?.clone()
            };

            let new_region = crate::s3::get_bucket_region(&retry_client, &job.bucket)
                .await
                .ok();
            if let Some(ref region) = new_region {
                let mut s3 = s3_manager.write().await;
                s3.set_bucket_region(&job.bucket, region.clone());
            }
            Ok::<Option<String>, crate::error::AppError>(new_region)
        };

        match job.transfer_type {
            TransferType::Upload => {
                let content_type = crate::s3::infer_content_type(&job.key);
                if let Err(first_error) = self.upload_file(&client, job, &content_type).await {
                    if !matches!(
                        self.get_job(&job.id).await.map(|current| current.status),
                        Some(TransferStatus::InProgress)
                    ) {
                        return Err(first_error);
                    }
                    log::warn!(
                        "Upload failed using configured region {:?}; checking the bucket region once before returning the error: {}",
                        resolved_region,
                        first_error
                    );

                    let detected_region = detect_region.await?;
                    let retry_region = detected_region
                        .filter(|region| resolved_region.as_deref() != Some(region.as_str()));
                    if let Some(new_region) = retry_region {
                        let retry_client = {
                            let mut s3 = s3_manager.write().await;
                            s3.get_client_for_region(profile, &new_region)
                                .await?
                                .clone()
                        };
                        self.update_job_progress(&job.id, 0).await;
                        self.upload_file(&retry_client, job, &content_type)
                            .await
                            .map_err(|error| {
                                crate::error::AppError::S3Error(format!(
                                    "Upload retry in detected bucket region '{new_region}' failed: {error}"
                                ))
                            })?;
                    } else {
                        return Err(first_error);
                    }
                }

                {
                    let mut s3 = s3_manager.write().await;
                    s3.remove_bucket_cache(&profile.id, &job.bucket);
                }
            }
            TransferType::Download => {
                let result = client
                    .get_object()
                    .bucket(&job.bucket)
                    .key(&job.key)
                    .send()
                    .await;

                let mut output = match result {
                    Ok(output) => output,
                    Err(err) => {
                        log::warn!(
                            "download transfer failed, attempting region discovery: {}",
                            err
                        );

                        if let Some(new_region) = detect_region.await? {
                            let retry_client = {
                                let mut s3 = s3_manager.write().await;
                                s3.get_client_for_region(profile, &new_region)
                                    .await?
                                    .clone()
                            };

                            retry_client
                                .get_object()
                                .bucket(&job.bucket)
                                .key(&job.key)
                                .send()
                                .await
                                .map_err(|e| {
                                    crate::error::AppError::S3Error(format!(
                                        "Retry download failed: {}",
                                        e
                                    ))
                                })?
                        } else {
                            return Err(crate::error::AppError::S3Error(err.to_string()));
                        }
                    }
                };

                if let Some(parent) = std::path::Path::new(&job.local_path).parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
                }

                let mut file = File::create(&job.local_path)
                    .await
                    .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;

                let mut downloaded: u64 = 0;
                let mut last_update = std::time::Instant::now();

                while let Some(bytes) = output
                    .body
                    .try_next()
                    .await
                    .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?
                {
                    file.write_all(&bytes)
                        .await
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

#[cfg(test)]
mod tests {
    use super::TransferManager;
    use crate::credentials::{CredentialType, Profile};
    use crate::transfer::{TransferJob, TransferStatus, TransferType};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    /// Run with BROWS3_S3_TEST_ENDPOINT=http://127.0.0.1:<port> against MinIO.
    /// The sparse 129 MiB source crosses the production multipart threshold
    /// and the default 128 MiB part size.
    #[tokio::test]
    #[ignore = "requires an S3-compatible integration-test endpoint"]
    async fn multipart_upload_round_trips_against_s3_endpoint() {
        let endpoint = std::env::var("BROWS3_S3_TEST_ENDPOINT")
            .expect("BROWS3_S3_TEST_ENDPOINT must identify the test S3 endpoint");
        let access_key =
            std::env::var("BROWS3_S3_TEST_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into());
        let secret_key =
            std::env::var("BROWS3_S3_TEST_SECRET_KEY").unwrap_or_else(|_| "minioadmin".into());
        let profile = Profile::new(
            "multipart-integration".to_string(),
            CredentialType::CustomEndpoint {
                endpoint_url: endpoint,
                access_key_id: access_key,
                secret_access_key: secret_key,
            },
            Some("us-east-1".to_string()),
        );
        let sdk_config = crate::s3::client::load_sdk_config(&profile, None).await;
        let client = crate::s3::client::client_from_sdk_config(&sdk_config, &profile);
        let bucket = format!("brows3-multipart-test-{}", uuid::Uuid::new_v4().simple());
        client
            .create_bucket()
            .bucket(&bucket)
            .send()
            .await
            .expect("test bucket should be created");

        let path: PathBuf = std::env::temp_dir().join(format!(
            "brows3-multipart-{}.bin",
            uuid::Uuid::new_v4().simple()
        ));
        let file = tokio::fs::File::create(&path)
            .await
            .expect("sparse test file should be created");
        let size = 129 * 1024 * 1024;
        file.set_len(size)
            .await
            .expect("sparse test file should be sized");
        drop(file);

        let manager = Arc::new(TransferManager::new());
        let job = TransferJob::new(
            TransferType::Upload,
            profile.id.clone(),
            bucket.clone(),
            profile.region.clone(),
            "large/test.bin".to_string(),
            path.clone(),
            size,
        );
        manager.add_job(job.clone()).await;
        manager
            .update_job_status(&job.id, TransferStatus::InProgress)
            .await;
        manager
            .upload_file(&client, &job, "application/octet-stream")
            .await
            .expect("multipart upload should complete");

        let head = client
            .head_object()
            .bucket(&bucket)
            .key(&job.key)
            .send()
            .await
            .expect("uploaded object should be readable");
        assert_eq!(head.content_length(), Some(size as i64));
        assert_eq!(head.content_type(), Some("application/octet-stream"));
        assert!(head.e_tag().is_some_and(|e_tag| e_tag.contains('-')));

        let incomplete = client
            .list_multipart_uploads()
            .bucket(&bucket)
            .send()
            .await
            .expect("multipart uploads should be listable");
        assert!(incomplete.uploads().is_empty());

        let cancel_path: PathBuf = std::env::temp_dir().join(format!(
            "brows3-multipart-cancel-{}.bin",
            uuid::Uuid::new_v4().simple()
        ));
        let cancel_file = tokio::fs::File::create(&cancel_path)
            .await
            .expect("sparse cancellation file should be created");
        let cancel_size = 2 * 1024 * 1024 * 1024;
        cancel_file
            .set_len(cancel_size)
            .await
            .expect("sparse cancellation file should be sized");
        drop(cancel_file);
        let cancel_job = TransferJob::new(
            TransferType::Upload,
            profile.id.clone(),
            bucket.clone(),
            profile.region.clone(),
            "large/cancelled.bin".to_string(),
            cancel_path.clone(),
            cancel_size,
        );
        manager.add_job(cancel_job.clone()).await;
        manager
            .update_job_status(&cancel_job.id, TransferStatus::InProgress)
            .await;

        let upload_task = {
            let task_manager = manager.clone();
            let task_client = client.clone();
            let task_job = cancel_job.clone();
            tokio::spawn(async move {
                task_manager
                    .multipart_upload_file(
                        &task_client,
                        &task_job,
                        "application/octet-stream",
                        cancel_size,
                    )
                    .await
            })
        };

        let mut upload_started = false;
        for _ in 0..100 {
            let active = client
                .list_multipart_uploads()
                .bucket(&bucket)
                .send()
                .await
                .expect("multipart uploads should be listable");
            if !active.uploads().is_empty() {
                upload_started = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(upload_started, "test multipart upload should start");
        assert!(manager.cancel_job(&cancel_job.id).await);
        let cancelled = tokio::time::timeout(Duration::from_secs(30), upload_task)
            .await
            .expect("cancelled multipart upload should finish cleanup")
            .expect("multipart task should not panic");
        assert!(cancelled.is_err());
        let incomplete = client
            .list_multipart_uploads()
            .bucket(&bucket)
            .send()
            .await
            .expect("multipart uploads should be listable after cancellation");
        assert!(incomplete.uploads().is_empty());
        assert!(client
            .head_object()
            .bucket(&bucket)
            .key(&cancel_job.key)
            .send()
            .await
            .is_err());

        client
            .delete_object()
            .bucket(&bucket)
            .key(&job.key)
            .send()
            .await
            .expect("test object should be deleted");
        client
            .delete_bucket()
            .bucket(&bucket)
            .send()
            .await
            .expect("test bucket should be deleted");
        tokio::fs::remove_file(path)
            .await
            .expect("sparse test file should be deleted");
        tokio::fs::remove_file(cancel_path)
            .await
            .expect("sparse cancellation file should be deleted");
    }
}
