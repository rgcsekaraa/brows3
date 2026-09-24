use crate::{
    commands::{profiles::ProfileState, transfer::TransferState},
    error::{AppError, Result},
    s3::S3State,
    transfer::{
        url_import::{ImportEntry, UrlSource, MAX_BATCH},
        TransferJob, TransferType,
    },
};
use futures::{stream, StreamExt, TryStreamExt};
use std::{collections::HashSet, time::Duration};
use tauri::{AppHandle, State};

async fn profile(state: &ProfileState, expected: &str) -> Result<crate::credentials::Profile> {
    let p = state
        .read()
        .await
        .get_active_profile()
        .await?
        .ok_or_else(|| AppError::ConfigError("Choose a connection.".into()))?;
    super::operations::validate_operation_profile(Some(expected), &p.id)?;
    Ok(p)
}

#[tauri::command]
pub async fn get_public_urls(
    bucket: String,
    region: Option<String>,
    keys: Vec<String>,
    overrides: Option<std::collections::BTreeMap<String, String>>,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
) -> Result<Vec<String>> {
    if keys.is_empty()
        || keys.len() > 10_000
        || keys.iter().any(|key| key.is_empty() || key.ends_with('/'))
    {
        return Err(AppError::ConfigError(
            "Select between 1 and 10,000 files.".into(),
        ));
    }
    let p = profile(profile_state.inner(), &expected_profile_id).await?;
    let overrides = overrides.unwrap_or_default();
    if overrides.len() > keys.len() || overrides.keys().any(|k| !keys.contains(k)) {
        return Err(AppError::ConfigError(
            "URL overrides must match selected files.".into(),
        ));
    }
    keys.iter()
        .map(|key| match overrides.get(key) {
            Some(value) if !value.is_empty() => {
                crate::transfer::public_url::base_url(value).map(|u| u.to_string())
            }
            _ => crate::transfer::public_url::build(&p, &bucket, region.as_deref(), key),
        })
        .collect()
}

#[tauri::command]
pub async fn check_public_url(
    bucket: String,
    region: Option<String>,
    key: String,
    url_override: Option<String>,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
) -> Result<String> {
    let p = profile(profile_state.inner(), &expected_profile_id).await?;
    let url = match url_override.filter(|s| !s.is_empty()) {
        Some(value) => crate::transfer::public_url::base_url(&value)?.to_string(),
        None => crate::transfer::public_url::build(&p, &bucket, region.as_deref(), &key)?,
    };
    let response =
        crate::transfer::web::request(&url, reqwest::Method::HEAD, Default::default()).await?;
    Ok(if response.status().is_success() {
        "Anonymous HEAD request succeeded. Access may differ for other users or change later."
            .into()
    } else {
        format!("Anonymous HEAD returned HTTP {}. Access is not confirmed; some hosts do not support HEAD.", response.status().as_u16())
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn queue_url_imports(
    bucket: String,
    region: Option<String>,
    prefix: String,
    entries: Vec<ImportEntry>,
    expected_profile_id: String,
    app_handle: AppHandle,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
) -> Result<usize> {
    if entries.is_empty() || entries.len() > MAX_BATCH {
        return Err(AppError::ConfigError(format!(
            "Import between 1 and {MAX_BATCH} URLs at a time."
        )));
    }
    if bucket.is_empty() || (!prefix.is_empty() && !prefix.ends_with('/')) {
        return Err(AppError::ConfigError("Invalid destination folder.".into()));
    }
    let mut keys = HashSet::new();
    let mut input_size = 0usize;
    for entry in &entries {
        entry.validate()?;
        let key = format!("{prefix}{}", entry.path);
        if key.len() > 1024 || !keys.insert(key) {
            return Err(AppError::ConfigError(
                "Destination keys must be unique and at most 1,024 bytes.".into(),
            ));
        }
        input_size += entry.url.len()
            + entry.path.len()
            + entry
                .headers
                .iter()
                .map(|(k, v)| k.len() + v.len())
                .sum::<usize>();
    }
    if input_size > 2 * 1024 * 1024 {
        return Err(AppError::ConfigError(
            "Import configuration exceeds 2 MiB.".into(),
        ));
    }
    let p = profile(profile_state.inner(), &expected_profile_id).await?;
    let client = {
        let mut s3 = s3_state.write().await;
        match &region {
            Some(r) => s3.get_client_for_region(&p, r).await?.clone(),
            None => s3.get_client(&p).await?.clone(),
        }
    };
    let group = uuid::Uuid::new_v4().to_string();
    let queued = stream::iter(entries.into_iter().map(|entry| {
        let (client, p, bucket, region, prefix, group) = (client.clone(), p.clone(), bucket.clone(), region.clone(), prefix.clone(), group.clone());
        async move {
            let key = format!("{prefix}{}", entry.path);
            // Snapshot replacement approval before any source downloads or S3 writes.
            let expected_etag = if entry.replace {
                match tokio::time::timeout(Duration::from_secs(30), client.head_object().bucket(&bucket).key(&key).send()).await
                    .map_err(|_| AppError::S3Error("Destination check timed out. No imports were queued.".into()))? {
                    Ok(head) => Some(head.e_tag().filter(|v| !v.is_empty()).ok_or_else(|| AppError::ConfigError("Destination has no ETag; safe replacement is unavailable.".into()))?.to_owned()),
                    Err(e) if e.raw_response().is_some_and(|r| r.status().as_u16() == 404) => None,
                    Err(_) => return Err(AppError::S3Error("Cannot verify a replacement destination. Check S3 permissions; no imports were queued.".into())),
                }
            } else { None };
            let mut job = TransferJob::new(TransferType::Upload, p.id.clone(), bucket.clone(), region, key, Default::default(), 0)
                .with_group(group, format!("URL import to s3://{bucket}/{prefix}"));
            job.url_import = Some(UrlSource { max_attempts: entry.max_attempts, url: entry.url, headers: entry.headers, max_bytes: entry.max_bytes, sha256: entry.sha256, expected_etag, profile_identity: p.cache_identity() });
            Ok::<_, AppError>(job)
        }
    })).buffer_unordered(8).try_collect::<Vec<_>>();
    let jobs = tokio::time::timeout(Duration::from_secs(120), queued)
        .await
        .map_err(|_| {
            AppError::S3Error("Destination checks timed out. No imports were queued.".into())
        })??;
    let current = profile(profile_state.inner(), &expected_profile_id).await?;
    if current.cache_identity() != p.cache_identity() {
        return Err(AppError::ConfigError(
            "Connection changed. Review the import again.".into(),
        ));
    }
    let count = jobs.len();
    transfer_state.set_app_handle(app_handle).await;
    transfer_state.add_jobs(jobs).await;
    let (transfers, profiles, s3) = (
        transfer_state.inner().clone(),
        profile_state.inner().clone(),
        s3_state.inner().clone(),
    );
    tauri::async_runtime::spawn(async move {
        transfers.process_queue(s3, profiles).await;
    });
    Ok(count)
}
