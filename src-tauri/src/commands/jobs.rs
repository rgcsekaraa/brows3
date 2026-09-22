//! Durable, opt-in, in-process local-folder sync jobs. No background service or deletes.
use super::{profiles::ProfileState, transfer::TransferState};
use crate::{
    error::{AppError, Result},
    s3::S3State,
    transfer::{
        controls::{validate_bandwidth, Filters, SyncOptions},
        sync, TransferJob, TransferStatus, TransferType,
    },
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

fn invalid(message: &str) -> AppError {
    AppError::ConfigError(message.into())
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct JobConfig {
    pub name: String,
    pub local_path: String,
    pub profile_id: String,
    pub bucket: String,
    pub region: Option<String>,
    pub prefix: String,
    pub options: SyncOptions,
    pub bandwidth: u64,
    pub interval_minutes: Option<u32>,
    pub allow_replacement: bool,
}
impl JobConfig {
    fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.len() > 120
            || self.name.chars().any(char::is_control)
        {
            return Err(invalid(
                "Use a job name of 1 to 120 bytes without control characters.",
            ));
        }
        if !PathBuf::from(&self.local_path).is_absolute() || self.local_path.len() > 4096 {
            return Err(invalid("Choose an absolute local folder path."));
        }
        if self.profile_id.is_empty()
            || self.bucket.is_empty()
            || self.bucket.len() > 255
            || self.prefix.len() > 1024
            || (!self.prefix.is_empty() && !self.prefix.ends_with('/'))
        {
            return Err(invalid("Choose a profile, bucket, and folder destination."));
        }
        if self
            .interval_minutes
            .is_some_and(|m| !(15..=10080).contains(&m))
        {
            return Err(invalid("Schedule intervals must be 15 minutes to 7 days."));
        }
        if !self.options.skip_existing && !self.allow_replacement {
            return Err(invalid(
                "Approve replacement for future runs, or skip existing objects.",
            ));
        }
        Filters::new(&self.options)?;
        validate_bandwidth(self.bandwidth)
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Run {
    #[serde(default)]
    pub cancel_requested: bool,
    pub id: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: String,
    pub message: String,
    pub transfer_ids: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct SavedJob {
    pub id: String,
    pub config: JobConfig,
    pub profile_identity: String,
    pub enabled: bool,
    pub next_run: Option<i64>,
    pub last_run: Option<Run>,
}
impl SavedJob {
    fn cancel(&mut self) -> Result<Vec<String>> {
        if !self.active() {
            return Err(invalid("This run has already finished. Refresh Jobs."));
        }
        self.enabled = false;
        self.next_run = None;
        let run = self
            .last_run
            .as_mut()
            .ok_or_else(|| invalid("Run not found."))?;
        run.cancel_requested = true;
        run.message =
            "Cancellation requested. Waiting for preparation or active transfers to stop.".into();
        Ok(run.transfer_ids.clone())
    }
    fn mark_running(&mut self, ids: Vec<String>) -> Result<()> {
        let run = self
            .last_run
            .as_mut()
            .ok_or_else(|| invalid("Run disappeared."))?;
        if run.cancel_requested || run.finished_at.is_some() {
            return Err(invalid("Run cancelled before uploads were queued."));
        }
        run.message = format!(
            "{} uploads queued. View or cancel them in Uploads.",
            ids.len()
        );
        run.transfer_ids = ids;
        run.status = "Running".into();
        Ok(())
    }
    fn active(&self) -> bool {
        self.last_run
            .as_ref()
            .is_some_and(|r| r.finished_at.is_none())
    }
    fn schedule_from(&mut self, time: i64) {
        self.next_run = if self.enabled {
            self.config
                .interval_minutes
                .map(|m| time + i64::from(m) * 60)
        } else {
            None
        };
    }
    fn reserve(&mut self, time: i64) -> Result<()> {
        if self.active() {
            return Err(invalid("This job is already running."));
        }
        self.last_run = Some(Run {
            cancel_requested: false,
            id: uuid::Uuid::new_v4().to_string(),
            started_at: time,
            finished_at: None,
            status: "Preparing".into(),
            message: "Scanning and comparing fresh content.".into(),
            transfer_ids: vec![],
        });
        self.next_run = None;
        Ok(())
    }
    fn finish(&mut self, time: i64, status: &str, message: String) {
        if let Some(run) = &mut self.last_run {
            run.status = status.into();
            run.message = message;
            run.finished_at = Some(time);
        }
        if status != "Completed" {
            self.enabled = false;
        }
        self.schedule_from(time);
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u8,
    jobs: Vec<SavedJob>,
}
pub struct JobStore {
    // The OS releases this lock on process exit, including crashes.
    _lock: Option<std::fs::File>,
    path: PathBuf,
    data: Journal,
    error: Option<String>,
}
pub type JobState = Arc<Mutex<JobStore>>;

impl JobStore {
    pub fn unavailable(path: PathBuf, error: String) -> Self {
        Self {
            _lock: None,
            path,
            data: Journal {
                version: 1,
                jobs: vec![],
            },
            error: Some(error),
        }
    }
    pub fn open(path: PathBuf, time: i64) -> Result<Self> {
        let parent = path
            .parent()
            .ok_or_else(|| invalid("Missing jobs directory."))?;
        std::fs::create_dir_all(parent)?;
        let mut options = std::fs::OpenOptions::new();
        options.create(true).read(true).write(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(path.with_extension("lock"))?;
        lock.try_lock().map_err(|_| invalid("Saved jobs are already open in another Brows3 instance, or cannot be locked. Close other instances and restart Brows3."))?;
        let data = match std::fs::read(&path) {
            Ok(bytes) => {
                if bytes.len() > 16 * 1024 * 1024 {
                    return Err(invalid(
                        "Saved jobs file is too large. Scheduling is disabled.",
                    ));
                }
                serde_json::from_slice::<Journal>(&bytes).map_err(|_| invalid("Saved jobs could not be read. Scheduling is disabled; the original file was kept."))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Journal {
                version: 1,
                jobs: vec![],
            },
            Err(e) => return Err(e.into()),
        };
        if data.version != 1 || data.jobs.len() > 50 {
            return Err(invalid(
                "Unsupported saved jobs file. Scheduling is disabled.",
            ));
        }
        let mut ids = std::collections::HashSet::new();
        for job in &data.jobs {
            job.config.validate()?;
            if !ids.insert(&job.id) {
                return Err(invalid("Duplicate saved job IDs. Scheduling is disabled."));
            }
        }
        let mut store = Self {
            _lock: Some(lock),
            path,
            data,
            error: None,
        };
        store.change(|data| {
            for job in &mut data.jobs {
                if job.active() {
                    job.finish(time, "Interrupted", "Brows3 closed during this run. Review Uploads before running again.".into());
                } else if job.enabled && job.next_run.is_some_and(|due| due <= time) {
                    // No surprise catch-up writes when the application is reopened.
                    job.enabled = false;
                    job.next_run = None;
                    job.last_run = Some(Run { cancel_requested: false, id: uuid::Uuid::new_v4().to_string(), started_at: time,
                        finished_at: Some(time), status: "Missed".into(), message: "A run was missed while Brows3 was closed. Resume the schedule or run now.".into(), transfer_ids: vec![] });
                }
            }
            Ok(())
        })?;
        Ok(store)
    }
    // Commit disk before publishing state. A failed write can never authorize a run.
    fn change<T>(&mut self, update: impl FnOnce(&mut Journal) -> Result<T>) -> Result<T> {
        if let Some(error) = &self.error {
            return Err(invalid(error));
        }
        let mut candidate = self.data.clone();
        let result = update(&mut candidate)?;
        let bytes = serde_json::to_vec(&candidate).map_err(|e| invalid(&e.to_string()))?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err(invalid("Saved jobs storage reached its 16 MiB limit. Delete unused jobs before trying again."));
        }
        crate::credentials::write_private_file(&self.path, &bytes)?;
        self.data = candidate;
        Ok(result)
    }
}
fn find<'a>(data: &'a mut Journal, id: &str) -> Result<&'a mut SavedJob> {
    data.jobs
        .iter_mut()
        .find(|j| j.id == id)
        .ok_or_else(|| invalid("Saved job not found."))
}

#[tauri::command]
pub async fn list_saved_jobs(state: State<'_, JobState>) -> Result<Vec<SavedJob>> {
    let store = state.lock().await;
    if let Some(error) = &store.error {
        return Err(invalid(error));
    }
    Ok(store.data.jobs.clone())
}
#[tauri::command]
pub async fn save_sync_job(
    config: JobConfig,
    approved: bool,
    state: State<'_, JobState>,
    profiles: State<'_, ProfileState>,
) -> Result<SavedJob> {
    config.validate()?;
    if !approved {
        return Err(invalid("Approve this saved job before saving."));
    }
    let profile = profiles
        .read()
        .await
        .get_active_profile()
        .await?
        .ok_or_else(|| invalid("Select a profile."))?;
    super::operations::validate_operation_profile(Some(&config.profile_id), &profile.id)?;
    let metadata = std::fs::symlink_metadata(&config.local_path)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(invalid("Choose a real local folder, not a symlink."));
    }
    let mut job = SavedJob {
        id: uuid::Uuid::new_v4().to_string(),
        profile_identity: profile.cache_identity(),
        enabled: config.interval_minutes.is_some(),
        config,
        next_run: None,
        last_run: None,
    };
    job.schedule_from(now());
    state.lock().await.change(|data| {
        if data.jobs.len() >= 50 {
            return Err(invalid("At most 50 saved jobs are supported."));
        }
        data.jobs.push(job.clone());
        Ok(job)
    })
}
#[tauri::command]
pub async fn set_saved_job_enabled(
    id: String,
    enabled: bool,
    state: State<'_, JobState>,
) -> Result<()> {
    state.lock().await.change(|data| {
        let job = find(data, &id)?;
        if enabled && job.config.interval_minutes.is_none() {
            return Err(invalid("This is a manual job."));
        }
        job.enabled = enabled;
        if !job.active() {
            job.schedule_from(now());
        }
        Ok(())
    })
}
#[tauri::command]
pub async fn delete_saved_job(id: String, state: State<'_, JobState>) -> Result<()> {
    state.lock().await.change(|data| {
        if find(data, &id)?.active() { return Err(invalid("Wait for this run to finish, or cancel its transfers in Uploads, before deleting the job.")); }
        data.jobs.retain(|j| j.id != id); Ok(())
    })
}
#[tauri::command]
pub async fn run_saved_job(id: String, state: State<'_, JobState>, app: AppHandle) -> Result<()> {
    let job = reserve(state.inner(), &id, None).await?;
    launch(app, state.inner().clone(), job);
    Ok(())
}
#[tauri::command]
pub async fn cancel_saved_job(
    id: String,
    state: State<'_, JobState>,
    transfers: State<'_, TransferState>,
) -> Result<()> {
    let ids = state.lock().await.change(|data| {
        let job = find(data, &id)?;
        job.cancel()
    })?;
    for id in ids {
        transfers.cancel_job(&id).await;
    }
    Ok(())
}
async fn reserve(state: &JobState, id: &str, due: Option<i64>) -> Result<SavedJob> {
    state.lock().await.change(|data| {
        let job = find(data, id)?;
        if let Some(time) = due {
            if !job.enabled || job.next_run.is_none_or(|n| n > time) {
                return Err(invalid("Schedule changed."));
            }
        }
        job.reserve(now())?;
        Ok(job.clone())
    })
}

fn launch(app: AppHandle, state: JobState, job: SavedJob) {
    tauri::async_runtime::spawn(async move {
        static PREPARATIONS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
        let permit = PREPARATIONS
            .acquire()
            .await
            .expect("preparation semaphore remains open");
        let profiles = app.state::<ProfileState>().inner().clone();
        let s3 = app.state::<S3State>().inner().clone();
        let cancelled = state
            .lock()
            .await
            .data
            .jobs
            .iter()
            .find(|j| j.id == job.id)
            .and_then(|j| j.last_run.as_ref())
            .is_none_or(|r| r.cancel_requested);
        let result = if cancelled {
            Err(invalid("Run cancelled before preparation."))
        } else {
            prepare(&job, &profiles, &s3).await
        };
        drop(permit);
        let transfers = app.state::<TransferState>().inner().clone();
        let mut queued = vec![];
        let result = match result {
            Ok(jobs) => {
                // Record IDs before queueing, so restart recovery can never repeat this run.
                let ids: Vec<_> = jobs.iter().map(|j| j.id.clone()).collect();
                // Serialize cancellation with publication to the transfer queue.
                let mut store = state.lock().await;
                let persisted = store.change(|data| {
                    let current = find(data, &job.id)?;
                    current.mark_running(ids.clone())
                });
                match persisted {
                    Err(error) => Err(error),
                    Ok(()) => {
                        queued = ids;
                        transfers.set_app_handle(app.clone()).await;
                        transfers.add_jobs(jobs).await;
                        drop(store);
                        let s3 = app.state::<S3State>().inner().clone();
                        let profiles = app.state::<ProfileState>().inner().clone();
                        transfers.clone().process_queue(s3, profiles).await;
                        Ok(())
                    }
                }
            }
            Err(error) => Err(error),
        };
        let (status, message) = match result {
            Err(error) => ("Failed", error.to_string()),
            Ok(()) => monitor(&transfers, &queued).await,
        };
        let completed = state.lock().await.change(|data| {
            let current = find(data, &job.id)?;
            if current
                .last_run
                .as_ref()
                .is_some_and(|r| r.cancel_requested)
            {
                current.finish(
                    now(),
                    "Cancelled",
                    "Run cancelled. Completed uploads are kept. Schedule paused.".into(),
                );
            } else {
                current.finish(now(), status, message);
            }
            Ok(current.clone())
        });
        match completed {
            Ok(job) => {
                let _ = app.emit("saved-job-finished", job);
            }
            // Retain the active reservation on storage failure: no subsequent automatic writes.
            Err(error) => {
                log::error!("Could not save job outcome: {error}");
                let _ = app.emit("saved-job-storage-error", "Could not save the job result. Scheduling for this job is stopped. Check disk space and restart Brows3.");
            }
        }
    });
}

async fn prepare(
    job: &SavedJob,
    profiles: &ProfileState,
    s3: &S3State,
) -> Result<Vec<TransferJob>> {
    let profile = profiles
        .read()
        .await
        .get_profile(&job.config.profile_id)
        .await?;
    if profile.cache_identity() != job.profile_identity {
        return Err(invalid("Profile settings changed. Delete and recreate this job to approve the new destination."));
    }
    let config = job.config.clone();
    let local = tokio::task::spawn_blocking(move || {
        sync::scan(&PathBuf::from(config.local_path), &config.prefix)
    })
    .await
    .map_err(|e| invalid(&e.to_string()))??;
    let client = {
        let mut manager = s3.write().await;
        match &job.config.region {
            Some(region) => manager
                .get_client_for_region(&profile, region)
                .await?
                .clone(),
            None => manager.get_client(&profile).await?.clone(),
        }
    };
    let (_, files) = super::sync::compare_options(
        &client,
        &job.config.bucket,
        &job.config.prefix,
        local,
        &job.config.options,
    )
    .await?;
    if profiles
        .read()
        .await
        .get_profile(&job.config.profile_id)
        .await?
        .cache_identity()
        != job.profile_identity
    {
        return Err(invalid(
            "Profile changed while preparing this run. Recreate the saved job.",
        ));
    }
    let run = job
        .last_run
        .as_ref()
        .ok_or_else(|| invalid("Missing run reservation."))?;
    Ok(files
        .into_iter()
        .map(|mut file| {
            file.source.profile_identity = job.profile_identity.clone();
            let mut transfer = TransferJob::new(
                TransferType::Upload,
                job.config.profile_id.clone(),
                job.config.bucket.clone(),
                job.config.region.clone(),
                file.key,
                file.source.root.join(&file.source.relative),
                file.source.size,
            )
            .with_group(run.id.clone(), format!("Job: {}", job.config.name));
            transfer.sync_source = Some(file.source);
            transfer.bandwidth_limit = Some(job.config.bandwidth);
            transfer
        })
        .collect())
}

async fn monitor(transfers: &TransferState, ids: &[String]) -> (&'static str, String) {
    // Remember terminal outcomes even if the user later clears transfer history.
    let mut pending: std::collections::HashSet<_> = ids.iter().cloned().collect();
    let mut failed = 0;
    let mut cancelled = 0;
    while !pending.is_empty() {
        let mut done = vec![];
        for id in &pending {
            match transfers.get_job(id).await.map(|j| j.status) {
                Some(TransferStatus::Completed) => done.push(id.clone()),
                Some(TransferStatus::Failed(_)) | None => {
                    failed += 1;
                    done.push(id.clone());
                }
                Some(TransferStatus::Cancelled) => {
                    cancelled += 1;
                    done.push(id.clone());
                }
                _ => {}
            }
        }
        for id in done {
            pending.remove(&id);
        }
        if !pending.is_empty() {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
    if failed > 0 {
        ("Failed", format!("{failed} failed or unavailable transfers; {cancelled} cancelled. Schedule paused. Review Uploads."))
    } else if cancelled > 0 {
        (
            "Cancelled",
            format!("{cancelled} transfers cancelled. Schedule paused."),
        )
    } else {
        (
            "Completed",
            if ids.is_empty() {
                "No uploads needed. Destination already matches these rules.".into()
            } else {
                format!("{} uploads completed.", ids.len())
            },
        )
    }
}

pub fn start_scheduler(app: AppHandle, state: JobState) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let time = now();
            let due: Vec<_> = state
                .lock()
                .await
                .data
                .jobs
                .iter()
                .filter(|j| j.enabled && !j.active() && j.next_run.is_some_and(|n| n <= time))
                .map(|j| j.id.clone())
                .collect();
            for id in due {
                match reserve(&state, &id, Some(time)).await {
                    Ok(job) => launch(app.clone(), state.clone(), job),
                    Err(error) => log::warn!("Scheduled run not started: {error}"),
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::{CredentialType, Profile, ProfileManager};
    use crate::s3::S3ClientManager;
    use crate::transfer::TransferManager;
    use tokio::sync::RwLock;

    fn job(root: &std::path::Path) -> SavedJob {
        SavedJob {
            id: "saved".into(),
            profile_identity: "identity".into(),
            enabled: true,
            next_run: Some(1000),
            last_run: None,
            config: JobConfig {
                name: "Backup".into(),
                local_path: root.to_string_lossy().into(),
                profile_id: "profile".into(),
                bucket: "bucket".into(),
                region: Some("us-east-1".into()),
                prefix: "backup/".into(),
                options: SyncOptions {
                    skip_existing: true,
                    ..Default::default()
                },
                bandwidth: 65536,
                interval_minutes: Some(15),
                allow_replacement: false,
            },
        }
    }
    fn store(root: &std::path::Path) -> JobStore {
        let mut store = JobStore::open(root.join("jobs.json"), 0).unwrap();
        store
            .change(|data| {
                data.jobs.push(job(root));
                Ok(())
            })
            .unwrap();
        store
    }
    #[test]
    fn validation_rejects_unapproved_replacements_intervals_filters_and_bad_paths() {
        let root = tempfile::tempdir().unwrap();
        let valid = job(root.path()).config;
        assert!(valid.validate().is_ok());
        let mut bad = valid.clone();
        bad.options.skip_existing = false;
        assert!(bad.validate().is_err());
        bad.allow_replacement = true;
        assert!(bad.validate().is_ok());
        for interval in [0, 14, 10081, u32::MAX] {
            let mut bad = valid.clone();
            bad.interval_minutes = Some(interval);
            assert!(bad.validate().is_err());
        }
        let mut bad = valid.clone();
        bad.local_path = "relative".into();
        assert!(bad.validate().is_err());
        let mut bad = valid.clone();
        bad.prefix = "not-a-folder".into();
        assert!(bad.validate().is_err());
        let mut bad = valid.clone();
        bad.options.include = vec!["[".into()];
        assert!(bad.validate().is_err());
        let mut bad = valid;
        bad.bandwidth = 1;
        assert!(bad.validate().is_err());
    }
    #[test]
    fn cancellation_blocks_queue_publication_and_retains_exact_transfer_ids() {
        let root = tempfile::tempdir().unwrap();
        let mut job = job(root.path());
        assert!(job.cancel().is_err());
        job.reserve(0).unwrap();
        assert!(job.cancel().unwrap().is_empty());
        assert!(job.mark_running(vec!["must-not-queue".into()]).is_err());
        assert!(job.last_run.as_ref().unwrap().transfer_ids.is_empty());
        job.finish(1, "Cancelled", "cancelled".into());
        job.reserve(2).unwrap();
        job.mark_running(vec!["a".into(), "b".into()]).unwrap();
        assert_eq!(job.cancel().unwrap(), vec!["a", "b"]);
        assert!(!job.enabled);
        assert_eq!(job.next_run, None);
    }
    #[tokio::test]
    async fn paused_or_deleted_jobs_cannot_be_reserved_by_a_stale_scheduler_tick() {
        let root = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(store(root.path())));
        state
            .lock()
            .await
            .change(|data| {
                data.jobs[0].enabled = false;
                Ok(())
            })
            .unwrap();
        assert!(reserve(&state, "saved", Some(1001)).await.is_err());
        state
            .lock()
            .await
            .change(|data| {
                data.jobs.clear();
                Ok(())
            })
            .unwrap();
        assert!(reserve(&state, "saved", None).await.is_err());
    }
    #[tokio::test]
    #[ignore = "requires a disposable MinIO endpoint"]
    async fn saved_sync_real_endpoint_round_trip_and_repeat() {
        let root = tempfile::tempdir().unwrap();
        let local = root.path().join("local");
        std::fs::create_dir(&local).unwrap();
        let (profiles, s3, profile) = setup(
            root.path(),
            std::env::var("BROWS3_JOBS_TEST_ENDPOINT").expect("disposable endpoint required"),
        )
        .await;
        let client = s3.write().await.get_client(&profile).await.unwrap().clone();
        let bucket = format!("brows3-jobs-test-{}", uuid::Uuid::new_v4().simple());
        client.create_bucket().bucket(&bucket).send().await.unwrap();
        let mut job = job(&local);
        job.config.profile_id = profile.id.clone();
        job.profile_identity = profile.cache_identity();
        job.config.bucket = bucket.clone();
        job.reserve(0).unwrap();
        std::fs::write(local.join("fresh.txt"), b"saved job content").unwrap();
        let transfers = prepare(&job, &profiles, &s3).await.unwrap();
        assert_eq!(transfers.len(), 1);
        let ids: Vec<_> = transfers.iter().map(|t| t.id.clone()).collect();
        let manager = Arc::new(TransferManager::new());
        manager
            .configure_journal(root.path().join("transfers.json"))
            .await
            .unwrap();
        manager.add_jobs(transfers).await;
        manager
            .clone()
            .process_queue(s3.clone(), profiles.clone())
            .await;
        let outcome = tokio::time::timeout(Duration::from_secs(30), monitor(&manager, &ids))
            .await
            .unwrap();
        assert_eq!(outcome.0, "Completed", "{}", outcome.1);
        let body = client
            .get_object()
            .bucket(&bucket)
            .key("backup/fresh.txt")
            .send()
            .await
            .unwrap()
            .body
            .collect()
            .await
            .unwrap()
            .into_bytes();
        assert_eq!(body.as_ref(), b"saved job content");
        assert!(prepare(&job, &profiles, &s3).await.unwrap().is_empty());
        // A later run sees files created after the job was saved.
        std::fs::write(local.join("later.txt"), b"later content").unwrap();
        assert_eq!(
            prepare(&job, &profiles, &s3).await.unwrap()[0].key,
            "backup/later.txt"
        );
        client
            .delete_object()
            .bucket(&bucket)
            .key("backup/fresh.txt")
            .send()
            .await
            .unwrap();
        client.delete_bucket().bucket(&bucket).send().await.unwrap();
    }
    #[test]
    fn restart_never_replays_interrupted_or_missed_runs() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store(root.path());
        store
            .change(|data| {
                data.jobs[0].reserve(10)?;
                Ok(())
            })
            .unwrap();
        let path = store.path.clone();
        drop(store);
        let mut recovered = JobStore::open(path.clone(), 20).unwrap();
        let job = &recovered.data.jobs[0];
        assert!(!job.enabled);
        assert!(!job.active());
        assert_eq!(job.last_run.as_ref().unwrap().status, "Interrupted");
        recovered
            .change(|data| {
                data.jobs[0] = super::tests::job(root.path());
                Ok(())
            })
            .unwrap();
        drop(recovered);
        let missed = JobStore::open(path, 1000).unwrap();
        assert!(!missed.data.jobs[0].enabled);
        assert_eq!(
            missed.data.jobs[0].last_run.as_ref().unwrap().status,
            "Missed"
        );
    }
    #[test]
    fn reopening_before_due_preserves_schedule_and_private_file() {
        let root = tempfile::tempdir().unwrap();
        let store = store(root.path());
        let path = store.path.clone();
        assert!(JobStore::open(path.clone(), 999).is_err()); // A second instance cannot run the same schedules.
        drop(store);
        let reopened = JobStore::open(path, 999).unwrap();
        assert!(reopened.data.jobs[0].enabled);
        assert_eq!(reopened.data.jobs[0].next_run, Some(1000));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&reopened.path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o077,
                0
            );
        }
    }
    #[tokio::test]
    async fn concurrent_manual_and_scheduled_requests_have_one_winner() {
        let root = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(store(root.path())));
        let (a, b) = tokio::join!(
            reserve(&state, "saved", None),
            reserve(&state, "saved", Some(1000))
        );
        assert_ne!(a.is_ok(), b.is_ok());
        assert!(state.lock().await.data.jobs[0].active());
        assert!(reserve(&state, "saved", None).await.is_err());
    }
    #[test]
    fn completion_is_fixed_delay_and_failure_or_pause_prevents_next_run() {
        let root = tempfile::tempdir().unwrap();
        let mut job = job(root.path());
        job.reserve(1000).unwrap();
        assert_eq!(job.next_run, None);
        job.finish(2000, "Completed", "done".into());
        assert_eq!(job.next_run, Some(2900));
        job.reserve(2900).unwrap();
        job.enabled = false;
        job.finish(3000, "Completed", "done".into());
        assert_eq!(job.next_run, None);
        job.enabled = true;
        job.reserve(4000).unwrap();
        job.finish(4100, "Failed", "offline".into());
        assert!(!job.enabled);
        assert_eq!(job.next_run, None);
    }
    #[test]
    fn failed_persistence_rolls_back_reservation_and_keeps_prior_data() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store(root.path());
        let before = std::fs::read(&store.path).unwrap();
        store.path = root.path().to_path_buf(); // A directory cannot be atomically replaced by a file.
        assert!(store.change(|data| data.jobs[0].reserve(1)).is_err());
        assert!(!store.data.jobs[0].active());
        assert_eq!(
            std::fs::read(root.path().join("jobs.json")).unwrap(),
            before
        );
    }
    #[test]
    fn oversized_candidate_cannot_replace_a_readable_journal() {
        let root = tempfile::tempdir().unwrap();
        let mut store = store(root.path());
        let before = std::fs::read(&store.path).unwrap();
        assert!(store
            .change(|data| {
                data.jobs[0].reserve(0)?;
                data.jobs[0].last_run.as_mut().unwrap().message = "x".repeat(16 * 1024 * 1024);
                Ok(())
            })
            .is_err());
        assert!(!store.data.jobs[0].active());
        assert_eq!(std::fs::read(&store.path).unwrap(), before);
    }
    #[test]
    fn corrupt_or_future_journals_are_preserved_and_disabled() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("jobs.json");
        for contents in ["not json", "{\"version\":2,\"jobs\":[]}"] {
            std::fs::write(&path, contents).unwrap();
            assert!(JobStore::open(path.clone(), 0).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        }
        let mut disabled = JobStore::unavailable(path, "Unavailable".into());
        assert!(disabled.change(|_| Ok(())).is_err());
    }
    #[tokio::test]
    async fn monitor_handles_empty_cancelled_failed_and_cleared_jobs_conservatively() {
        let transfers = Arc::new(TransferManager::new());
        assert_eq!(monitor(&transfers, &[]).await.0, "Completed");
        assert_eq!(monitor(&transfers, &["missing".into()]).await.0, "Failed");
        let transfer = TransferJob::new(
            TransferType::Upload,
            "a".into(),
            "b".into(),
            None,
            "key".into(),
            PathBuf::from("local"),
            0,
        );
        let id = transfer.id.clone();
        transfers.add_jobs(vec![transfer]).await;
        transfers.cancel_job(&id).await;
        assert_eq!(monitor(&transfers, &[id]).await.0, "Cancelled");
    }
    async fn setup(root: &std::path::Path, endpoint: String) -> (ProfileState, S3State, Profile) {
        let mut profiles = ProfileManager::new(root.join("profiles"), true).unwrap();
        let profile = profiles
            .add_profile(Profile::new(
                "Test".into(),
                CredentialType::CustomEndpoint {
                    endpoint_url: endpoint,
                    access_key_id: "TEST".into(),
                    secret_access_key: "test-secret".into(),
                },
                Some("us-east-1".into()),
            ))
            .await
            .unwrap();
        (
            Arc::new(RwLock::new(profiles)),
            Arc::new(RwLock::new(S3ClientManager::new())),
            profile,
        )
    }
    #[tokio::test]
    async fn scheduled_preparation_scans_fresh_files_uses_filters_and_pins_destination() {
        use crate::commands::test_s3::{response, scripted_endpoint};
        let root = tempfile::tempdir().unwrap();
        let local = root.path().join("local");
        std::fs::create_dir(&local).unwrap();
        let (endpoint, server) = scripted_endpoint(vec![response(
            200,
            "",
            "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
        )])
        .await;
        let (profiles, s3, profile) = setup(root.path(), endpoint).await;
        let mut job = job(&local);
        job.config.profile_id = profile.id.clone();
        job.profile_identity = profile.cache_identity();
        job.config.options.exclude = vec!["*.tmp".into()];
        job.reserve(0).unwrap();
        std::fs::write(local.join("fresh.txt"), b"fresh").unwrap();
        std::fs::write(local.join("skip.tmp"), b"skip").unwrap();
        let transfers = prepare(&job, &profiles, &s3).await.unwrap();
        assert_eq!(transfers.len(), 1);
        assert_eq!(transfers[0].key, "backup/fresh.txt");
        assert_eq!(transfers[0].bandwidth_limit, Some(65536));
        assert_eq!(transfers[0].profile_id, profile.id);
        assert_eq!(
            transfers[0].sync_source.as_ref().unwrap().profile_identity,
            job.profile_identity
        );
        assert!(transfers[0].sync_source.as_ref().unwrap().current_session);
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET "));
    }
    #[tokio::test]
    async fn changed_profile_and_missing_local_folder_fail_before_network() {
        let root = tempfile::tempdir().unwrap();
        let (profiles, s3, profile) = setup(root.path(), "http://127.0.0.1:1".into()).await;
        let mut job = job(root.path());
        job.config.profile_id = profile.id.clone();
        job.reserve(0).unwrap();
        assert!(prepare(&job, &profiles, &s3)
            .await
            .unwrap_err()
            .to_string()
            .contains("Profile settings changed"));
        job.profile_identity = profile.cache_identity();
        job.config.local_path = root.path().join("missing").to_string_lossy().into();
        assert!(prepare(&job, &profiles, &s3).await.is_err());
    }
}
