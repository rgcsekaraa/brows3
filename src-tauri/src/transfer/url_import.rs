//! HTTP sources are session-only. Never persist signed URLs or authentication headers.
use crate::error::{AppError, Result};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Method,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

pub const MAX_BATCH: usize = 500;
pub const MAX_BYTES: u64 = 5 * 1024_u64.pow(4);
fn default_attempts() -> u8 {
    3
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportEntry {
    #[serde(default = "default_attempts")]
    pub max_attempts: u8,
    pub url: String,
    pub path: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub replace: bool,
    #[serde(default)]
    pub sha256: Option<String>,
    pub max_bytes: u64,
}

pub fn headers(values: &BTreeMap<String, String>) -> Result<HeaderMap> {
    if values.len() > 20 {
        return Err(AppError::ConfigError(
            "At most 20 source headers are allowed.".into(),
        ));
    }
    let mut headers = HeaderMap::new();
    for (name, value) in values {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| AppError::ConfigError("Invalid source header name.".into()))?;
        if matches!(
            name.as_str(),
            "host"
                | "connection"
                | "content-length"
                | "transfer-encoding"
                | "range"
                | "if-range"
                | "accept-encoding"
                | "proxy-authorization"
                | "proxy-connection"
                | "cookie"
                | "upgrade"
                | "te"
                | "trailer"
        ) || value.len() > 8192
        {
            return Err(AppError::ConfigError(
                "Source header is reserved or too long.".into(),
            ));
        }
        let mut value = HeaderValue::from_str(value)
            .map_err(|_| AppError::ConfigError("Invalid source header value.".into()))?;
        value.set_sensitive(true);
        if headers.insert(name, value).is_some() {
            return Err(AppError::ConfigError("Duplicate source header.".into()));
        }
    }
    Ok(headers)
}

impl ImportEntry {
    pub fn validate(&self) -> Result<()> {
        if !(1..=5).contains(&self.max_attempts) {
            return Err(AppError::ConfigError(
                "Download attempts must be between 1 and 5.".into(),
            ));
        }
        let url = super::web::parse_url(&self.url)?;
        if url.fragment().is_some() {
            return Err(AppError::ConfigError(
                "Remove the URL fragment before importing.".into(),
            ));
        }
        if self.path.is_empty()
            || self.path.starts_with('/')
            || self.path.ends_with('/')
            || self.path.contains('\\')
            || self.path.chars().any(char::is_control)
            || self
                .path
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
        {
            return Err(AppError::ConfigError(
                "Enter a relative destination filename/path without empty or dot segments.".into(),
            ));
        }
        if self.max_bytes == 0 || self.max_bytes > MAX_BYTES {
            return Err(AppError::ConfigError(
                "Size limit must be between 1 byte and 5 TiB.".into(),
            ));
        }
        if self
            .sha256
            .as_ref()
            .is_some_and(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(AppError::ConfigError(
                "SHA-256 must contain exactly 64 hexadecimal characters.".into(),
            ));
        }
        headers(&self.headers)?;
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct UrlSource {
    #[serde(default = "default_attempts")]
    pub max_attempts: u8,
    #[serde(skip)]
    pub url: String,
    #[serde(skip)]
    pub headers: BTreeMap<String, String>,
    pub max_bytes: u64,
    pub sha256: Option<String>,
    pub expected_etag: Option<String>,
    pub profile_identity: String,
}
impl std::fmt::Debug for UrlSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UrlSource([redacted])")
    }
}

fn source_status(status: reqwest::StatusCode) -> Result<()> {
    if status.is_success() {
        return Ok(());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        return Err(AppError::S3Error(format!(
            "Source returned HTTP {}. Retry later.",
            status.as_u16()
        )));
    }
    Err(AppError::ConfigError(format!(
        "Source returned HTTP {}. Check access or replace an expired source URL before retrying.",
        status.as_u16()
    )))
}

fn range_total(value: &str, offset: u64) -> Option<u64> {
    let (span, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let (start, end, total): (u64, u64, u64) =
        (start.parse().ok()?, end.parse().ok()?, total.parse().ok()?);
    (start == offset && end >= start && end.checked_add(1) == Some(total)).then_some(total)
}

pub async fn stage(
    source: &UrlSource,
    job: &super::TransferJob,
    manager: &super::TransferManager,
) -> Result<tempfile::NamedTempFile> {
    stage_with_request(source, job, manager, |headers| async move {
        super::web::request(&source.url, Method::GET, headers).await
    })
    .await
}

async fn while_active<T>(
    job: &super::TransferJob,
    manager: &super::TransferManager,
    future: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::pin!(future);
    let mut timer = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            biased;
            _ = timer.tick() => manager.ensure_multipart_job_active(&job.id).await?,
            result = &mut future => return result,
        }
    }
}

