//! Cross-profile copies stage one object on private temporary disk, never in RAM.
use crate::error::{AppError, Result};
use aws_sdk_s3::{operation::head_object::HeadObjectOutput, Client};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSource {
    pub profile_id: String,
    pub profile_identity: String,
    pub destination_identity: String,
    pub bucket: String,
    pub region: String,
    pub key: String,
    pub etag: String,
    pub size: u64,
    #[serde(skip)]
    pub current_session: bool,
}

impl RemoteSource {
    pub fn validate_profiles(
        &self,
        source: &crate::credentials::Profile,
        destination: &crate::credentials::Profile,
    ) -> Result<()> {
        if !self.current_session
            || self.profile_identity != source.cache_identity()
            || self.destination_identity != destination.cache_identity()
        {
            return Err(AppError::ConfigError(
                "Copy profile settings changed or the app restarted. Copy the objects again."
                    .into(),
            ));
        }
        Ok(())
    }
}

pub fn validate_head(head: &HeadObjectOutput) -> Result<(String, u64)> {
    if head.sse_customer_algorithm().is_some() {
        return Err(AppError::ConfigError(
            "SSE-C objects cannot be copied between profiles.".into(),
        ));
    }
    let etag = head
        .e_tag()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::S3Error("Source has no ETag; safe copy is unavailable.".into()))?;
    let size = head
        .content_length()
        .filter(|n| *n >= 0)
        .ok_or_else(|| AppError::S3Error("Source has no valid content length.".into()))?
        as u64;
    if size > 0 {
        crate::s3::plan_multipart_upload(size)?;
    }
    Ok((etag.to_owned(), size))
}

pub async fn stage(
    client: &Client,
    source: &RemoteSource,
    job: &super::TransferJob,
    manager: &super::TransferManager,
) -> Result<(tempfile::NamedTempFile, super::sync::Attributes)> {
    let mut output = tokio::time::timeout(
        Duration::from_secs(60),
        client
            .get_object()
            .bucket(&source.bucket)
            .key(&source.key)
            .if_match(&source.etag)
            .send(),
    )
    .await
    .map_err(|_| AppError::S3Error("Reading the source timed out.".into()))?
    .map_err(|e| AppError::S3Error(format!("Cannot read source object: {e}")))?;
    if output.e_tag() != Some(source.etag.as_str())
        || output.content_length() != Some(source.size as i64)
    {
        return Err(AppError::S3Error(
            "Source changed since the copy was queued. Copy again.".into(),
        ));
    }
    // Only portable content metadata is copied. Destination defaults determine
    // ownership, storage class, encryption and retention, never source account IDs.
    let head = HeadObjectOutput::builder()
        .set_content_type(output.content_type.clone())
        .set_cache_control(output.cache_control.clone())
        .set_content_disposition(output.content_disposition.clone())
        .set_content_encoding(output.content_encoding.clone())
        .set_content_language(output.content_language.clone())
        .set_metadata(output.metadata.clone())
        .build();
    let temporary = tempfile::NamedTempFile::new()?;
    let mut file = tokio::fs::File::from_std(temporary.reopen()?);
    let mut copied = 0u64;
    loop {
        manager.ensure_multipart_job_active(&job.id).await?;
        let chunk = tokio::time::timeout(Duration::from_secs(60), output.body.next())
            .await
            .map_err(|_| AppError::S3Error("Source download stalled for 60 seconds.".into()))?;
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|e| AppError::S3Error(e.to_string()))?;
        copied = copied
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| AppError::S3Error("Source length overflow".into()))?;
        if copied > source.size {
            return Err(AppError::S3Error(
                "Source exceeded its declared size.".into(),
            ));
        }
        file.write_all(&chunk).await?;
        job.progress.lock().unwrap().position = copied;
    }
    if copied != source.size {
        return Err(AppError::S3Error(
            "Source download was incomplete; nothing was uploaded.".into(),
        ));
    }
    file.flush().await?;
    drop(file);
    Ok((
        temporary,
        super::sync::Attributes {
            head,
            acl: None,
            tags: None,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edited_profiles_and_recovered_sources_are_rejected() {
        use crate::credentials::{CredentialType, Profile};
        let mut source = Profile::new("source".into(), CredentialType::Environment, None);
        let mut destination = Profile::new("destination".into(), CredentialType::Environment, None);
        let remote = RemoteSource {
            profile_id: source.id.clone(),
            profile_identity: source.cache_identity(),
            destination_identity: destination.cache_identity(),
            bucket: "bucket".into(),
            region: "us-east-1".into(),
            key: "key".into(),
            etag: "etag".into(),
            size: 5,
            current_session: true,
        };
        assert!(remote.validate_profiles(&source, &destination).is_ok());
        let recovered: RemoteSource =
            serde_json::from_str(&serde_json::to_string(&remote).unwrap()).unwrap();
        assert!(recovered.validate_profiles(&source, &destination).is_err());
        let original_source = source.clone();
        source.updated_at = None;
        assert!(remote.validate_profiles(&source, &destination).is_err());
        destination.updated_at = None;
        assert!(remote
            .validate_profiles(&original_source, &destination)
            .is_err());
    }
    #[test]
    fn preflight_requires_etag_valid_length_and_supported_encryption() {
        assert!(validate_head(
            &HeadObjectOutput::builder()
                .content_length(0)
                .e_tag("empty")
                .build()
        )
        .is_ok());
        assert!(validate_head(&HeadObjectOutput::builder().content_length(5).build()).is_err());
        assert!(validate_head(
            &HeadObjectOutput::builder()
                .content_length(-1)
                .e_tag("x")
                .build()
        )
        .is_err());
        assert!(validate_head(
            &HeadObjectOutput::builder()
                .content_length(5)
                .e_tag("x")
                .sse_customer_algorithm("AES256")
                .build()
        )
        .is_err());
    }
}
