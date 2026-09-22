//! Local-to-S3 sync primitives. Only an explicitly accepted preview can create sync jobs.
use crate::commands::operations::{
    classify_acl_error, copy_acl_headers, encode_object_tags, s3_error_message, CopyAclHeaders,
};
use crate::error::{AppError, Result};
use aws_sdk_s3::{operation::head_object::HeadObjectOutput, Client};
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

pub const MAX_FILES: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSource {
    pub profile_identity: String,
    #[serde(skip)]
    pub current_session: bool,
    pub root: PathBuf,
    pub relative: PathBuf,
    pub sha256: String,
    pub size: u64,
    pub expected_etag: Option<String>,
}

#[derive(Clone)]
pub struct LocalFile {
    pub source: SyncSource,
    pub key: String,
    pub md5: String,
}

fn io_error(error: impl std::fmt::Display) -> AppError {
    AppError::IoError(error.to_string())
}

// Capability-relative opens cannot escape the selected root, even if a parent is replaced
// with a symlink after enumeration. Non-regular files and symlinks are rejected up front.
fn open_source(root: &Dir, relative: &Path) -> Result<cap_std::fs::File> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(io_error("Invalid relative sync path"));
    }
    let metadata = root.symlink_metadata(relative).map_err(io_error)?;
    if !metadata.is_file() || metadata.is_symlink() {
        return Err(io_error("Sync accepts regular files only"));
    }
    let file = root.open(relative).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(io_error("Sync source is not a regular file"));
    }
    Ok(file)
}

fn hash_file(
    mut file: cap_std::fs::File,
    mut output: Option<&mut std::fs::File>,
    deadline: Instant,
) -> Result<(u64, String, String)> {
    let mut sha = Sha256::new();
    let mut md5 = md5::Md5::new();
    let mut bytes = 0;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        if Instant::now() > deadline {
            return Err(io_error(
                "Local sync scan timed out. Choose a smaller folder.",
            ));
        }
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        sha.update(&buffer[..read]);
        md5.update(&buffer[..read]);
        bytes += read as u64;
        if let Some(target) = output.as_deref_mut() {
            target.write_all(&buffer[..read]).map_err(io_error)?;
        }
    }
    Ok((
        bytes,
        format!("{:x}", sha.finalize()),
        format!("{:x}", md5.finalize()),
    ))
}

