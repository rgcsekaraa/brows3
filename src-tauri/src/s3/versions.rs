use crate::error::{AppError, Result};
use aws_sdk_s3::{error::DisplayErrorContext, Client};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Cursor {
    pub key_marker: String,
    pub version_id_marker: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Version {
    pub version_id: String,
    pub is_latest: bool,
    pub is_delete_marker: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub etag: Option<String>,
}
#[derive(Serialize)]
pub struct History {
    pub versioning: String,
    pub versions: Vec<Version>,
    pub next: Option<Cursor>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RestoreGuard {
    pub current_version: String,
    pub current_etag: Option<String>,
    pub deleted: bool,
}

pub async fn versioning(client: &Client, bucket: &str) -> Result<String> {
    let output = client.get_bucket_versioning().bucket(bucket).send().await
        .map_err(|e| AppError::S3Error(format!("Cannot read bucket versioning. Check GetBucketVersioning permission and provider support: {}", DisplayErrorContext(&e))))?;
    Ok(output
        .status()
        .map_or("Disabled", |s| s.as_str())
        .to_owned())
}
pub fn validate_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > 1024 {
        return Err(AppError::ConfigError(
            "Enter an exact object key of 1 to 1,024 bytes.".into(),
        ));
    }
    Ok(())
}
pub async fn page(
    client: &Client,
    bucket: &str,
    key: &str,
    cursor: Option<Cursor>,
    limit: i32,
) -> Result<(Vec<Version>, Option<Cursor>)> {
    validate_key(key)?;
    if cursor
        .as_ref()
        .is_some_and(|c| c.key_marker != key || c.version_id_marker.is_empty())
    {
        return Err(AppError::ConfigError(
            "Invalid history cursor. Load the history again.".into(),
        ));
    }
    let output = client.list_object_versions().bucket(bucket).prefix(key).max_keys(limit)
        .set_key_marker(cursor.as_ref().map(|c| c.key_marker.clone()))
        .set_version_id_marker(cursor.as_ref().map(|c| c.version_id_marker.clone())).send().await
        .map_err(|e| AppError::S3Error(format!("Cannot list versions. Check ListBucketVersions permission and provider support: {}", DisplayErrorContext(&e))))?;
    let mut versions = Vec::new();
    for v in output.versions().iter().filter(|v| v.key() == Some(key)) {
        versions.push(Version {
            version_id: required_id(v.version_id())?,
            is_latest: v.is_latest().unwrap_or(false),
            is_delete_marker: false,
            size: v.size().and_then(|n| u64::try_from(n).ok()),
            modified: v.last_modified().map(ToString::to_string),
            etag: v.e_tag.clone(),
        });
    }
    for v in output
        .delete_markers()
        .iter()
        .filter(|v| v.key() == Some(key))
    {
        versions.push(Version {
            version_id: required_id(v.version_id())?,
            is_latest: v.is_latest().unwrap_or(false),
            is_delete_marker: true,
            size: None,
            modified: v.last_modified().map(ToString::to_string),
            etag: None,
        });
    }
    versions.sort_by(|a, b| {
        b.is_latest
            .cmp(&a.is_latest)
            .then_with(|| b.modified.cmp(&a.modified))
            .then_with(|| a.version_id.cmp(&b.version_id))
    });
    let next = if output.is_truncated().unwrap_or(false) {
        let marker = output
            .next_key_marker()
            .filter(|m| !m.is_empty())
            .ok_or_else(|| AppError::S3Error("Incomplete history: missing key marker.".into()))?;
        if marker < key {
            return Err(AppError::S3Error("History cursor moved backwards.".into()));
        }
        if marker == key {
            let next = Cursor {
                key_marker: marker.into(),
                version_id_marker: required_id(output.next_version_id_marker())?,
            };
            if cursor.as_ref() == Some(&next) {
                return Err(AppError::S3Error(
                    "History cursor repeated. Refresh the history.".into(),
                ));
            }
            Some(next)
        } else {
            None
        }
    } else {
        None
    };
    Ok((versions, next))
}
fn required_id(id: Option<&str>) -> Result<String> {
    id.filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::S3Error("Provider returned a version without an ID.".into()))
}
pub async fn current(client: &Client, bucket: &str, key: &str) -> Result<Version> {
    let (versions, _) = page(client, bucket, key, None, 1).await?;
    let mut latest = versions.into_iter().filter(|v| v.is_latest);
    let result = latest.next().ok_or_else(|| {
        AppError::S3Error(
            "Current version is unavailable. Refresh history before restoring.".into(),
        )
    })?;
    if latest.next().is_some() {
        return Err(AppError::S3Error(
            "Provider returned multiple current versions.".into(),
        ));
    }
    Ok(result)
}
pub async fn validate_restore(
    client: &Client,
    bucket: &str,
    key: &str,
    guard: &RestoreGuard,
) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(60), async {
        if versioning(client, bucket).await? != "Enabled" {
            return Err(AppError::ConfigError(
                "Restore requires enabled bucket versioning. Nothing was restored.".into(),
            ));
        }
        let latest = current(client, bucket, key).await?;
        if latest.version_id != guard.current_version
            || latest.is_delete_marker != guard.deleted
            || (!guard.deleted && latest.etag != guard.current_etag)
        {
            return Err(AppError::ConfigError(
                "Current version changed. Refresh history and confirm the restore again.".into(),
            ));
        }
        if !guard.deleted && guard.current_etag.as_ref().is_none_or(|e| e.is_empty()) {
            return Err(AppError::S3Error(
                "Current object has no ETag; safe restore is unavailable.".into(),
            ));
        }
        Ok(())
    })
    .await
    .map_err(|_| AppError::S3Error("Checking restore safety timed out.".into()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_s3::{response, scripted_client};
    pub(crate) fn listing(version: &str, deleted: bool) -> String {
        let tag = if deleted { "DeleteMarker" } else { "Version" };
        format!("<ListVersionsResult><IsTruncated>false</IsTruncated><{tag}><Key>file</Key><VersionId>{version}</VersionId><IsLatest>true</IsLatest><ETag>&quot;current&quot;</ETag><Size>5</Size></{tag}></ListVersionsResult>")
    }
    #[tokio::test]
    async fn exact_key_history_includes_markers_and_paginates_without_nearby_keys() {
        let first = "<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>file</NextKeyMarker><NextVersionIdMarker>old+1</NextVersionIdMarker><Version><Key>file</Key><VersionId>old+1</VersionId><IsLatest>false</IsLatest><Size>0</Size></Version><Version><Key>file-other</Key><VersionId>ignore</VersionId></Version><DeleteMarker><Key>file</Key><VersionId>deleted</VersionId><IsLatest>true</IsLatest></DeleteMarker></ListVersionsResult>";
        let second = "<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>file-other</NextKeyMarker><NextVersionIdMarker>x</NextVersionIdMarker><Version><Key>file</Key><VersionId>null</VersionId><IsLatest>false</IsLatest><Size>9</Size></Version></ListVersionsResult>";
        let (client, server) =
            scripted_client(vec![response(200, "", first), response(200, "", second)]).await;
        let (items, next) = page(&client, "bucket", "file", None, 100).await.unwrap();
        assert_eq!(items.len(), 2);
        assert!(items[0].is_delete_marker && items[0].is_latest);
        assert_eq!(items[1].size, Some(0));
        let (items, next) = page(&client, "bucket", "file", next, 100).await.unwrap();
        assert_eq!(items[0].version_id, "null");
        assert!(next.is_none());
        let requests = server.await.unwrap();
        assert!(requests[1].contains("version-id-marker=old%2B1"));
        assert!(requests.iter().all(|r| r.starts_with("GET ")));
    }
    #[tokio::test]
    async fn malformed_or_repeated_history_cursors_fail() {
        for body in [
            "<ListVersionsResult><IsTruncated>true</IsTruncated></ListVersionsResult>",
            "<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>file</NextKeyMarker><NextVersionIdMarker>same</NextVersionIdMarker></ListVersionsResult>",
            "<ListVersionsResult><Version><Key>file</Key></Version></ListVersionsResult>",
        ] {
            let (client, server) = scripted_client(vec![response(200, "", body)]).await;
            assert!(page(&client, "bucket", "file", Some(Cursor { key_marker: "file".into(), version_id_marker: "same".into() }), 100).await.is_err());
            assert_eq!(server.await.unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn restore_refuses_disabled_suspended_changed_and_denied_state() {
        let guard = RestoreGuard {
            current_version: "current-id".into(),
            current_etag: Some("\"current\"".into()),
            deleted: false,
        };
        for status in ["Suspended", ""] {
            let (client, server) = scripted_client(vec![response(
                200,
                "",
                &format!(
                    "<VersioningConfiguration><Status>{status}</Status></VersioningConfiguration>"
                ),
            )])
            .await;
            assert!(validate_restore(&client, "bucket", "file", &guard)
                .await
                .is_err());
            assert_eq!(server.await.unwrap().len(), 1);
        }
        let (client, server) = scripted_client(vec![
            response(
                200,
                "",
                "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>",
            ),
            response(200, "", &listing("new-id", false)),
        ])
        .await;
        assert!(validate_restore(&client, "bucket", "file", &guard)
            .await
            .unwrap_err()
            .to_string()
            .contains("changed"));
        assert!(server.await.unwrap().iter().all(|r| r.starts_with("GET ")));
        let (client, server) = scripted_client(vec![response(
            403,
            "",
            "<Error><Code>AccessDenied</Code></Error>",
        )])
        .await;
        assert!(versioning(&client, "bucket")
            .await
            .unwrap_err()
            .to_string()
            .contains("AccessDenied"));
        assert_eq!(server.await.unwrap().len(), 1);
    }
}
