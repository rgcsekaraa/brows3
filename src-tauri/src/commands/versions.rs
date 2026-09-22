use super::{profiles::ProfileState, transfer::TransferState};
use crate::{
    credentials::Profile,
    error::{AppError, Result},
    s3::{
        versions::{self, Cursor, History, RestoreGuard},
        S3State,
    },
    transfer::{
        remote::{self, RemoteSource},
        TransferJob, TransferStatus, TransferType,
    },
};
use aws_sdk_s3::{error::DisplayErrorContext, Client};
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, State};

async fn selected(profiles: &ProfileState, expected: &str) -> Result<Profile> {
    let profile = profiles
        .read()
        .await
        .get_active_profile()
        .await?
        .ok_or_else(|| AppError::ConfigError("Select a profile.".into()))?;
    super::operations::validate_operation_profile(Some(expected), &profile.id)?;
    Ok(profile)
}
async fn client(s3: &S3State, profile: &Profile, region: &str) -> Result<Client> {
    Ok(s3
        .write()
        .await
        .get_client_for_region(profile, region)
        .await?
        .clone())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn list_object_versions(
    bucket: String,
    region: String,
    key: String,
    cursor: Option<Cursor>,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<History> {
    versions::validate_key(&key)?;
    let profile = selected(profile_state.inner(), &expected_profile_id).await?;
    let client = client(s3_state.inner(), &profile, &region).await?;
    let result = tokio::time::timeout(Duration::from_secs(60), async {
        let versioning = versions::versioning(&client, &bucket).await?;
        let (versions, next) = versions::page(&client, &bucket, &key, cursor, 100).await?;
        Ok::<_, AppError>(History {
            versioning,
            versions,
            next,
        })
    })
    .await
    .map_err(|_| AppError::S3Error("Loading history timed out. Try again.".into()))??;
    if selected(profile_state.inner(), &expected_profile_id)
        .await?
        .cache_identity()
        != profile.cache_identity()
    {
        return Err(AppError::ConfigError(
            "Profile settings changed. Load history again.".into(),
        ));
    }
    Ok(result)
}

pub(crate) async fn prepare_restore(
    client: &Client,
    bucket: &str,
    key: &str,
    version_id: &str,
    expected_current_version: &str,
    confirmed: bool,
) -> Result<(RestoreGuard, String, u64)> {
    versions::validate_key(key)?;
    if !confirmed
        || version_id.is_empty()
        || expected_current_version.is_empty()
        || version_id == expected_current_version
    {
        return Err(AppError::ConfigError(
            "Select an older data version and confirm the restore.".into(),
        ));
    }
    tokio::time::timeout(Duration::from_secs(60), async {
        let latest = versions::current(client, bucket, key).await?;
        let guard = RestoreGuard { current_version: expected_current_version.into(), current_etag: latest.etag, deleted: latest.is_delete_marker };
        versions::validate_restore(client, bucket, key, &guard).await?;
        let head = client.head_object().bucket(bucket).key(key).version_id(version_id).send().await
            .map_err(|e| AppError::S3Error(format!("Cannot restore this version. Delete markers, archived or inaccessible versions cannot be read: {}", DisplayErrorContext(&e))))?;
        if head.delete_marker().unwrap_or(false) || head.version_id() != Some(version_id) {
            return Err(AppError::S3Error("Provider did not return the selected data version.".into()));
        }
        let (etag, size) = remote::validate_head(&head)?;
        Ok((guard, etag, size))
    }).await.map_err(|_| AppError::S3Error("Restore preparation timed out; nothing was queued.".into()))?
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn restore_object_version(
    bucket: String,
    region: String,
    key: String,
    version_id: String,
    expected_current_version: String,
    confirmed: bool,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
    transfer_state: State<'_, TransferState>,
    app_handle: AppHandle,
) -> Result<String> {
    let profile = selected(profile_state.inner(), &expected_profile_id).await?;
    let client = client(s3_state.inner(), &profile, &region).await?;
    let (guard, etag, size) = prepare_restore(
        &client,
        &bucket,
        &key,
        &version_id,
        &expected_current_version,
        confirmed,
    )
    .await?;
    if selected(profile_state.inner(), &expected_profile_id)
        .await?
        .cache_identity()
        != profile.cache_identity()
    {
        return Err(AppError::ConfigError(
            "Profile settings changed. Refresh history and confirm again.".into(),
        ));
    }
    let mut job = TransferJob::new(
        TransferType::Upload,
        profile.id.clone(),
        bucket.clone(),
        Some(region.clone()),
        key.clone(),
        PathBuf::new(),
        size * 2,
    )
    .with_group(uuid::Uuid::new_v4().to_string(), "Version restore".into());
    job.remote_source = Some(RemoteSource {
        profile_id: profile.id.clone(),
        profile_identity: profile.cache_identity(),
        destination_identity: profile.cache_identity(),
        bucket,
        region,
        key,
        etag,
        size,
        version_id: Some(version_id),
        current_session: true,
    });
    job.restore_guard = Some(guard);
    let id = job.id.clone();
    transfer_state.set_app_handle(app_handle).await;
    transfer_state.add_job(job).await;
    if let Some(job) = transfer_state.get_job(&id).await {
        if let TransferStatus::Failed(error) = job.status {
            return Err(AppError::IoError(error));
        }
    }
    transfer_state
        .inner()
        .clone()
        .process_queue(s3_state.inner().clone(), profile_state.inner().clone())
        .await;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_s3::{response, scripted_client};
    #[tokio::test]
    async fn restore_requires_confirmation_and_a_different_version_before_requests() {
        let (client, server) = scripted_client(vec![]).await;
        assert!(
            prepare_restore(&client, "bucket", "file", "older", "current", false)
                .await
                .is_err()
        );
        assert!(
            prepare_restore(&client, "bucket", "file", "current", "current", true)
                .await
                .is_err()
        );
        assert!(server.await.unwrap().is_empty());
    }
    #[tokio::test]
    async fn restore_preflight_pins_selected_version_and_never_writes() {
        let listing = "<ListVersionsResult><IsTruncated>false</IsTruncated><Version><Key>file</Key><VersionId>current</VersionId><IsLatest>true</IsLatest><ETag>&quot;now&quot;</ETag></Version></ListVersionsResult>";
        for returned_version in ["old+version", "wrong"] {
            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nETag: \"old\"\r\nx-amz-version-id: {returned_version}\r\nConnection: close\r\n\r\n");
            let (client, server) = scripted_client(vec![
                response(200, "", listing),
                response(
                    200,
                    "",
                    "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>",
                ),
                response(200, "", listing),
                head,
            ])
            .await;
            let prepared =
                prepare_restore(&client, "bucket", "file", "old+version", "current", true).await;
            if returned_version == "old+version" {
                let (guard, etag, size) = prepared.unwrap();
                assert_eq!(guard.current_etag.as_deref(), Some("\"now\""));
                assert_eq!(etag, "\"old\"");
                assert_eq!(size, 5);
            } else {
                assert!(prepared.is_err());
            }
            let requests = server.await.unwrap();
            assert!(requests.last().unwrap().contains("versionId=old%2Bversion"));
            assert!(requests
                .iter()
                .all(|r| r.starts_with("GET ") || r.starts_with("HEAD ")));
        }
    }
}