pub fn scan(root: &Path, prefix: &str) -> Result<Vec<LocalFile>> {
    if !root.is_absolute()
        || root
            .symlink_metadata()
            .map_err(io_error)?
            .file_type()
            .is_symlink()
    {
        return Err(io_error(
            "Choose an absolute folder path, not a symbolic link",
        ));
    }
    let root = root.canonicalize().map_err(io_error)?;
    let dir = Dir::open_ambient_dir(&root, cap_std::ambient_authority()).map_err(io_error)?;
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .max_open(16)
    {
        if Instant::now() > deadline {
            return Err(io_error("Local scan timed out"));
        }
        let entry = entry.map_err(io_error)?;
        if entry.path_is_symlink() {
            return Err(io_error(
                "The folder contains a symbolic link. Select a folder without links.",
            ));
        }
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            return Err(io_error("The folder contains a non-regular file"));
        }
        if files.len() >= MAX_FILES {
            return Err(io_error(
                "Sync is limited to 10,000 files. Choose a smaller folder.",
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(io_error)?
            .to_path_buf();
        let parts = relative
            .components()
            .map(|p| {
                p.as_os_str()
                    .to_str()
                    .ok_or_else(|| io_error("Sync filenames must be valid Unicode"))
            })
            .collect::<Result<Vec<_>>>()?;
        let key = format!("{prefix}{}", parts.join("/"));
        if key.len() > 1024 {
            return Err(io_error("A destination key exceeds S3's 1,024-byte limit"));
        }
        let (size, sha256, md5) = hash_file(open_source(&dir, &relative)?, None, deadline)?;
        files.push(LocalFile {
            source: SyncSource {
                profile_identity: String::new(),
                current_session: true,
                root: root.clone(),
                relative,
                sha256,
                size,
                expected_etag: None,
            },
            key,
            md5,
        });
    }
    files.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(files)
}

/// Freeze exactly the bytes approved in the preview. The temporary file stays alive for
/// the whole upload, including retries, and is removed on completion or cancellation.
pub fn snapshot(source: &SyncSource) -> Result<tempfile::NamedTempFile> {
    let root =
        Dir::open_ambient_dir(&source.root, cap_std::ambient_authority()).map_err(io_error)?;
    let mut temp = tempfile::NamedTempFile::new().map_err(io_error)?;
    let (size, digest, _) = hash_file(
        open_source(&root, &source.relative)?,
        Some(temp.as_file_mut()),
        Instant::now() + Duration::from_secs(300),
    )?;
    if size != source.size || digest != source.sha256 {
        return Err(io_error(
            "Local file changed since preview. Preview the folder again before syncing.",
        ));
    }
    Ok(temp)
}

pub fn unchanged(file: &LocalFile, head: &HeadObjectOutput) -> bool {
    if head.content_length() != Some(file.source.size as i64) {
        return false;
    }
    // ETags are only used as content hashes for unencrypted/SSE-S3 single-part objects.
    let encryption = head.server_side_encryption().map(|s| s.as_str());
    matches!(encryption, None | Some("AES256"))
        && head.sse_customer_algorithm().is_none()
        && head
            .e_tag()
            .is_some_and(|e| e.trim_matches('"').eq_ignore_ascii_case(&file.md5))
}

pub struct Attributes {
    pub head: HeadObjectOutput,
    pub(crate) acl: Option<CopyAclHeaders>,
    pub tags: Option<String>,
}

pub async fn attributes(
    client: &Client,
    bucket: &str,
    key: &str,
    expected: &str,
) -> Result<Attributes> {
    tokio::time::timeout(Duration::from_secs(60), async {
        let head = client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| AppError::S3Error(s3_error_message(&e)))?;
        if head.e_tag() != Some(expected) {
            return Err(io_error(
                "Destination changed since preview. Preview again.",
            ));
        }
        if head.sse_customer_algorithm().is_some() {
            return Err(io_error(
                "Cannot safely sync an object encrypted with a customer-provided key",
            ));
        }
        let acl = match client
            .get_object_acl()
            .bucket(bucket)
            .key(key)
            .set_version_id(head.version_id.clone())
            .send()
            .await
        {
            Ok(a) => Some(copy_acl_headers(&a)?),
            Err(e)
                if matches!(
                    classify_acl_error(&s3_error_message(&e)),
                    Some(("unsupported", _))
                ) =>
            {
                None
            }
            Err(e) => {
                return Err(io_error(format!(
                    "Cannot preserve destination permissions: {}",
                    s3_error_message(&e)
                )))
            }
        };
        let tags = match client
            .get_object_tagging()
            .bucket(bucket)
            .key(key)
            .set_version_id(head.version_id.clone())
            .send()
            .await
        {
            Ok(t) => encode_object_tags(t.tag_set()),
            Err(e)
                if matches!(
                    classify_acl_error(&s3_error_message(&e)),
                    Some(("unsupported", _))
                ) =>
            {
                None
            }
            Err(e) => {
                return Err(io_error(format!(
                    "Cannot preserve destination tags: {}",
                    s3_error_message(&e)
                )))
            }
        };
        Ok(Attributes { head, acl, tags })
    })
    .await
    .map_err(|_| io_error("Checking destination attributes timed out"))?
}

// Keep ordinary uploads untouched. Only sync replacements inherit destination attributes.
macro_rules! apply_attributes {
    ($request:expr, $a:expr) => {{
        let a = $a;
        let h = &a.head;
        let mut request = $request
            .set_content_type(h.content_type.clone())
            .set_cache_control(h.cache_control.clone())
            .set_content_disposition(h.content_disposition.clone())
            .set_content_encoding(h.content_encoding.clone())
            .set_content_language(h.content_language.clone())
            .set_metadata(h.metadata.clone())
            .set_website_redirect_location(h.website_redirect_location.clone())
            .set_storage_class(h.storage_class.clone())
            .set_server_side_encryption(h.server_side_encryption.clone())
            .set_ssekms_key_id(h.ssekms_key_id.clone())
            .set_bucket_key_enabled(h.bucket_key_enabled)
            .set_object_lock_mode(h.object_lock_mode.clone())
            .set_object_lock_retain_until_date(h.object_lock_retain_until_date)
            .set_object_lock_legal_hold_status(h.object_lock_legal_hold_status.clone())
            .set_tagging(a.tags.clone());
        #[allow(deprecated)]
        {
            request = request.set_expires(h.expires);
        }
        if let Some(acl) = &a.acl {
            request = request
                .set_grant_full_control(CopyAclHeaders::joined(&acl.full_control))
                .set_grant_read(CopyAclHeaders::joined(&acl.read))
                .set_grant_read_acp(CopyAclHeaders::joined(&acl.read_acp))
                .set_grant_write_acp(CopyAclHeaders::joined(&acl.write_acp));
        }
        request
    }};
}
pub fn apply_put(
    request: aws_sdk_s3::operation::put_object::builders::PutObjectFluentBuilder,
    a: &Attributes,
) -> aws_sdk_s3::operation::put_object::builders::PutObjectFluentBuilder {
    apply_attributes!(request, a)
}
pub fn apply_multipart(
    request: aws_sdk_s3::operation::create_multipart_upload::builders::CreateMultipartUploadFluentBuilder,
    a: &Attributes,
) -> aws_sdk_s3::operation::create_multipart_upload::builders::CreateMultipartUploadFluentBuilder {
    apply_attributes!(request, a)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_contents_not_parent_and_snapshots_exact_bytes() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("nested")).unwrap();
        std::fs::write(root.path().join("nested/empty"), []).unwrap();
        std::fs::write(root.path().join("hello.txt"), b"hello").unwrap();
        let files = scan(root.path(), "target/").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].key, "target/hello.txt");
        let snapshot = snapshot(&files[0].source).unwrap();
        assert_eq!(std::fs::read(snapshot.path()).unwrap(), b"hello");
        std::fs::write(root.path().join("hello.txt"), b"other").unwrap();
        assert!(super::snapshot(&files[0].source).is_err());
        assert_eq!(std::fs::read(snapshot.path()).unwrap(), b"hello");
        let snapshot_path = snapshot.path().to_owned();
        drop(snapshot);
        assert!(!snapshot_path.exists());
    }
    #[test]
    fn only_comparable_matching_content_is_unchanged() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file"), b"hello").unwrap();
        let file = scan(root.path(), "").unwrap().remove(0);
        let head = HeadObjectOutput::builder()
            .content_length(5)
            .e_tag(format!("\"{}\"", file.md5))
            .build();
        assert!(unchanged(&file, &head));
        let kms = HeadObjectOutput::builder()
            .content_length(5)
            .e_tag(file.md5.clone())
            .server_side_encryption(aws_sdk_s3::types::ServerSideEncryption::AwsKms)
            .build();
        assert!(!unchanged(&file, &kms));
        let multipart = HeadObjectOutput::builder()
            .content_length(5)
            .e_tag(format!("{}-2", file.md5))
            .build();
        assert!(!unchanged(&file, &multipart));
    }

    #[test]
    fn recovered_sync_requires_a_new_preview() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file"), b"hello").unwrap();
        let source = scan(root.path(), "").unwrap().remove(0).source;
        assert!(source.current_session);
        let saved = serde_json::to_string(&source).unwrap();
        let restored: SyncSource = serde_json::from_str(&saved).unwrap();
        assert!(!restored.current_session);
        assert_eq!(restored.sha256, source.sha256);
    }

    #[test]
    fn missing_file_and_invalid_key_fail_without_a_snapshot() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file"), b"hello").unwrap();
        assert!(scan(root.path(), &"x".repeat(1024)).is_err());
        let source = scan(root.path(), "").unwrap().remove(0).source;
        std::fs::remove_file(root.path().join("file")).unwrap();
        assert!(snapshot(&source).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_and_paths_escaping_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        assert!(scan(root.path(), "").is_err());
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        assert!(open_source(&dir, Path::new("../secret")).is_err());
        assert!(open_source(&dir, Path::new("escape/secret")).is_err());
    }
}