async fn stage_with_request<F, Fut>(
    source: &UrlSource,
    job: &super::TransferJob,
    manager: &super::TransferManager,
    request: F,
) -> Result<tempfile::NamedTempFile>
where
    F: Fn(HeaderMap) -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response>>,
{
    if source.url.is_empty() {
        return Err(AppError::ConfigError(
            "Source URLs are not saved. Use Edit source to re-enter the URL after restarting."
                .into(),
        ));
    }
    let temporary = tempfile::NamedTempFile::new()?;
    let mut file = tokio::fs::File::from_std(temporary.reopen()?);
    let mut copied = 0u64;
    let mut expected = None;
    let mut etag: Option<String> = None;
    let mut hasher = Sha256::new();
    let max_attempts = if source.max_attempts == 0 {
        3
    } else {
        source.max_attempts.min(5)
    };
    for attempt in 0..max_attempts {
        manager.ensure_multipart_job_active(&job.id).await?;
        if attempt > 0 {
            manager
                .set_job_phase(&job.id, "Retrying source", expected.unwrap_or(0), copied)
                .await;
            while_active(job, manager, async {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                Ok(())
            })
            .await?;
            manager.ensure_multipart_job_active(&job.id).await?;
        }
        let result: Result<()> = async {
            let mut request_headers = headers(&source.headers)?;
            let resume = copied > 0 && etag.is_some();
            if resume {
                request_headers.insert(reqwest::header::RANGE, HeaderValue::from_str(&format!("bytes={copied}-")).unwrap());
                request_headers.insert(reqwest::header::IF_RANGE, HeaderValue::from_str(etag.as_ref().unwrap()).map_err(|_| AppError::ConfigError("Invalid source ETag.".into()))?);
            }
            let mut response = while_active(job, manager, request(request_headers)).await?;
            source_status(response.status())?;
            if response.headers().get(reqwest::header::CONTENT_ENCODING).is_some_and(|v| v != "identity") {
                return Err(AppError::ConfigError("Source ignored identity encoding; use a direct uncompressed download URL.".into()));
            }
            if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                let total = response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).and_then(|s| range_total(s, copied));
                if !resume || total.is_none() || (expected.is_some() && total != expected)
                    || response.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()) != etag.as_deref() {
                    return Err(AppError::ConfigError("Source changed or returned an invalid resume response. Retry from the beginning.".into()));
                }
                expected = total;
            } else if response.status() == reqwest::StatusCode::OK {
                // Servers without range support restart safely rather than append.
                file.set_len(0).await?; file.rewind().await?;
                copied = 0; hasher = Sha256::new();
                expected = response.content_length();
                etag = response.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()).filter(|s| s.starts_with('"') && s.ends_with('"')).map(str::to_owned);
            } else { return Err(AppError::ConfigError("Source did not return a downloadable file (HTTP 200 or valid 206 required).".into())); }
            if expected.is_some_and(|n| n > source.max_bytes) { return Err(AppError::ConfigError("Source exceeds the configured size limit.".into())); }
            manager.set_job_phase(&job.id, "Fetching source", expected.unwrap_or(0), copied).await;
            loop {
                manager.ensure_multipart_job_active(&job.id).await?;
                let chunk = while_active(job, manager, async { tokio::time::timeout(Duration::from_secs(60), response.chunk()).await
                    .map_err(|_| AppError::S3Error("Source download stalled for 60 seconds.".into()))?
                    .map_err(|_| AppError::S3Error("Source connection ended before the download completed.".into())) }).await?;
                let Some(chunk) = chunk else { break };
                let next = copied.checked_add(chunk.len() as u64).ok_or_else(|| AppError::ConfigError("Source length overflow.".into()))?;
                if next > source.max_bytes || expected.is_some_and(|n| next > n) { return Err(AppError::ConfigError("Source exceeded its declared size or configured size limit.".into())); }
                for bytes in chunk.chunks(16 * 1024) { manager.pace_download(job, bytes.len() as u64).await?; file.write_all(bytes).await?; }
                hasher.update(&chunk); copied = next;
                job.progress.lock().unwrap().position = copied;
            }
            if expected.is_some_and(|n| n != copied) { return Err(AppError::S3Error("Source download was incomplete; nothing was uploaded.".into())); }
            Ok(())
        }.await;
        match result {
            Ok(()) => {
                if source.sha256.as_ref().is_some_and(|digest| {
                    format!("{:x}", hasher.clone().finalize()) != digest.to_ascii_lowercase()
                }) {
                    return Err(AppError::ConfigError(
                        "SHA-256 mismatch. Nothing was uploaded.".into(),
                    ));
                }
                file.flush().await?;
                drop(file);
                manager
                    .set_job_phase(&job.id, "Uploading to S3", copied, 0)
                    .await;
                return Ok(temporary);
            }
            Err(AppError::S3Error(_)) if attempt + 1 < max_attempts => continue,
            Err(error) => return Err(error),
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn download(
        responses: Vec<String>,
        limit: u64,
        sha256: Option<String>,
    ) -> (Result<Vec<u8>>, Vec<String>) {
        let (endpoint, server) = crate::commands::test_s3::scripted_endpoint(responses).await;
        let manager = super::super::TransferManager::new();
        let mut job = super::super::TransferJob::new(
            super::super::TransferType::Upload,
            "profile".into(),
            "bucket".into(),
            None,
            "file".into(),
            Default::default(),
            0,
        );
        job.status = super::super::TransferStatus::InProgress;
        manager.add_job(job.clone()).await;
        let source = UrlSource {
            url: endpoint.clone(),
            max_bytes: limit,
            sha256,
            ..Default::default()
        };
        let result = stage_with_request(&source, &job, &manager, |headers| {
            let endpoint = endpoint.clone();
            async move {
                reqwest::Client::new()
                    .get(endpoint)
                    .headers(headers)
                    .send()
                    .await
                    .map_err(|_| AppError::S3Error("Test source unavailable".into()))
            }
        })
        .await;
        let result = match result {
            Ok(file) => {
                let path = file.path().to_owned();
                let bytes = tokio::fs::read(&path).await.unwrap();
                drop(file);
                assert!(!path.exists());
                Ok(bytes)
            }
            Err(e) => Err(e),
        };
        (result, server.await.unwrap())
    }

    #[tokio::test]
    async fn interrupted_download_resumes_only_with_matching_strong_etag() {
        let first = "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"same\"\r\nConnection: close\r\n\r\nhello".into();
        let second = crate::commands::test_s3::response(
            206,
            "ETag: \"same\"\r\nContent-Range: bytes 5-9/10\r\n",
            "world",
        );
        let (result, requests) = download(
            vec![first, second],
            10,
            Some(format!("{:x}", Sha256::digest(b"helloworld"))),
        )
        .await;
        assert_eq!(result.unwrap(), b"helloworld");
        assert!(requests[1].to_lowercase().contains("range: bytes=5-"));
        assert!(requests[1].to_lowercase().contains("if-range: \"same\""));
    }

    #[tokio::test]
    async fn ignored_range_restarts_instead_of_appending() {
        let first = "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"same\"\r\nConnection: close\r\n\r\nhello".into();
        let second = crate::commands::test_s3::response(200, "ETag: \"new\"\r\n", "replacement");
        let (result, _) = download(vec![first, second], 20, None).await;
        assert_eq!(result.unwrap(), b"replacement");
    }

    #[tokio::test]
    async fn changed_resume_etag_is_rejected_and_missing_etag_restarts() {
        let first = "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nETag: \"same\"\r\nConnection: close\r\n\r\nhello".into();
        let second = crate::commands::test_s3::response(
            206,
            "ETag: \"different\"\r\nContent-Range: bytes 5-9/10\r\n",
            "world",
        );
        let (result, requests) = download(vec![first, second], 10, None).await;
        assert!(result.unwrap_err().to_string().contains("invalid resume"));
        assert_eq!(requests.len(), 2);
        let first =
            "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nhello".into();
        let second = crate::commands::test_s3::response(200, "", "replacement");
        let (result, requests) = download(vec![first, second], 20, None).await;
        assert_eq!(result.unwrap(), b"replacement");
        assert!(!requests[1].to_lowercase().contains("range:"));
    }

    #[tokio::test]
    async fn unknown_length_enforces_stream_limit_and_rejects_compressed_sources() {
        let chunked = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n0\r\n\r\n".to_owned();
        let (result, _) = download(vec![chunked.clone()], 5, None).await;
        assert_eq!(result.unwrap(), b"hello");
        let (result, _) = download(vec![chunked], 4, None).await;
        assert!(result.unwrap_err().to_string().contains("size limit"));
        let (result, _) = download(
            vec![crate::commands::test_s3::response(
                200,
                "Content-Encoding: gzip\r\n",
                "content",
            )],
            20,
            None,
        )
        .await;
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("identity encoding"));
    }

    #[tokio::test]
    async fn transient_errors_retry_and_permanent_errors_do_not() {
        use crate::commands::test_s3::response;
        let (result, requests) = download(
            vec![response(503, "", ""), response(200, "", "ok")],
            10,
            None,
        )
        .await;
        assert_eq!(result.unwrap(), b"ok");
        assert_eq!(requests.len(), 2);
        let (result, requests) = download(vec![response(403, "", "")], 10, None).await;
        assert!(result.unwrap_err().to_string().contains("403"));
        assert_eq!(requests.len(), 1);
    }

    #[tokio::test]
    async fn limits_and_checksums_fail_before_s3_upload() {
        use crate::commands::test_s3::response;
        let (result, _) = download(vec![response(200, "", "too large")], 2, None).await;
        assert!(result.unwrap_err().to_string().contains("size limit"));
        let (result, _) =
            download(vec![response(200, "", "content")], 20, Some("0".repeat(64))).await;
        assert!(result.unwrap_err().to_string().contains("SHA-256 mismatch"));
    }

    #[tokio::test]
    async fn cancelled_job_never_contacts_the_source() {
        let manager = super::super::TransferManager::new();
        let mut job = super::super::TransferJob::new(
            super::super::TransferType::Upload,
            "p".into(),
            "b".into(),
            None,
            "k".into(),
            Default::default(),
            0,
        );
        job.status = super::super::TransferStatus::Cancelled;
        manager.add_job(job.clone()).await;
        let source = UrlSource {
            url: "https://example.com/a".into(),
            max_bytes: 10,
            ..Default::default()
        };
        assert!(stage_with_request(&source, &job, &manager, |_| async {
            panic!("cancelled source must not be requested")
        })
        .await
        .is_err());
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_stalled_source_request() {
        let manager = super::super::TransferManager::new();
        let mut job = super::super::TransferJob::new(
            super::super::TransferType::Upload,
            "p".into(),
            "b".into(),
            None,
            "k".into(),
            Default::default(),
            0,
        );
        job.status = super::super::TransferStatus::InProgress;
        manager.add_job(job.clone()).await;
        let source = UrlSource {
            url: "https://example.com/a".into(),
            max_bytes: 10,
            ..Default::default()
        };
        let started = tokio::sync::Notify::new();
        let download = stage_with_request(&source, &job, &manager, |_| async {
            started.notify_one();
            std::future::pending::<Result<reqwest::Response>>().await
        });
        let cancel = async {
            started.notified().await;
            assert!(manager.cancel_job(&job.id).await);
        };
        let (result, _) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(download, cancel)
        })
        .await
        .expect("cancel must interrupt a stalled request promptly");
        assert!(result.is_err());
    }
    #[test]
    fn source_secrets_never_serialize_or_debug() {
        let source = UrlSource {
            url: "https://example.com/?token=secret".into(),
            headers: BTreeMap::from([("Authorization".into(), "secret".into())]),
            ..Default::default()
        };
        let json = serde_json::to_string(&source).unwrap();
        assert!(!json.contains("secret"));
        assert!(!format!("{source:?}").contains("secret"));
        assert!(serde_json::from_str::<UrlSource>(&json)
            .unwrap()
            .url
            .is_empty());
    }
    #[test]
    fn validates_headers_paths_checksums_and_ranges() {
        let mut entry = ImportEntry {
            max_attempts: 3,
            url: "https://example.com/a".into(),
            path: "a.txt".into(),
            headers: BTreeMap::new(),
            replace: false,
            sha256: None,
            max_bytes: 100,
        };
        assert!(entry.validate().is_ok());
        for path in ["../a", "/a", "a//b", "a/", "a\\b"] {
            entry.path = path.into();
            assert!(entry.validate().is_err());
        }
        assert!(headers(&BTreeMap::from([("Host".into(), "evil".into())])).is_err());
        assert_eq!(range_total("bytes 5-9/10", 5), Some(10));
        assert_eq!(range_total("bytes 0-9/10", 5), None);
        assert_eq!(range_total("bytes 5-8/10", 5), None);
    }
}
