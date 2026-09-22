use super::{profiles::ProfileState, transfer::TransferState};
use crate::transfer::controls::{Filters, SyncOptions};
use crate::{
    error::{AppError, Result},
    s3::S3State,
    transfer::{
        sync::{self, LocalFile},
        TransferJob, TransferType,
    },
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct SyncPlans(Mutex<HashMap<String, Plan>>);
struct Plan {
    created: Instant,
    profile: String,
    bucket: String,
    region: Option<String>,
    files: Vec<LocalFile>,
    preview: Preview,
}
#[derive(Clone, Serialize)]
pub struct Entry {
    pub key: String,
    pub size: u64,
    pub action: String,
}
#[derive(Clone, Serialize)]
pub struct Preview {
    pub id: String,
    pub entries: Vec<Entry>,
    pub new_files: usize,
    pub changed_files: usize,
    pub unverified_files: usize,
    pub unchanged_files: usize,
    pub remote_only_files: usize,
    pub upload_bytes: u64,
    pub filtered_files: usize,
    pub skipped_files: usize,
}

async fn selected(state: &ProfileState, expected: &str) -> Result<crate::credentials::Profile> {
    let profile = state
        .read()
        .await
        .get_active_profile()
        .await?
        .ok_or_else(|| AppError::ConfigError("Select a profile".into()))?;
    super::operations::validate_operation_profile(Some(expected), &profile.id)?;
    Ok(profile)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn preview_folder_sync(
    local_path: String,
    bucket_name: String,
    bucket_region: Option<String>,
    prefix: String,
    expected_profile_id: String,
    options: Option<SyncOptions>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    sync_plans: State<'_, SyncPlans>,
) -> Result<Preview> {
    let options = options.unwrap_or_default();
    Filters::new(&options)?;
    let profile = selected(profile_state.inner(), &expected_profile_id).await?;
    if !prefix.is_empty() && !prefix.ends_with('/') {
        return Err(AppError::ConfigError(
            "Sync destination must be a folder prefix".into(),
        ));
    }
    let prefix_copy = prefix.clone();
    let local =
        tokio::task::spawn_blocking(move || sync::scan(&PathBuf::from(local_path), &prefix_copy))
            .await
            .map_err(|e| AppError::IoError(e.to_string()))??;
    let client = {
        let mut manager = s3_state.write().await;
        match &bucket_region {
            Some(region) => manager
                .get_client_for_region(&profile, region)
                .await?
                .clone(),
            None => manager.get_client(&profile).await?.clone(),
        }
    };
    let (preview, mut uploads) =
        compare_options(&client, &bucket_name, &prefix, local, &options).await?;
    let current = selected(profile_state.inner(), &expected_profile_id).await?;
    if current.cache_identity() != profile.cache_identity() {
        return Err(AppError::ConfigError(
            "Profile settings changed during preview. Preview again.".into(),
        ));
    }
    for file in &mut uploads {
        file.source.profile_identity = profile.cache_identity();
    }
    let mut plans = sync_plans.0.lock().await;
    plans.retain(|_, plan| plan.created.elapsed() < Duration::from_secs(900));
    if plans.len() >= 4 {
        if let Some(oldest) = plans
            .iter()
            .min_by_key(|(_, p)| p.created)
            .map(|(id, _)| id.clone())
        {
            plans.remove(&oldest);
        }
    }
    plans.insert(
        preview.id.clone(),
        Plan {
            created: Instant::now(),
            profile: expected_profile_id,
            bucket: bucket_name,
            region: bucket_region,
            files: uploads,
            preview: preview.clone(),
        },
    );
    Ok(preview)
}

#[cfg(test)]
async fn compare(
    client: &aws_sdk_s3::Client,
    bucket_name: &str,
    prefix: &str,
    local: Vec<LocalFile>,
) -> Result<(Preview, Vec<LocalFile>)> {
    compare_options(client, bucket_name, prefix, local, &SyncOptions::default()).await
}

pub(crate) async fn compare_options(
    client: &aws_sdk_s3::Client,
    bucket_name: &str,
    prefix: &str,
    local: Vec<LocalFile>,
    options: &SyncOptions,
) -> Result<(Preview, Vec<LocalFile>)> {
    let filters = Filters::new(options)?;
    let remote = crate::s3::listing::list_recursive(client, bucket_name, prefix).await?;
    let mut remote: HashMap<_, _> = remote
        .into_iter()
        .filter_map(|o| o.key.clone().map(|key| (key, o)))
        .collect();
    let mut preview = Preview {
        id: uuid::Uuid::new_v4().to_string(),
        entries: vec![],
        new_files: 0,
        changed_files: 0,
        unverified_files: 0,
        unchanged_files: 0,
        remote_only_files: 0,
        upload_bytes: 0,
        filtered_files: 0,
        skipped_files: 0,
    };
    let mut uploads = vec![];
    // An overall timeout bounds HEAD requests as well as the LIST scan. No writes occur.
    tokio::time::timeout(Duration::from_secs(120), async {
        for mut file in local {
            let exists = remote.remove(&file.key).is_some();
            if !filters.accepts(
                file.key
                    .strip_prefix(prefix)
                    .ok_or_else(|| AppError::ConfigError("File outside sync prefix".into()))?,
            ) {
                preview.filtered_files += 1;
                preview.entries.push(Entry {
                    key: file.key,
                    size: file.source.size,
                    action: "Filtered".into(),
                });
                continue;
            }
            if exists && options.skip_existing {
                preview.skipped_files += 1;
                preview.entries.push(Entry {
                    key: file.key,
                    size: file.source.size,
                    action: "Skipped".into(),
                });
                continue;
            }
            let action = if exists {
                let head = client
                    .head_object()
                    .bucket(bucket_name)
                    .key(&file.key)
                    .send()
                    .await
                    .map_err(|e| AppError::S3Error(format!("Cannot compare {}: {e}", file.key)))?;
                let etag = head.e_tag().filter(|e| !e.is_empty()).ok_or_else(|| {
                    AppError::S3Error(
                        "Destination has no ETag; safe replacement is unavailable".into(),
                    )
                })?;
                file.source.expected_etag = Some(etag.into());
                if sync::unchanged(&file, &head) {
                    preview.unchanged_files += 1;
                    "Unchanged"
                } else if head.content_length() != Some(file.source.size as i64)
                    || (head
                        .e_tag()
                        .is_some_and(|e| e.trim_matches('"').len() == 32)
                        && matches!(
                            head.server_side_encryption().map(|s| s.as_str()),
                            None | Some("AES256")
                        ))
                {
                    preview.changed_files += 1;
                    "Changed"
                } else {
                    preview.unverified_files += 1;
                    "Unverified"
                }
            } else {
                preview.new_files += 1;
                "New"
            };
            preview.entries.push(Entry {
                key: file.key.clone(),
                size: file.source.size,
                action: action.into(),
            });
            if action != "Unchanged" {
                preview.upload_bytes += file.source.size;
                uploads.push(file);
            }
        }
        Ok::<(), AppError>(())
    })
    .await
    .map_err(|_| AppError::S3Error("Comparison timed out. Choose a smaller folder.".into()))??;
    preview.remote_only_files = remote
        .values()
        .filter(|o| !o.key().unwrap_or("").ends_with('/'))
        .count();
    Ok((preview, uploads))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_folder_sync(
    plan_id: String,
    replace_existing: bool,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
    sync_plans: State<'_, SyncPlans>,
    app_handle: AppHandle,
) -> Result<usize> {
    selected(profile_state.inner(), &expected_profile_id).await?;
    let mut plans = sync_plans.0.lock().await;
    let plan = take_plan(&mut plans, &plan_id, &expected_profile_id, replace_existing)?;
    drop(plans);
    let jobs: Vec<_> = plan
        .files
        .into_iter()
        .map(|file| {
            let mut job = TransferJob::new(
                TransferType::Upload,
                plan.profile.clone(),
                plan.bucket.clone(),
                plan.region.clone(),
                file.key,
                file.source.root.join(&file.source.relative),
                file.source.size,
            )
            .with_group(plan_id.clone(), "Folder sync".into());
            job.sync_source = Some(file.source);
            job
        })
        .collect();
    let count = jobs.len();
    let ids: Vec<_> = jobs.iter().map(|job| job.id.clone()).collect();
    transfer_state.set_app_handle(app_handle).await;
    transfer_state.add_jobs(jobs).await;
    for id in ids {
        if let Some(job) = transfer_state.get_job(&id).await {
            if let crate::transfer::TransferStatus::Failed(error) = job.status {
                return Err(AppError::IoError(format!(
                    "Sync could not be queued: {error}"
                )));
            }
        }
    }
    let transfers = transfer_state.inner().clone();
    let profiles = profile_state.inner().clone();
    let s3 = s3_state.inner().clone();
    tauri::async_runtime::spawn(async move {
        transfers.process_queue(s3, profiles).await;
    });
    Ok(count)
}

fn take_plan(
    plans: &mut HashMap<String, Plan>,
    plan_id: &str,
    expected_profile_id: &str,
    replace_existing: bool,
) -> Result<Plan> {
    let plan = plans.get(plan_id).ok_or_else(|| {
        AppError::ConfigError("Preview expired or was already used. Preview again.".into())
    })?;
    if plan.profile != expected_profile_id || plan.created.elapsed() >= Duration::from_secs(900) {
        return Err(AppError::ConfigError(
            "Profile changed or preview expired. Preview again.".into(),
        ));
    }
    if !replace_existing && (plan.preview.changed_files + plan.preview.unverified_files > 0) {
        return Err(AppError::ConfigError(
            "Confirm replacement of existing objects before syncing.".into(),
        ));
    }
    Ok(plans.remove(plan_id).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_s3::{response, scripted_client};
    #[tokio::test]
    async fn filters_and_skip_existing_never_head_or_queue_excluded_objects() {
        let root = tempfile::tempdir().unwrap();
        for name in ["new.txt", "existing.txt", "excluded.txt", "image.png"] {
            std::fs::write(root.path().join(name), b"hello").unwrap();
        }
        let local = sync::scan(root.path(), "dest/").unwrap();
        let (client, server) = scripted_client(vec![response(200, "", "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>dest/existing.txt</Key></Contents><Contents><Key>dest/excluded.txt</Key></Contents><Contents><Key>dest/remote.txt</Key></Contents></ListBucketResult>")]).await;
        let options = SyncOptions {
            include: vec!["**/*.txt".into()],
            exclude: vec!["excluded.txt".into()],
            skip_existing: true,
        };
        let (preview, jobs) = compare_options(&client, "bucket", "dest/", local, &options)
            .await
            .unwrap();
        assert_eq!(
            (
                preview.new_files,
                preview.filtered_files,
                preview.skipped_files,
                preview.remote_only_files
            ),
            (1, 2, 1, 1)
        );
        assert_eq!(preview.upload_bytes, 5);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].key, "dest/new.txt");
        assert!(jobs[0].source.expected_etag.is_none());
        let plan = Plan {
            created: Instant::now(),
            profile: "a".into(),
            bucket: "bucket".into(),
            region: None,
            files: jobs,
            preview,
        };
        let mut plans = HashMap::from([("plan".into(), plan)]);
        assert!(take_plan(&mut plans, "plan", "a", false).is_ok());
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET "));
    }
    #[test]
    fn plans_require_profile_confirmation_freshness_and_are_single_use() {
        let preview = Preview {
            id: "plan".into(),
            entries: vec![],
            new_files: 0,
            changed_files: 1,
            unverified_files: 0,
            unchanged_files: 0,
            remote_only_files: 0,
            upload_bytes: 0,
            filtered_files: 0,
            skipped_files: 0,
        };
        let plan = Plan {
            created: Instant::now(),
            profile: "a".into(),
            bucket: "bucket".into(),
            region: None,
            files: vec![],
            preview,
        };
        let mut plans = HashMap::from([("plan".into(), plan)]);
        assert!(take_plan(&mut plans, "plan", "b", true).is_err());
        assert!(take_plan(&mut plans, "plan", "a", false).is_err());
        plans.get_mut("plan").unwrap().created = Instant::now() - Duration::from_secs(901);
        assert!(take_plan(&mut plans, "plan", "a", true).is_err());
        plans.get_mut("plan").unwrap().created = Instant::now();
        assert!(take_plan(&mut plans, "plan", "a", true).is_ok());
        assert!(take_plan(&mut plans, "plan", "a", true).is_err());
    }
    #[tokio::test]
    async fn preview_is_read_only_and_keeps_remote_only_objects() {
        let root = tempfile::tempdir().unwrap();
        for name in ["changed", "new", "same", "unknown"] {
            std::fs::write(root.path().join(name), b"hello").unwrap();
        }
        let local = sync::scan(root.path(), "dest/").unwrap();
        let listing = "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>dest/changed</Key></Contents><Contents><Key>dest/same</Key></Contents><Contents><Key>dest/unknown</Key></Contents><Contents><Key>dest/keep</Key></Contents></ListBucketResult>";
        let head = |etag: &str| {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nETag: {etag}\r\nConnection: close\r\n\r\n"
            )
        };
        let (client, server) = scripted_client(vec![
            response(200, "", listing),
            head("\"00000000000000000000000000000000\""),
            head("\"5d41402abc4b2a76b9719d911017c592\""),
            head("\"multipart-2\""),
        ])
        .await;
        let (preview, jobs) = compare(&client, "bucket", "dest/", local).await.unwrap();
        assert_eq!(
            (
                preview.new_files,
                preview.changed_files,
                preview.unchanged_files,
                preview.unverified_files,
                preview.remote_only_files
            ),
            (1, 1, 1, 1, 1)
        );
        assert_eq!(preview.upload_bytes, 15);
        assert_eq!(jobs.len(), 3);
        let requests = server.await.unwrap();
        assert!(requests
            .iter()
            .all(|r| r.starts_with("GET ") || r.starts_with("HEAD ")));
    }
    #[tokio::test]
    async fn failed_listing_never_produces_a_plan() {
        let (client, server) = scripted_client(vec![response(
            403,
            "",
            "<Error><Code>AccessDenied</Code></Error>",
        )])
        .await;
        assert!(compare(&client, "bucket", "", vec![]).await.is_err());
        assert_eq!(server.await.unwrap().len(), 1);
    }
}
