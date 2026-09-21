use crate::error::{AppError, Result};
use aws_sdk_s3::{types::Object, Client};
use std::collections::HashSet;

/// Bounded preflight: callers must finish enumeration before mutating anything.
pub async fn list_recursive(client: &Client, bucket: &str, prefix: &str) -> Result<Vec<Object>> {
    tokio::time::timeout(std::time::Duration::from_secs(120), async {
        let mut objects = Vec::new();
        let mut token = None;
        let mut seen = HashSet::new();
        for _ in 0..100 {
            let page = client
                .list_objects_v2()
                .bucket(bucket)
                .prefix(prefix)
                .max_keys(1000)
                .set_continuation_token(token)
                .send()
                .await
                .map_err(|error| AppError::S3Error(error.to_string()))?;
            objects.extend_from_slice(page.contents());
            if objects.len() > 100_000 {
                return Err(AppError::ConfigError(
                    "Folder exceeds 100,000 objects. Select a smaller prefix.".into(),
                ));
            }
            if !page.is_truncated().unwrap_or(false) {
                return Ok(objects);
            }
            let next = page
                .next_continuation_token()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::S3Error("Incomplete listing: missing continuation token".into())
                })?;
            if !seen.insert(next.to_string()) {
                return Err(AppError::S3Error(
                    "Incomplete listing: repeated continuation token".into(),
                ));
            }
            token = Some(next.to_string());
        }
        Err(AppError::ConfigError(
            "Folder exceeds 100 listing pages. Select a smaller prefix.".into(),
        ))
    })
    .await
    .map_err(|_| {
        AppError::S3Error("Folder listing timed out; nothing was queued or changed.".into())
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_s3::{response, scripted_client};

    #[tokio::test]
    async fn incomplete_and_repeated_cursors_fail_preflight() {
        for pages in [vec!["<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"],
            vec!["<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken></ListBucketResult>"; 2]] {
            let (client, server) = scripted_client(pages.into_iter().map(|body| response(200, "", body)).collect()).await;
            assert!(list_recursive(&client, "bucket", "folder/").await.is_err());
            server.await.unwrap();
        }
    }
}
