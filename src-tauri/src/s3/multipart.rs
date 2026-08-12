use crate::error::{AppError, Result};
use aws_sdk_s3::Client;

const MIB: u64 = 1024 * 1024;
const DEFAULT_PART_SIZE: u64 = 128 * MIB;
const MIN_PART_SIZE: u64 = 5 * MIB;
const MAX_PART_SIZE: u64 = 5 * 1024 * MIB;
const MAX_PARTS: u64 = 10_000;
const MAX_OBJECT_SIZE: u64 = 50_000_000_000_000;

/// AWS recommends considering multipart upload at 100 MB. Starting here also
/// gives large uploads retryable chunks instead of restarting the whole file.
pub const MULTIPART_UPLOAD_THRESHOLD: u64 = 100 * MIB;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MultipartPart {
    pub number: i32,
    pub offset: u64,
    pub length: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultipartPlan {
    pub part_size: u64,
    pub parts: Vec<MultipartPart>,
}

pub fn plan_multipart_upload(object_size: u64) -> Result<MultipartPlan> {
    if object_size == 0 {
        return Err(AppError::ConfigError(
            "Cannot create a multipart upload for an empty object".to_string(),
        ));
    }
    if object_size > MAX_OBJECT_SIZE {
        return Err(AppError::ConfigError(format!(
            "Object size {object_size} bytes exceeds the S3 multipart object limit of {MAX_OBJECT_SIZE} bytes"
        )));
    }

    let minimum_for_part_limit = object_size.div_ceil(MAX_PARTS);
    let part_size = round_up_to_mib(DEFAULT_PART_SIZE.max(minimum_for_part_limit));
    if !(MIN_PART_SIZE..=MAX_PART_SIZE).contains(&part_size) {
        return Err(AppError::ConfigError(format!(
            "No valid S3 multipart part size is available for an object of {object_size} bytes"
        )));
    }

    let part_count = object_size.div_ceil(part_size);
    if part_count > MAX_PARTS {
        return Err(AppError::ConfigError(format!(
            "Multipart upload would require {part_count} parts, exceeding the S3 limit of {MAX_PARTS}"
        )));
    }

    let mut parts = Vec::with_capacity(part_count as usize);
    for index in 0..part_count {
        let offset = index * part_size;
        parts.push(MultipartPart {
            number: (index + 1) as i32,
            offset,
            length: (object_size - offset).min(part_size),
        });
    }

    Ok(MultipartPlan { part_size, parts })
}

fn round_up_to_mib(value: u64) -> u64 {
    value.div_ceil(MIB) * MIB
}

/// Owns an in-progress multipart upload. Explicit error paths await abort;
/// cancellation and task panics still trigger a best-effort asynchronous abort.
pub struct MultipartUploadGuard {
    client: Client,
    bucket: String,
    key: String,
    upload_id: Option<String>,
}

impl MultipartUploadGuard {
    pub fn new(client: Client, bucket: &str, key: &str, upload_id: String) -> Self {
        Self {
            client,
            bucket: bucket.to_string(),
            key: key.to_string(),
            upload_id: Some(upload_id),
        }
    }

    pub fn upload_id(&self) -> &str {
        self.upload_id
            .as_deref()
            .expect("multipart upload guard must be armed")
    }

    pub fn disarm(&mut self) {
        self.upload_id = None;
    }

    pub async fn abort(&mut self) -> Result<()> {
        let Some(upload_id) = self.upload_id.take() else {
            return Ok(());
        };

        self.client
            .abort_multipart_upload()
            .bucket(&self.bucket)
            .key(&self.key)
            .upload_id(&upload_id)
            .send()
            .await
            .map_err(|error| {
                AppError::S3Error(format!(
                    "Failed to abort multipart upload {upload_id} for s3://{}/{}: {error}",
                    self.bucket, self.key
                ))
            })?;

        Ok(())
    }
}

impl Drop for MultipartUploadGuard {
    fn drop(&mut self) {
        let Some(upload_id) = self.upload_id.take() else {
            return;
        };
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            log::error!(
                "Could not schedule abort for multipart upload {} because no Tokio runtime is available",
                upload_id
            );
            return;
        };

        let client = self.client.clone();
        let bucket = self.bucket.clone();
        let key = self.key.clone();
        runtime.spawn(async move {
            if let Err(error) = client
                .abort_multipart_upload()
                .bucket(&bucket)
                .key(&key)
                .upload_id(&upload_id)
                .send()
                .await
            {
                log::error!(
                    "Best-effort abort failed for multipart upload {} at s3://{}/{}: {}",
                    upload_id,
                    bucket,
                    key,
                    error
                );
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        plan_multipart_upload, DEFAULT_PART_SIZE, MAX_OBJECT_SIZE, MAX_PARTS, MAX_PART_SIZE,
        MIN_PART_SIZE,
    };

    #[test]
    fn plans_normal_large_uploads_with_contiguous_parts() {
        let size = 14_700_000_000;
        let plan = plan_multipart_upload(size).unwrap();

        assert_eq!(plan.part_size, DEFAULT_PART_SIZE);
        assert!(plan.parts.len() > 1);
        assert!(plan.parts.len() <= MAX_PARTS as usize);
        assert_eq!(plan.parts.first().unwrap().offset, 0);
        assert_eq!(plan.parts.last().unwrap().number, plan.parts.len() as i32);
        assert_eq!(plan.parts.iter().map(|part| part.length).sum::<u64>(), size);

        for pair in plan.parts.windows(2) {
            assert_eq!(pair[0].offset + pair[0].length, pair[1].offset);
            assert!(pair[0].length >= MIN_PART_SIZE);
        }
    }

    #[test]
    fn increases_part_size_without_exceeding_s3_limits() {
        let plan = plan_multipart_upload(MAX_OBJECT_SIZE).unwrap();

        assert!(plan.part_size <= MAX_PART_SIZE);
        assert!(plan.parts.len() <= MAX_PARTS as usize);
        assert_eq!(
            plan.parts.iter().map(|part| part.length).sum::<u64>(),
            MAX_OBJECT_SIZE
        );
    }

    #[test]
    fn rejects_empty_and_oversized_objects() {
        assert!(plan_multipart_upload(0).is_err());
        assert!(plan_multipart_upload(MAX_OBJECT_SIZE + 1).is_err());
    }
}
