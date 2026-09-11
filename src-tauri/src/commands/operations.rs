use crate::commands::profiles::ProfileState;
use crate::error::Result;
use crate::s3::S3State;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{
    CompletedMultipartUpload, CompletedPart, Delete, MetadataDirective, ObjectCannedAcl,
    ObjectIdentifier, Permission, TaggingDirective,
};
use aws_sdk_s3::Client;
use std::collections::HashSet;
use std::path::Path;
use tauri::State;

pub(super) fn validate_operation_profile(expected: Option<&str>, actual: &str) -> Result<()> {
    if expected.is_some_and(|id| id != actual) {
        return Err(crate::error::AppError::ConfigError(
            "The active profile changed. Copy or select the items again.".to_string(),
        ));
    }
    Ok(())
}

async fn detect_and_cache_bucket_region(
    active_profile: &crate::credentials::Profile,
    bucket_name: &str,
    s3_state: &S3State,
) -> Result<Option<String>> {
    let retry_client = {
        let mut s3_manager = s3_state.write().await;
        s3_manager.get_client(active_profile).await?.clone()
    };

    let detected_region = crate::s3::get_bucket_region(&retry_client, bucket_name)
        .await
        .ok();

    if let Some(ref new_region) = detected_region {
        let mut s3_manager = s3_state.write().await;
        s3_manager.set_bucket_region(bucket_name, new_region.clone());
    }

    Ok(detected_region)
}

fn validate_folder_target(
    source_bucket: &str,
    source_key: &str,
    destination_bucket: &str,
    destination_key: &str,
) -> Result<()> {
    if source_bucket != destination_bucket {
        return Ok(());
    }

    if source_key.ends_with('/') {
        let normalized_destination = if destination_key.ends_with('/') {
            destination_key.to_string()
        } else {
            format!("{}/", destination_key)
        };

        if normalized_destination.starts_with(source_key) {
            return Err(crate::error::AppError::ConfigError(format!(
                "Cannot copy or move folder '{}' into its own subtree '{}'",
                source_key, destination_key
            )));
        }
    }

    Ok(())
}

fn parse_object_canned_acl(value: &str) -> Result<ObjectCannedAcl> {
    match value {
        "private" => Ok(ObjectCannedAcl::Private),
        "public-read" => Ok(ObjectCannedAcl::PublicRead),
        "public-read-write" => Ok(ObjectCannedAcl::PublicReadWrite),
        "authenticated-read" => Ok(ObjectCannedAcl::AuthenticatedRead),
        "aws-exec-read" => Ok(ObjectCannedAcl::AwsExecRead),
        "bucket-owner-read" => Ok(ObjectCannedAcl::BucketOwnerRead),
        "bucket-owner-full-control" => Ok(ObjectCannedAcl::BucketOwnerFullControl),
        _ => Err(crate::error::AppError::ConfigError(format!(
            "Unsupported object ACL '{}'",
            value
        ))),
    }
}

fn classify_acl_error(error: &str) -> Option<(&'static str, &'static str)> {
    let normalized = error.to_ascii_lowercase();

    if normalized.contains("accesscontrollistnotsupported")
        || normalized.contains("acl is not supported")
        || normalized.contains("acls are not supported")
        || normalized.contains("bucket does not allow acls")
        || normalized.contains("the bucket does not allow acls")
        || normalized.contains("notimplemented")
        || normalized.contains("not implemented")
        || normalized.contains("methodnotallowed")
        || normalized.contains("method not allowed")
        || normalized.contains("xnotimplemented")
    {
        return Some((
            "unsupported",
            "ACL permissions are not supported for this bucket or provider. The bucket may use Object Ownership with ACLs disabled.",
        ));
    }

    if normalized.contains("accessdenied")
        || normalized.contains("access denied")
        || normalized.contains("forbidden")
        || normalized.contains("status code: 403")
        || normalized.contains(" 403")
    {
        return Some((
            "access_denied",
            "Your credentials do not allow viewing or changing ACL permissions for this object.",
        ));
    }

    None
}

fn map_acl_error(error: impl ToString) -> crate::error::AppError {
    let error_string = error.to_string();
    if let Some((_, message)) = classify_acl_error(&error_string) {
        crate::error::AppError::S3Error(message.to_string())
    } else {
        crate::error::AppError::S3Error(error_string)
    }
}

#[derive(Debug, Default)]
struct CopyAclHeaders {
    full_control: Vec<String>,
    read: Vec<String>,
    read_acp: Vec<String>,
    write_acp: Vec<String>,
}

impl CopyAclHeaders {
    fn joined(values: &[String]) -> Option<String> {
        (!values.is_empty()).then(|| values.join(", "))
    }
}

fn quoted_acl_value(kind: &str, value: &str) -> Result<String> {
    if value.chars().any(|character| character.is_control()) {
        return Err(crate::error::AppError::InvalidContent(
            "Object ACL contains an invalid control character".to_string(),
        ));
    }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    Ok(format!("{kind}=\"{escaped}\""))
}

fn acl_grantee_header(grantee: &aws_sdk_s3::types::Grantee) -> Result<String> {
    match grantee.r#type() {
        aws_sdk_s3::types::Type::CanonicalUser => grantee
            .id()
            .ok_or_else(|| {
                crate::error::AppError::InvalidContent(
                    "Object ACL canonical user is missing its ID".to_string(),
                )
            })
            .and_then(|value| quoted_acl_value("id", value)),
        aws_sdk_s3::types::Type::AmazonCustomerByEmail => grantee
            .email_address()
            .ok_or_else(|| {
                crate::error::AppError::InvalidContent(
                    "Object ACL email grantee is missing its address".to_string(),
                )
            })
            .and_then(|value| quoted_acl_value("emailAddress", value)),
        aws_sdk_s3::types::Type::Group => grantee
            .uri()
            .ok_or_else(|| {
                crate::error::AppError::InvalidContent(
                    "Object ACL group grantee is missing its URI".to_string(),
                )
            })
            .and_then(|value| quoted_acl_value("uri", value)),
        other => Err(crate::error::AppError::InvalidContent(format!(
            "Cannot safely preserve unsupported ACL grantee type '{}'",
            other.as_str()
        ))),
    }
}

fn copy_acl_headers(
    output: &aws_sdk_s3::operation::get_object_acl::GetObjectAclOutput,
) -> Result<CopyAclHeaders> {
    let mut headers = CopyAclHeaders::default();
    for grant in output.grants() {
        let Some(grantee) = grant.grantee() else {
            continue;
        };
        let Some(permission) = grant.permission() else {
            continue;
        };
        let header = acl_grantee_header(grantee)?;

        match permission {
            Permission::FullControl => headers.full_control.push(header),
            Permission::Read => headers.read.push(header),
            Permission::ReadAcp => headers.read_acp.push(header),
            Permission::WriteAcp => headers.write_acp.push(header),
            other => {
                return Err(crate::error::AppError::InvalidContent(format!(
                    "Cannot safely preserve unsupported object ACL permission '{}'",
                    other.as_str()
                )))
            }
        }
    }
    Ok(headers)
}

fn copy_source(bucket_name: &str, key: &str, version_id: Option<&str>) -> String {
    let base = format!("{}/{}", bucket_name, urlencoding::encode(key));
    match version_id {
        Some(version_id) => format!("{base}?versionId={}", urlencoding::encode(version_id)),
        None => base,
    }
}

fn encode_object_tags(tags: &[aws_sdk_s3::types::Tag]) -> Option<String> {
    (!tags.is_empty()).then(|| {
        tags.iter()
            .map(|tag| {
                format!(
                    "{}={}",
                    urlencoding::encode(tag.key()),
                    urlencoding::encode(tag.value())
                )
            })
            .collect::<Vec<_>>()
            .join("&")
    })
}

async fn multipart_copy_content_type(
    client: &Client,
    bucket_name: &str,
    key: &str,
    content_type: &str,
    head: &aws_sdk_s3::operation::head_object::HeadObjectOutput,
    acl_headers: Option<&CopyAclHeaders>,
) -> Result<()> {
    multipart_copy_object(
        (client, bucket_name, key),
        (client, bucket_name, key),
        content_type,
        head,
        acl_headers,
    )
    .await
}

async fn multipart_copy_object(
    source: (&Client, &str, &str),
    destination: (&Client, &str, &str),
    content_type: &str,
    head: &aws_sdk_s3::operation::head_object::HeadObjectOutput,
    acl_headers: Option<&CopyAclHeaders>,
) -> Result<()> {
    let (source_client, source_bucket, source_key) = source;
    let (client, bucket_name, key) = destination;
    if head.e_tag().is_none() {
        return Err(crate::error::AppError::S3Error(
            "Cannot safely copy an object without an ETag".into(),
        ));
    }
    let object_size = head
        .content_length()
        .and_then(|value| u64::try_from(value).ok())
        .ok_or_else(|| {
            crate::error::AppError::S3Error(format!(
                "S3 returned an invalid size for s3://{bucket_name}/{key}"
            ))
        })?;
    let copy_source = copy_source(source_bucket, source_key, head.version_id());
    let tag_output = match source_client
        .get_object_tagging()
        .bucket(source_bucket)
        .key(source_key)
        .set_version_id(head.version_id.clone())
        .send()
        .await
    {
        Ok(output) => Some(output),
        Err(error) => {
            let error_string = error.to_string();
            if matches!(classify_acl_error(&error_string), Some(("unsupported", _))) {
                None
            } else {
                return Err(crate::error::AppError::S3Error(format!(
                    "Cannot safely copy the object because the object's tags could not be read and preserved: {error_string}"
                )));
            }
        }
    };
    let tagging = tag_output
        .as_ref()
        .and_then(|output| encode_object_tags(output.tag_set()));
    let plan = crate::s3::plan_multipart_upload(object_size)?;

    let build_create_request = |acl: Option<&CopyAclHeaders>| {
        let mut request = client
            .create_multipart_upload()
            .bucket(bucket_name)
            .key(key)
            .content_type(content_type)
            .set_cache_control(head.cache_control.clone())
            .set_content_disposition(head.content_disposition.clone())
            .set_content_encoding(head.content_encoding.clone())
            .set_content_language(head.content_language.clone())
            .set_metadata(head.metadata.clone())
            .set_website_redirect_location(head.website_redirect_location.clone())
            .set_storage_class(head.storage_class.clone())
            .set_server_side_encryption(head.server_side_encryption.clone())
            .set_ssekms_key_id(head.ssekms_key_id.clone())
            .set_bucket_key_enabled(head.bucket_key_enabled)
            .set_object_lock_mode(head.object_lock_mode.clone())
            .set_object_lock_retain_until_date(head.object_lock_retain_until_date)
            .set_object_lock_legal_hold_status(head.object_lock_legal_hold_status.clone())
            .set_tagging(tagging.clone());

        #[allow(deprecated)]
        {
            request = request.set_expires(head.expires);
        }

        if let Some(acl) = acl {
            request = request
                .set_grant_full_control(CopyAclHeaders::joined(&acl.full_control))
                .set_grant_read(CopyAclHeaders::joined(&acl.read))
                .set_grant_read_acp(CopyAclHeaders::joined(&acl.read_acp))
                .set_grant_write_acp(CopyAclHeaders::joined(&acl.write_acp));
        }

        request
    };

    let created = match build_create_request(acl_headers).send().await {
        Ok(output) => output,
        Err(error) => {
            let error_string = error.to_string();
            if acl_headers.is_some()
                && matches!(classify_acl_error(&error_string), Some(("unsupported", _)))
            {
                build_create_request(None).send().await.map_err(|retry_error| {
                    crate::error::AppError::S3Error(format!(
                        "Could not start multipart object copy after retrying without ACL headers: {retry_error}"
                    ))
                })?
            } else {
                return Err(crate::error::AppError::S3Error(format!(
                    "Could not start multipart object copy: {error_string}"
                )));
            }
        }
    };
    let upload_id = created.upload_id().ok_or_else(|| {
        crate::error::AppError::S3Error(format!(
            "S3 did not return an upload ID while copying the object for s3://{bucket_name}/{key}"
        ))
    })?;
    let mut guard = crate::s3::MultipartUploadGuard::new(
        client.clone(),
        bucket_name,
        key,
        upload_id.to_string(),
    );

    let copy_result: Result<()> = async {
        let mut completed_parts = Vec::with_capacity(plan.parts.len());
        for part in &plan.parts {
            let end = part.offset + part.length - 1;
            let output = client
                .upload_part_copy()
                .bucket(bucket_name)
                .key(key)
                .upload_id(guard.upload_id())
                .part_number(part.number)
                .copy_source(&copy_source)
                .copy_source_range(format!("bytes={}-{}", part.offset, end))
                .set_copy_source_if_match(head.e_tag.clone())
                .send()
                .await
                .map_err(|error| {
                    crate::error::AppError::S3Error(format!(
                        "Multipart object copy failed at part {} of {} for s3://{bucket_name}/{key}: {error}",
                        part.number,
                        plan.parts.len()
                    ))
                })?;
            let e_tag = output
                .copy_part_result()
                .and_then(|result| result.e_tag())
                .ok_or_else(|| {
                    crate::error::AppError::S3Error(format!(
                        "S3 did not return an ETag for copied part {} of s3://{bucket_name}/{key}",
                        part.number
                    ))
                })?;
            completed_parts.push(
                CompletedPart::builder()
                    .part_number(part.number)
                    .e_tag(e_tag)
                    .build(),
            );
        }

        client
            .complete_multipart_upload()
            .bucket(bucket_name)
            .key(key)
            .upload_id(guard.upload_id())
            .multipart_upload(
                CompletedMultipartUpload::builder()
                    .set_parts(Some(completed_parts))
                    .build(),
            )
            .send()
            .await
            .map_err(|error| {
                crate::error::AppError::S3Error(format!(
                    "Could not complete multipart object copy for s3://{bucket_name}/{key}: {error}"
                ))
            })?;

        Ok(())
    }
    .await;

    if let Err(error) = copy_result {
        if let Err(abort_error) = guard.abort().await {
            log::error!("{}", abort_error);
        }
        return Err(error);
    }

    guard.disarm();
    Ok(())
}

async fn list_keys_for_permission_target(
    client: &Client,
    bucket_name: &str,
    key: &str,
    is_folder: bool,
) -> Result<Vec<String>> {
    if !is_folder {
        return Ok(vec![key.to_string()]);
    }

    let mut keys = Vec::new();
    let mut continuation_token = None;

    loop {
        let mut request = client.list_objects_v2().bucket(bucket_name).prefix(key);
        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let output = request
            .send()
            .await
            .map_err(|err| crate::error::AppError::S3Error(err.to_string()))?;

        for object in output.contents() {
            if let Some(object_key) = object.key() {
                keys.push(object_key.to_string());
            }
        }

        if output.is_truncated().unwrap_or(false) {
            continuation_token = output
                .next_continuation_token()
                .map(|token| token.to_string());
        } else {
            break;
        }
    }

    if keys.is_empty() {
        keys.push(key.to_string());
    }

    Ok(keys)
}

#[tauri::command]
pub async fn put_object(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: Option<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    put_object_with_profile(
        bucket_name,
        bucket_region,
        key,
        local_path,
        active_profile,
        &s3_state,
    )
    .await
}

async fn put_object_with_profile(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: Option<String>,
    active_profile: crate::credentials::Profile,
    s3_state: &S3State,
) -> Result<()> {
    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    // Get S3 client
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, d)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let content_type = local_path
        .as_ref()
        .map(|_| crate::s3::infer_content_type(&key));
    let mut request = client
        .put_object()
        .bucket(&bucket_name)
        .key(&key)
        .set_content_type(content_type.clone());

    if let Some(ref path) = local_path {
        // Upload file
        let body = ByteStream::from_path(Path::new(path))
            .await
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
        request = request.body(body);
    } else {
        // Create empty object (folder)
        request = request.body(ByteStream::from_static(b""));
    }

    if let Err(err) = request.send().await {
        log::warn!("put_object failed, attempting region discovery: {}", err);

        if let Some(new_region) =
            detect_and_cache_bucket_region(&active_profile, &bucket_name, s3_state).await?
        {
            let new_client = {
                let mut s3_manager = s3_state.write().await;
                s3_manager
                    .get_client_for_region(&active_profile, &new_region)
                    .await?
                    .clone()
            };

            let mut retry_request = new_client
                .put_object()
                .bucket(&bucket_name)
                .key(&key)
                .set_content_type(content_type);

            if let Some(ref path) = local_path {
                let body = ByteStream::from_path(Path::new(path))
                    .await
                    .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
                retry_request = retry_request.body(body);
            } else {
                retry_request = retry_request.body(ByteStream::from_static(b""));
            }

            retry_request
                .send()
                .await
                .map_err(|e| crate::error::AppError::S3Error(format!("Retry put failed: {}", e)))?;
        } else {
            return Err(crate::error::AppError::S3Error(err.to_string()));
        }
    }

    {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_object(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    // Get S3 client
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, d)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    // Get object
    let result = client
        .get_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await;

    let mut output = match result {
        Ok(output) => output,
        Err(err) => {
            log::warn!("get_object failed, attempting region discovery: {}", err);

            if let Some(new_region) =
                detect_and_cache_bucket_region(&active_profile, &bucket_name, &s3_state).await?
            {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager
                        .get_client_for_region(&active_profile, &new_region)
                        .await?
                        .clone()
                };

                new_client
                    .get_object()
                    .bucket(&bucket_name)
                    .key(&key)
                    .send()
                    .await
                    .map_err(|e| {
                        crate::error::AppError::S3Error(format!("Retry get failed: {}", e))
                    })?
            } else {
                return Err(crate::error::AppError::S3Error(err.to_string()));
            }
        }
    };

    let destination =
        crate::transfer::download::DownloadDestination::from_path(Path::new(&local_path), false)?;
    let mut download = destination.begin()?;

    // Stream to file
    while let Some(bytes) = output
        .body
        .try_next()
        .await
        .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?
    {
        download
            .write_all(&bytes)
            .await
            .map_err(|e| crate::error::AppError::IoError(e.to_string()))?;
    }

    download.finish_writing().await?;
    download.commit()?;
    Ok(())
}

#[tauri::command]
pub async fn delete_object(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    // Get active profile
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    delete_object_with_profile(bucket_name, bucket_region, key, active_profile, &s3_state).await
}

async fn delete_object_with_profile(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    active_profile: crate::credentials::Profile,
    s3_state: &S3State,
) -> Result<()> {
    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    // Get S3 client
    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, d)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let result = client
        .delete_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await;

    if let Err(err) = result {
        log::warn!("delete_object failed, attempting region discovery: {}", err);

        if let Some(new_region) =
            detect_and_cache_bucket_region(&active_profile, &bucket_name, s3_state).await?
        {
            let new_client = {
                let mut s3_manager = s3_state.write().await;
                s3_manager
                    .get_client_for_region(&active_profile, &new_region)
                    .await?
                    .clone()
            };

            new_client
                .delete_object()
                .bucket(&bucket_name)
                .key(&key)
                .send()
                .await
                .map_err(|e| {
                    crate::error::AppError::S3Error(format!("Retry delete failed: {}", e))
                })?;
        } else {
            return Err(crate::error::AppError::S3Error(err.to_string()));
        }
    }

    {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn copy_object(
    source_bucket: String,
    source_region: Option<String>,
    source_key: String,
    destination_bucket: String,
    destination_region: Option<String>,
    destination_key: String,
    expected_profile_id: Option<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    if source_bucket == destination_bucket && source_key == destination_key {
        return Ok(());
    }
    validate_folder_target(
        &source_bucket,
        &source_key,
        &destination_bucket,
        &destination_key,
    )?;

    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    validate_operation_profile(expected_profile_id.as_deref(), &active_profile.id)?;
    copy_object_with_profile(
        source_bucket,
        source_region,
        source_key,
        destination_bucket,
        destination_region,
        destination_key,
        active_profile,
        &s3_state,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn copy_object_with_profile(
    source_bucket: String,
    source_region: Option<String>,
    source_key: String,
    destination_bucket: String,
    destination_region: Option<String>,
    destination_key: String,
    active_profile: crate::credentials::Profile,
    s3_state: &S3State,
) -> Result<()> {
    // Check if this is a folder copy (key ends with /)
    if source_key.ends_with('/') {
        // RECURSIVE FOLDER COPY
        log::info!(
            "Starting recursive folder copy from {}/{} to {}/{}",
            source_bucket,
            source_key,
            destination_bucket,
            destination_key
        );

        // Get client for listing source bucket
        let source_region_resolved = {
            let s3_manager = s3_state.read().await;
            s3_manager.get_bucket_region(&source_bucket)
        }
        .or(source_region.clone());

        let client = {
            let mut s3_manager = s3_state.write().await;
            if let Some(ref r) = source_region_resolved {
                s3_manager
                    .get_client_for_region(&active_profile, r)
                    .await?
                    .clone()
            } else {
                s3_manager.get_client(&active_profile).await?.clone()
            }
        };

        // List all objects under the source prefix
        let mut continuation_token = None;
        let mut all_keys = Vec::new();

        loop {
            let mut req = client
                .list_objects_v2()
                .bucket(&source_bucket)
                .prefix(&source_key);

            if let Some(token) = continuation_token {
                req = req.continuation_token(token);
            }

            let resp = req
                .send()
                .await
                .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

            if let Some(contents) = resp.contents {
                for obj in contents {
                    if let Some(key) = obj.key {
                        all_keys.push(key);
                    }
                }
            }

            if resp.is_truncated.unwrap_or(false) {
                continuation_token = resp.next_continuation_token;
            } else {
                break;
            }
        }

        log::info!("Found {} objects to copy in folder", all_keys.len());
        let has_folder_marker = all_keys.iter().any(|key| key == &source_key);

        // Copy each object individually
        for key in &all_keys {
            // Calculate destination key by replacing source prefix with destination prefix
            let relative_path = key.strip_prefix(&source_key).unwrap_or(key);
            let new_key = format!("{}{}", destination_key, relative_path);

            // Perform the copy using internal helper (non-recursive single file copy)
            copy_single_object(
                &source_bucket,
                source_region.clone(),
                key,
                &destination_bucket,
                destination_region.clone(),
                &new_key,
                &active_profile,
                s3_state,
            )
            .await?;
        }

        // Preserve explicitly-created empty folders without duplicating an existing marker.
        if !has_folder_marker {
            let destination_marker = if destination_key.ends_with('/') {
                destination_key
            } else {
                format!("{}/", destination_key)
            };
            put_object_with_profile(
                destination_bucket.clone(),
                destination_region,
                destination_marker,
                None,
                active_profile.clone(),
                s3_state,
            )
            .await?;
        }

        log::info!(
            "Recursive folder copy completed: {} objects copied",
            all_keys.len()
        );
        Ok(())
    } else {
        // Single file copy
        copy_single_object(
            &source_bucket,
            source_region.clone(),
            &source_key,
            &destination_bucket,
            destination_region,
            &destination_key,
            &active_profile,
            s3_state,
        )
        .await?;

        Ok(())
    }
}

/// Internal helper for copying a single object (non-recursive)
#[allow(clippy::too_many_arguments)]
async fn copy_single_object(
    source_bucket: &str,
    source_region: Option<String>,
    source_key: &str,
    destination_bucket: &str,
    destination_region: Option<String>,
    destination_key: &str,
    active_profile: &crate::credentials::Profile,
    s3_state: &S3State,
) -> Result<()> {
    // Check cache for bucket region first
    let destination_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(destination_bucket)
    }
    .or(destination_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        // We need the client for the destination region to initiate the copy.
        if let Some(ref d) = destination_region {
            s3_manager
                .get_client_for_region(active_profile, d)
                .await?
                .clone()
        } else {
            s3_manager.get_client(active_profile).await?.clone()
        }
    };

    let source_client = {
        let mut manager = s3_state.write().await;
        let region = manager.get_bucket_region(source_bucket).or(source_region);
        if let Some(region) = region {
            manager
                .get_client_for_region(active_profile, &region)
                .await?
                .clone()
        } else {
            manager.get_client(active_profile).await?.clone()
        }
    };
    let head = source_client
        .head_object()
        .bucket(source_bucket)
        .key(source_key)
        .send()
        .await
        .map_err(|error| crate::error::AppError::S3Error(error.to_string()))?;
    copy_object_from_head(
        (&source_client, source_bucket, source_key),
        (&client, destination_bucket, destination_key),
        &head,
    )
    .await?;

    {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, destination_bucket);
    }

    Ok(())
}

async fn copy_object_from_head(
    source: (&Client, &str, &str),
    destination: (&Client, &str, &str),
    head: &aws_sdk_s3::operation::head_object::HeadObjectOutput,
) -> Result<()> {
    let size = head
        .content_length()
        .and_then(|value| u64::try_from(value).ok())
        .ok_or_else(|| {
            crate::error::AppError::S3Error("S3 did not return a valid object size".into())
        })?;
    if size > 5 * 1024 * 1024 * 1024 {
        multipart_copy_object(
            source,
            destination,
            head.content_type().unwrap_or("application/octet-stream"),
            head,
            None,
        )
        .await
    } else {
        destination
            .0
            .copy_object()
            .bucket(destination.1)
            .key(destination.2)
            .copy_source(copy_source(source.1, source.2, head.version_id()))
            .set_copy_source_if_match(head.e_tag.clone())
            .send()
            .await
            .map_err(|error| crate::error::AppError::S3Error(error.to_string()))?;
        Ok(())
    }
}

fn build_delete_request(chunk: &[String]) -> Result<Delete> {
    let mut delete_ids = Vec::new();
    for key in chunk {
        let obj_id = ObjectIdentifier::builder().key(key).build().map_err(|e| {
            crate::error::AppError::S3Error(format!("Invalid object key '{}': {}", key, e))
        })?;
        delete_ids.push(obj_id);
    }

    Delete::builder()
        .set_objects(Some(delete_ids))
        .build()
        .map_err(|e| {
            crate::error::AppError::S3Error(format!("Failed to build delete request: {}", e))
        })
}

fn validate_delete_result(
    bucket_name: &str,
    response: &aws_sdk_s3::operation::delete_objects::DeleteObjectsOutput,
) -> Result<()> {
    let Some(errors) = response.errors.as_ref() else {
        return Ok(());
    };

    if errors.is_empty() {
        return Ok(());
    }

    let failures = errors
        .iter()
        .map(|err| {
            let key = err.key.as_deref().unwrap_or("<unknown>");
            let code = err.code.as_deref().unwrap_or("Unknown");
            let message = err.message.as_deref().unwrap_or("Delete failed");
            format!("{key} ({code}: {message})")
        })
        .collect::<Vec<_>>()
        .join(", ");

    Err(crate::error::AppError::S3Error(format!(
        "Failed to delete some objects in bucket '{}': {}",
        bucket_name, failures
    )))
}

async fn delete_keys_individually(
    client: &aws_sdk_s3::Client,
    bucket_name: &str,
    keys: &[String],
) -> Result<()> {
    for key in keys {
        client
            .delete_object()
            .bucket(bucket_name)
            .key(key)
            .send()
            .await
            .map_err(|err| {
                crate::error::AppError::S3Error(format!(
                    "Fallback delete failed for '{}': {}",
                    key, err
                ))
            })?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_objects(
    bucket_name: String,
    bucket_region: Option<String>,
    keys: Vec<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    if keys.is_empty() {
        return Ok(());
    }

    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    delete_objects_with_profile(bucket_name, bucket_region, keys, active_profile, &s3_state).await
}

async fn delete_objects_with_profile(
    bucket_name: String,
    bucket_region: Option<String>,
    keys: Vec<String>,
    active_profile: crate::credentials::Profile,
    s3_state: &S3State,
) -> Result<()> {
    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, d)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    // Delete in batches of 1000. Some S3-compatible providers support single-object
    // deletion but return service errors for DeleteObjects, so fall back per key.
    for chunk in keys.chunks(1000) {
        let delete = build_delete_request(chunk)?;

        let result = client
            .delete_objects()
            .bucket(&bucket_name)
            .delete(delete.clone())
            .send()
            .await;

        match result {
            Ok(output) => validate_delete_result(&bucket_name, &output)?,
            Err(err) => {
                // Retry logic for bulk delete
                log::warn!(
                    "delete_objects failed, attempting region discovery: {}",
                    err
                );
                let detected_region = {
                    let retry_client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager.get_client(&active_profile).await?.clone()
                    };
                    crate::s3::get_bucket_region(&retry_client, &bucket_name)
                        .await
                        .ok()
                };

                if let Some(new_region) = detected_region {
                    let new_client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                        s3_manager
                            .get_client_for_region(&active_profile, &new_region)
                            .await?
                            .clone()
                    };

                    match new_client
                        .delete_objects()
                        .bucket(&bucket_name)
                        .delete(delete)
                        .send()
                        .await
                    {
                        Ok(output) => validate_delete_result(&bucket_name, &output)?,
                        Err(retry_err) => {
                            log::warn!(
                                "delete_objects retry failed, falling back to single deletes: {}",
                                retry_err
                            );
                            delete_keys_individually(&new_client, &bucket_name, chunk).await?;
                        }
                    }
                } else {
                    log::warn!(
                         "delete_objects region discovery failed, falling back to single deletes: {}",
                         err
                     );
                    delete_keys_individually(&client, &bucket_name, chunk).await?;
                }
            }
        }
    }

    // Invalidate cache for this bucket after successful deletion
    {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn move_object(
    source_bucket: String,
    source_region: Option<String>,
    source_key: String,
    destination_bucket: String,
    destination_region: Option<String>,
    destination_key: String,
    expected_profile_id: Option<String>,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    if source_bucket == destination_bucket && source_key == destination_key {
        return Ok(());
    }
    validate_folder_target(
        &source_bucket,
        &source_key,
        &destination_bucket,
        &destination_key,
    )?;

    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);
    validate_operation_profile(expected_profile_id.as_deref(), &active_profile.id)?;
    move_object_with_profile(
        source_bucket,
        source_region,
        source_key,
        destination_bucket,
        destination_region,
        destination_key,
        active_profile,
        &s3_state,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn move_object_with_profile(
    source_bucket: String,
    source_region: Option<String>,
    source_key: String,
    destination_bucket: String,
    destination_region: Option<String>,
    destination_key: String,
    active_profile: crate::credentials::Profile,
    s3_state: &S3State,
) -> Result<()> {
    // Check if this is a folder move (key ends with /)
    if source_key.ends_with('/') {
        // RECURSIVE FOLDER MOVE

        // Get client for listing source bucket
        let source_region_resolved = {
            let s3_manager = s3_state.read().await;
            s3_manager.get_bucket_region(&source_bucket)
        }
        .or(source_region.clone());

        let client = {
            let mut s3_manager = s3_state.write().await;
            if let Some(ref r) = source_region_resolved {
                s3_manager
                    .get_client_for_region(&active_profile, r)
                    .await?
                    .clone()
            } else {
                s3_manager.get_client(&active_profile).await?.clone()
            }
        };

        // List all objects under the source prefix
        let mut continuation_token = None;
        let mut all_keys = Vec::new();

        loop {
            let mut req = client
                .list_objects_v2()
                .bucket(&source_bucket)
                .prefix(&source_key);

            if let Some(token) = continuation_token {
                req = req.continuation_token(token);
            }

            let resp = req
                .send()
                .await
                .map_err(|e| crate::error::AppError::S3Error(e.to_string()))?;

            if let Some(contents) = resp.contents {
                for obj in contents {
                    if let Some(key) = obj.key {
                        all_keys.push(key);
                    }
                }
            }

            if resp.is_truncated.unwrap_or(false) {
                continuation_token = resp.next_continuation_token;
            } else {
                break;
            }
        }

        let unique_keys: HashSet<String> = all_keys.into_iter().collect();
        let mut all_keys: Vec<String> = unique_keys.into_iter().collect();
        all_keys.sort();

        let destination_folder_key = if destination_key.ends_with('/') {
            destination_key.clone()
        } else {
            format!("{}/", destination_key)
        };

        // Move each object individually
        for key in &all_keys {
            // Calculate destination key by replacing source prefix with destination prefix
            if key == &source_key {
                copy_single_object(
                    &source_bucket,
                    source_region.clone(),
                    key,
                    &destination_bucket,
                    destination_region.clone(),
                    &destination_folder_key,
                    &active_profile,
                    s3_state,
                )
                .await?;
            } else {
                let relative_path = key.strip_prefix(&source_key).unwrap_or(key);
                let new_key = format!("{}{}", destination_key, relative_path);

                copy_single_object(
                    &source_bucket,
                    source_region.clone(),
                    key,
                    &destination_bucket,
                    destination_region.clone(),
                    &new_key,
                    &active_profile,
                    s3_state,
                )
                .await?;
            }
        }

        // Delete all source objects at once
        if !all_keys.is_empty() {
            delete_objects_with_profile(
                source_bucket,
                source_region_resolved,
                all_keys,
                active_profile,
                s3_state,
            )
            .await?;
        }

        Ok(())
    } else {
        // Single file move (original behavior)
        // 1. Copy
        copy_object_with_profile(
            source_bucket.clone(),
            source_region.clone(),
            source_key.clone(),
            destination_bucket.clone(),
            destination_region.clone(),
            destination_key.clone(),
            active_profile.clone(),
            s3_state,
        )
        .await?;

        // 2. Delete source
        delete_object_with_profile(
            source_bucket,
            source_region,
            source_key,
            active_profile,
            s3_state,
        )
        .await?;

        Ok(())
    }
}

pub(super) async fn save_object_text(
    client: &Client,
    bucket: &str,
    key: &str,
    content: String,
    expected_etag: &str,
) -> Result<Option<String>> {
    let conflict = || {
        crate::error::AppError::S3Error(
        "This object has changed since it was opened. Copy your edits, then reopen it before saving.".into()
    )
    };
    if expected_etag.is_empty() {
        return Err(conflict());
    }
    let head = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|error| crate::error::AppError::S3Error(error.to_string()))?;
    if head.e_tag() != Some(expected_etag) {
        return Err(conflict());
    }
    if head.sse_customer_algorithm().is_some() {
        return Err(crate::error::AppError::ConfigError(
            "This object requires a customer encryption key and cannot be edited safely.".into(),
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
        Ok(output) => Some(copy_acl_headers(&output)?),
        Err(error)
            if matches!(
                classify_acl_error(&error.to_string()),
                Some(("unsupported", _))
            ) =>
        {
            None
        }
        Err(error) => {
            return Err(crate::error::AppError::S3Error(format!(
                "Cannot save because the current permissions could not be preserved: {error}"
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
        Ok(output) => encode_object_tags(output.tag_set()),
        Err(error)
            if matches!(
                classify_acl_error(&error.to_string()),
                Some(("unsupported", _))
            ) =>
        {
            None
        }
        Err(error) => {
            return Err(crate::error::AppError::S3Error(format!(
                "Cannot save because the current tags could not be preserved: {error}"
            )))
        }
    };
    let bytes = content.into_bytes();
    let build_request = |acl: Option<&CopyAclHeaders>| {
        let mut request = client
            .put_object()
            .bucket(bucket)
            .key(key)
            .if_match(expected_etag)
            .body(aws_sdk_s3::primitives::ByteStream::from(bytes.clone()))
            .set_content_type(head.content_type.clone())
            .set_cache_control(head.cache_control.clone())
            .set_content_disposition(head.content_disposition.clone())
            .set_content_encoding(head.content_encoding.clone())
            .set_content_language(head.content_language.clone())
            .set_metadata(head.metadata.clone())
            .set_website_redirect_location(head.website_redirect_location.clone())
            .set_storage_class(head.storage_class.clone())
            .set_server_side_encryption(head.server_side_encryption.clone())
            .set_ssekms_key_id(head.ssekms_key_id.clone())
            .set_bucket_key_enabled(head.bucket_key_enabled)
            .set_object_lock_mode(head.object_lock_mode.clone())
            .set_object_lock_retain_until_date(head.object_lock_retain_until_date)
            .set_object_lock_legal_hold_status(head.object_lock_legal_hold_status.clone())
            .set_tagging(tags.clone());
        #[allow(deprecated)]
        {
            request = request.set_expires(head.expires);
        }
        if let Some(acl) = acl {
            request = request
                .set_grant_full_control(CopyAclHeaders::joined(&acl.full_control))
                .set_grant_read(CopyAclHeaders::joined(&acl.read))
                .set_grant_read_acp(CopyAclHeaders::joined(&acl.read_acp))
                .set_grant_write_acp(CopyAclHeaders::joined(&acl.write_acp));
        }
        request
    };
    let mut result = build_request(acl.as_ref()).send().await;
    if let Err(error) = &result {
        if acl.is_some()
            && matches!(
                classify_acl_error(&error.to_string()),
                Some(("unsupported", _))
            )
        {
            result = build_request(None).send().await;
        }
    }
    result.map(|output| output.e_tag).map_err(|error| {
        if error
            .raw_response()
            .is_some_and(|response| matches!(response.status().as_u16(), 409 | 412))
        {
            conflict()
        } else {
            crate::error::AppError::S3Error(format!("Save failed: {error}"))
        }
    })
}

#[tauri::command]
pub async fn set_object_content_type(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    content_type: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    const MAX_SINGLE_COPY_SIZE: u64 = 5 * 1024 * 1024 * 1024;

    let content_type = crate::s3::validate_content_type(&content_type)?;
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let resolved_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = resolved_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let head = client
        .head_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await
        .map_err(|error| crate::error::AppError::S3Error(error.to_string()))?;

    if head.content_type() == Some(content_type.as_str()) {
        return Ok(());
    }
    if head.e_tag().is_none() {
        return Err(crate::error::AppError::S3Error(format!(
            "Cannot safely update Content-Type because S3 did not return an ETag for s3://{bucket_name}/{key}"
        )));
    }

    let object_size = head
        .content_length()
        .ok_or_else(|| {
            crate::error::AppError::S3Error(format!(
                "S3 did not return the size of s3://{bucket_name}/{key}"
            ))
        })
        .and_then(|value| {
            u64::try_from(value).map_err(|_| {
                crate::error::AppError::S3Error(format!(
                    "S3 returned an invalid negative size for s3://{bucket_name}/{key}"
                ))
            })
        })?;
    if head.sse_customer_algorithm().is_some() {
        return Err(crate::error::AppError::ConfigError(
            "Content-Type cannot be changed safely for an SSE-C encrypted object because its customer encryption key is not available"
                .to_string(),
        ));
    }

    let acl_headers = match client
        .get_object_acl()
        .bucket(&bucket_name)
        .key(&key)
        .set_version_id(head.version_id.clone())
        .send()
        .await
    {
        Ok(output) => Some(copy_acl_headers(&output)?),
        Err(error) => {
            let error_string = error.to_string();
            if matches!(classify_acl_error(&error_string), Some(("unsupported", _))) {
                None
            } else {
                return Err(crate::error::AppError::S3Error(format!(
                    "Cannot safely update Content-Type because the current object ACL could not be read and preserved: {error_string}"
                )));
            }
        }
    };

    let copy_source = copy_source(&bucket_name, &key, head.version_id());
    if object_size > MAX_SINGLE_COPY_SIZE {
        multipart_copy_content_type(
            &client,
            &bucket_name,
            &key,
            &content_type,
            &head,
            acl_headers.as_ref(),
        )
        .await?;

        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
        return Ok(());
    }

    let build_request = |acl: Option<&CopyAclHeaders>| {
        let mut request = client
            .copy_object()
            .bucket(&bucket_name)
            .key(&key)
            .copy_source(&copy_source)
            .content_type(&content_type)
            .metadata_directive(MetadataDirective::Replace)
            .tagging_directive(TaggingDirective::Copy)
            .set_copy_source_if_match(head.e_tag.clone())
            .set_cache_control(head.cache_control.clone())
            .set_content_disposition(head.content_disposition.clone())
            .set_content_encoding(head.content_encoding.clone())
            .set_content_language(head.content_language.clone())
            .set_metadata(head.metadata.clone())
            .set_website_redirect_location(head.website_redirect_location.clone())
            .set_storage_class(head.storage_class.clone())
            .set_server_side_encryption(head.server_side_encryption.clone())
            .set_ssekms_key_id(head.ssekms_key_id.clone())
            .set_bucket_key_enabled(head.bucket_key_enabled)
            .set_object_lock_mode(head.object_lock_mode.clone())
            .set_object_lock_retain_until_date(head.object_lock_retain_until_date)
            .set_object_lock_legal_hold_status(head.object_lock_legal_hold_status.clone());

        #[allow(deprecated)]
        {
            request = request.set_expires(head.expires);
        }

        if let Some(acl) = acl {
            request = request
                .set_grant_full_control(CopyAclHeaders::joined(&acl.full_control))
                .set_grant_read(CopyAclHeaders::joined(&acl.read))
                .set_grant_read_acp(CopyAclHeaders::joined(&acl.read_acp))
                .set_grant_write_acp(CopyAclHeaders::joined(&acl.write_acp));
        }

        request
    };

    let result = build_request(acl_headers.as_ref()).send().await;
    if let Err(error) = result {
        let error_string = error.to_string();
        if acl_headers.is_some()
            && matches!(classify_acl_error(&error_string), Some(("unsupported", _)))
        {
            // Object Ownership with ACLs disabled can still return an ACL-like
            // response while rejecting grant headers. Retry without ACL headers;
            // there is no ACL state to lose in that mode.
            build_request(None).send().await.map_err(|retry_error| {
                crate::error::AppError::S3Error(format!(
                    "Content-Type update failed after retrying without ACL headers: {retry_error}"
                ))
            })?;
        } else {
            return Err(crate::error::AppError::S3Error(format!(
                "Content-Type update failed: {error_string}"
            )));
        }
    }

    {
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&active_profile.id, &bucket_name);
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct ObjectMetadata {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
    pub content_type: Option<String>,
    pub e_tag: Option<String>,
    pub storage_class: Option<String>,
    pub user_metadata: std::collections::HashMap<String, String>,
}

#[derive(serde::Serialize)]
pub struct ObjectAclGrant {
    pub grantee_type: Option<String>,
    pub display_name: Option<String>,
    pub id: Option<String>,
    pub uri: Option<String>,
    pub email_address: Option<String>,
    pub permission: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ObjectPermissions {
    pub key: String,
    pub is_folder: bool,
    pub status: String,
    pub message: Option<String>,
    pub owner_display_name: Option<String>,
    pub owner_id: Option<String>,
    pub grants: Vec<ObjectAclGrant>,
    pub target_count: usize,
}

#[derive(serde::Serialize)]
pub struct SetObjectPermissionsResult {
    pub affected_count: usize,
}

#[tauri::command]
pub async fn get_object_permissions(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    is_folder: bool,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<ObjectPermissions> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let mut client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let mut target_keys =
        match list_keys_for_permission_target(&client, &bucket_name, &key, is_folder).await {
            Ok(keys) => keys,
            Err(err) => {
                log::warn!(
                    "Permission target listing failed, attempting region discovery: {}",
                    err
                );
                if let Some(new_region) =
                    detect_and_cache_bucket_region(&active_profile, &bucket_name, &s3_state).await?
                {
                    client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager
                            .get_client_for_region(&active_profile, &new_region)
                            .await?
                            .clone()
                    };
                    list_keys_for_permission_target(&client, &bucket_name, &key, is_folder).await?
                } else {
                    return Err(err);
                }
            }
        };

    target_keys.sort();
    let representative_key = target_keys
        .first()
        .cloned()
        .ok_or_else(|| crate::error::AppError::S3Error("No permission target found".to_string()))?;

    let output = match client
        .get_object_acl()
        .bucket(&bucket_name)
        .key(&representative_key)
        .send()
        .await
    {
        Ok(output) => output,
        Err(err) => {
            let error_string = err.to_string();
            if let Some((status, message)) = classify_acl_error(&error_string) {
                return Ok(ObjectPermissions {
                    key,
                    is_folder,
                    status: status.to_string(),
                    message: Some(message.to_string()),
                    owner_display_name: None,
                    owner_id: None,
                    grants: Vec::new(),
                    target_count: target_keys.len(),
                });
            }
            return Err(crate::error::AppError::S3Error(error_string));
        }
    };

    let grants = output
        .grants()
        .iter()
        .map(|grant| {
            let grantee = grant.grantee();
            ObjectAclGrant {
                grantee_type: grantee.map(|g| g.r#type().as_str().to_string()),
                display_name: grantee
                    .and_then(|g| g.display_name())
                    .map(|value| value.to_string()),
                id: grantee.and_then(|g| g.id()).map(|value| value.to_string()),
                uri: grantee.and_then(|g| g.uri()).map(|value| value.to_string()),
                email_address: grantee
                    .and_then(|g| g.email_address())
                    .map(|value| value.to_string()),
                permission: grant.permission().map(|value| value.as_str().to_string()),
            }
        })
        .collect();

    Ok(ObjectPermissions {
        key,
        is_folder,
        status: "available".to_string(),
        message: None,
        owner_display_name: output
            .owner()
            .and_then(|owner| owner.display_name())
            .map(|value| value.to_string()),
        owner_id: output
            .owner()
            .and_then(|owner| owner.id())
            .map(|value| value.to_string()),
        grants,
        target_count: target_keys.len(),
    })
}

#[tauri::command]
pub async fn set_object_permissions(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    is_folder: bool,
    canned_acl: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<SetObjectPermissionsResult> {
    let acl = parse_object_canned_acl(&canned_acl)?;
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let mut client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref region) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, region)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let target_keys =
        match list_keys_for_permission_target(&client, &bucket_name, &key, is_folder).await {
            Ok(keys) => keys,
            Err(err) => {
                log::warn!(
                    "Permission target listing failed, attempting region discovery: {}",
                    err
                );
                if let Some(new_region) =
                    detect_and_cache_bucket_region(&active_profile, &bucket_name, &s3_state).await?
                {
                    client = {
                        let mut s3_manager = s3_state.write().await;
                        s3_manager
                            .get_client_for_region(&active_profile, &new_region)
                            .await?
                            .clone()
                    };
                    list_keys_for_permission_target(&client, &bucket_name, &key, is_folder).await?
                } else {
                    return Err(err);
                }
            }
        };

    for target_key in &target_keys {
        client
            .put_object_acl()
            .bucket(&bucket_name)
            .key(target_key)
            .acl(acl.clone())
            .send()
            .await
            .map_err(map_acl_error)?;
    }

    {
        let profile_id = active_profile.id.clone();
        let mut s3_manager = s3_state.write().await;
        s3_manager.remove_bucket_cache(&profile_id, &bucket_name);
    }

    Ok(SetObjectPermissionsResult {
        affected_count: target_keys.len(),
    })
}

#[tauri::command]
pub async fn get_object_metadata(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<ObjectMetadata> {
    let profile_manager = profile_state.read().await;
    let active_profile = profile_manager
        .get_active_profile()
        .await?
        .ok_or_else(|| crate::error::AppError::ProfileNotFound("No active profile".into()))?;
    drop(profile_manager);

    // Check cache for bucket region first
    let bucket_region = {
        let s3_manager = s3_state.read().await;
        s3_manager.get_bucket_region(&bucket_name)
    }
    .or(bucket_region);

    let client = {
        let mut s3_manager = s3_state.write().await;
        if let Some(ref d) = bucket_region {
            s3_manager
                .get_client_for_region(&active_profile, d)
                .await?
                .clone()
        } else {
            s3_manager.get_client(&active_profile).await?.clone()
        }
    };

    let result = client
        .head_object()
        .bucket(&bucket_name)
        .key(&key)
        .send()
        .await;

    let output = match result {
        Ok(out) => out,
        Err(err) => {
            let error_str = err.to_string();
            // If access denied (403), likely permissions, but could be region mismatch too in some cases.
            // But usually region mismatch is 301 or 400.
            if error_str.contains("403") || error_str.contains("Access Denied") {
                return Err(crate::error::AppError::AccessDenied(error_str));
            }

            // Retry logic
            log::warn!("head_object failed, attempting region discovery: {}", err);
            let detected_region = {
                let retry_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.get_client(&active_profile).await?.clone()
                };
                crate::s3::get_bucket_region(&retry_client, &bucket_name)
                    .await
                    .ok()
            };

            if let Some(new_region) = detected_region {
                let new_client = {
                    let mut s3_manager = s3_state.write().await;
                    s3_manager.set_bucket_region(&bucket_name, new_region.clone());
                    s3_manager
                        .get_client_for_region(&active_profile, &new_region)
                        .await?
                        .clone()
                };
                new_client
                    .head_object()
                    .bucket(&bucket_name)
                    .key(&key)
                    .send()
                    .await
                    .map_err(|e| {
                        let e_str = e.to_string();
                        if e_str.contains("403") || e_str.contains("Access Denied") {
                            crate::error::AppError::AccessDenied(e_str)
                        } else {
                            crate::error::AppError::S3Error(format!("Retry head failed: {}", e_str))
                        }
                    })?
            } else {
                return Err(crate::error::AppError::S3Error(error_str));
            }
        }
    };

    let last_modified = output.last_modified.map(|d| d.to_string());

    // Convert HashMap<String, String> from SDK to standard HashMap
    let user_metadata = output.metadata.unwrap_or_default();

    Ok(ObjectMetadata {
        key,
        size: output.content_length.unwrap_or(0),
        last_modified,
        content_type: output.content_type,
        e_tag: output.e_tag,
        storage_class: output.storage_class.map(|s| s.as_str().to_string()),
        user_metadata: user_metadata.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        classify_acl_error, copy_source, encode_object_tags, multipart_copy_content_type,
        quoted_acl_value,
    };
    use crate::credentials::{CredentialType, Profile};
    use aws_sdk_s3::primitives::ByteStream;
    use aws_sdk_s3::types::{Tag, Tagging};

    #[test]
    fn copy_source_encodes_keys_and_pins_versioned_objects() {
        assert_eq!(
            copy_source("bucket", "folder/a file#.txt", None),
            "bucket/folder%2Fa%20file%23.txt"
        );
        assert_eq!(
            copy_source("bucket", "folder/a.txt", Some("version+one=")),
            "bucket/folder%2Fa.txt?versionId=version%2Bone%3D"
        );
    }

    #[test]
    fn multipart_copy_tag_header_is_url_encoded() {
        let tags = vec![
            Tag::builder()
                .key("team name")
                .value("web+docs")
                .build()
                .unwrap(),
            Tag::builder().key("empty").value("").build().unwrap(),
        ];

        assert_eq!(
            encode_object_tags(&tags).as_deref(),
            Some("team%20name=web%2Bdocs&empty=")
        );
        assert_eq!(encode_object_tags(&[]), None);
    }

    #[test]
    fn acl_preservation_escapes_values_and_classifies_provider_errors() {
        assert_eq!(
            quoted_acl_value("id", "user\\\"one").unwrap(),
            "id=\"user\\\\\\\"one\""
        );
        assert!(quoted_acl_value("id", "bad\nvalue").is_err());
        assert_eq!(
            classify_acl_error("AccessControlListNotSupported"),
            Some((
                "unsupported",
                "ACL permissions are not supported for this bucket or provider. The bucket may use Object Ownership with ACLs disabled."
            ))
        );
        assert!(matches!(
            classify_acl_error("403 AccessDenied"),
            Some(("access_denied", _))
        ));
    }

    /// Run with BROWS3_S3_TEST_ENDPOINT=http://127.0.0.1:<port> against MinIO.
    #[tokio::test]
    #[ignore = "requires an S3-compatible integration-test endpoint"]
    async fn multipart_content_type_copy_preserves_object_state() {
        let endpoint = std::env::var("BROWS3_S3_TEST_ENDPOINT")
            .expect("BROWS3_S3_TEST_ENDPOINT must identify the test S3 endpoint");
        let access_key =
            std::env::var("BROWS3_S3_TEST_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into());
        let secret_key =
            std::env::var("BROWS3_S3_TEST_SECRET_KEY").unwrap_or_else(|_| "minioadmin".into());
        let profile = Profile::new(
            "content-type-integration".to_string(),
            CredentialType::CustomEndpoint {
                endpoint_url: endpoint,
                access_key_id: access_key,
                secret_access_key: secret_key,
            },
            Some("us-east-1".to_string()),
        );
        let sdk_config = crate::s3::client::load_sdk_config(&profile, None).await;
        let client = crate::s3::client::client_from_sdk_config(&sdk_config, &profile);
        let bucket = format!("brows3-content-type-{}", uuid::Uuid::new_v4().simple());
        let key = "folder/a file.bin";
        client
            .create_bucket()
            .bucket(&bucket)
            .send()
            .await
            .expect("test bucket should be created");

        let path = std::env::temp_dir().join(format!(
            "brows3-content-type-{}.bin",
            uuid::Uuid::new_v4().simple()
        ));
        let file = tokio::fs::File::create(&path)
            .await
            .expect("sparse test file should be created");
        let size = 129 * 1024 * 1024;
        file.set_len(size)
            .await
            .expect("sparse test file should be sized");
        drop(file);

        client
            .put_object()
            .bucket(&bucket)
            .key(key)
            .content_type("application/octet-stream")
            .cache_control("max-age=60")
            .metadata("owner", "brows3")
            .body(
                ByteStream::from_path(&path)
                    .await
                    .expect("test body should be readable"),
            )
            .send()
            .await
            .expect("source object should be uploaded");
        client
            .put_object_tagging()
            .bucket(&bucket)
            .key(key)
            .tagging(
                Tagging::builder()
                    .tag_set(
                        Tag::builder()
                            .key("team name")
                            .value("web+docs")
                            .build()
                            .unwrap(),
                    )
                    .build()
                    .unwrap(),
            )
            .send()
            .await
            .expect("source tags should be applied");

        let head = client
            .head_object()
            .bucket(&bucket)
            .key(key)
            .send()
            .await
            .expect("source metadata should be readable");
        multipart_copy_content_type(
            &client,
            &bucket,
            key,
            "text/html; charset=utf-8",
            &head,
            None,
        )
        .await
        .expect("multipart copy should complete");

        let copied = client
            .head_object()
            .bucket(&bucket)
            .key(key)
            .send()
            .await
            .expect("copied metadata should be readable");
        assert_eq!(copied.content_length(), Some(size as i64));
        assert_eq!(copied.content_type(), Some("text/html; charset=utf-8"));
        assert_eq!(copied.cache_control(), Some("max-age=60"));
        assert_eq!(
            copied
                .metadata()
                .and_then(|metadata| metadata.get("owner"))
                .map(String::as_str),
            Some("brows3")
        );

        let tags = client
            .get_object_tagging()
            .bucket(&bucket)
            .key(key)
            .send()
            .await
            .expect("copied tags should be readable");
        assert_eq!(tags.tag_set().len(), 1);
        assert_eq!(tags.tag_set()[0].key(), "team name");
        assert_eq!(tags.tag_set()[0].value(), "web+docs");
        let incomplete = client
            .list_multipart_uploads()
            .bucket(&bucket)
            .send()
            .await
            .expect("multipart uploads should be listable");
        assert!(incomplete.uploads().is_empty());

        client
            .delete_object()
            .bucket(&bucket)
            .key(key)
            .send()
            .await
            .expect("test object should be deleted");
        client
            .delete_bucket()
            .bucket(&bucket)
            .send()
            .await
            .expect("test bucket should be deleted");
        tokio::fs::remove_file(path)
            .await
            .expect("sparse test file should be deleted");
    }
}

#[cfg(test)]
mod operation_profile_tests {
    use super::validate_operation_profile;

    #[test]
    fn rejects_operations_from_a_different_profile() {
        assert!(validate_operation_profile(Some("profile-a"), "profile-b").is_err());
        assert!(validate_operation_profile(Some("profile-a"), "profile-a").is_ok());
        assert!(validate_operation_profile(None, "profile-a").is_ok());
    }
}

#[cfg(test)]
mod move_profile_tests {
    use super::*;
    use crate::credentials::{CredentialType, Profile, ProfileManager};
    use crate::s3::S3ClientManager;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::RwLock;

    #[tokio::test]
    async fn move_keeps_its_profile_when_selection_changes_after_copy() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let directory =
            std::env::temp_dir().join(format!("brows3-move-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut profiles = ProfileManager::new(directory.clone(), true).unwrap();
        let profile = profiles
            .add_profile(Profile::new(
                "A".into(),
                CredentialType::CustomEndpoint {
                    endpoint_url: endpoint,
                    access_key_id: "TEST-A".into(),
                    secret_access_key: "test-secret".into(),
                },
                Some("us-east-1".into()),
            ))
            .await
            .unwrap();
        let other = profiles
            .add_profile(Profile::new(
                "B".into(),
                CredentialType::Environment,
                Some("us-east-1".into()),
            ))
            .await
            .unwrap();
        profiles.set_active_profile(&profile.id).await.unwrap();
        let captured = profiles.get_active_profile().await.unwrap().unwrap();
        let profiles = Arc::new(RwLock::new(profiles));
        let server_profiles = profiles.clone();
        let other_id = other.id.clone();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for index in 0..3 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).await.unwrap();
                    request.push(byte[0]);
                }
                requests.push(String::from_utf8(request).unwrap());
                let body = if index == 1 {
                    server_profiles
                        .write()
                        .await
                        .set_active_profile(&other_id)
                        .await
                        .unwrap();
                    "<CopyObjectResult><ETag>&quot;test&quot;</ETag><LastModified>2026-01-01T00:00:00Z</LastModified></CopyObjectResult>"
                } else {
                    ""
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        let s3 = Arc::new(RwLock::new(S3ClientManager::new()));
        tokio::time::timeout(
            std::time::Duration::from_secs(15),
            move_object_with_profile(
                "bucket".into(),
                Some("us-east-1".into()),
                "source.txt".into(),
                "bucket".into(),
                Some("us-east-1".into()),
                "dest.txt".into(),
                captured,
                &s3,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with("HEAD /bucket/source.txt"));
        assert!(requests[1].starts_with("PUT /bucket/dest.txt"));
        assert!(requests[2].starts_with("DELETE /bucket/source.txt"));
        assert!(requests
            .iter()
            .all(|request| request.contains("Credential=TEST-A/")));
        assert_eq!(
            profiles
                .read()
                .await
                .get_active_profile()
                .await
                .unwrap()
                .unwrap()
                .id,
            other.id
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(test)]
mod text_save_tests {
    use super::save_object_text;
    use crate::commands::test_s3::{response, scripted_client};

    fn head(etag: &str) -> String {
        response(200, &format!("ETag: {etag}\r\nContent-Type: text/plain\r\nCache-Control: max-age=60\r\nx-amz-meta-owner: brows3\r\nx-amz-version-id: v1\r\n"), "")
    }

    fn acl() -> String {
        response(200, "", "<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"CanonicalUser\"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>")
    }

    fn tags() -> String {
        response(200, "", "<Tagging><TagSet><Tag><Key>team name</Key><Value>web+docs</Value></Tag></TagSet></Tagging>")
    }

    #[tokio::test]
    async fn save_preserves_attributes_and_returns_the_written_etag() {
        let (client, server) = scripted_client(vec![
            head("\"old\""),
            acl(),
            tags(),
            response(200, "ETag: \"new\"\r\n", ""),
        ])
        .await;
        assert_eq!(
            save_object_text(&client, "bucket", "file.txt", "edited".into(), "\"old\"")
                .await
                .unwrap()
                .as_deref(),
            Some("\"new\"")
        );
        let requests = server.await.unwrap();
        assert!(requests[1].contains("versionId=v1"));
        assert!(requests[2].contains("versionId=v1"));
        let put = requests[3].to_ascii_lowercase();
        assert!(put.starts_with("put /bucket/file.txt"));
        for header in [
            "if-match: \"old\"",
            "content-type: text/plain",
            "cache-control: max-age=60",
            "x-amz-meta-owner: brows3",
            "x-amz-grant-full-control: id=\"owner\"",
            "x-amz-tagging: team%20name=web%2bdocs",
        ] {
            assert!(put.contains(header), "Missing {header}: {put}");
        }
        assert!(put.contains("edited"));
    }

    #[tokio::test]
    async fn changed_objects_are_rejected_before_writing() {
        let (client, server) = scripted_client(vec![head("\"changed\"")]).await;
        let error = save_object_text(&client, "bucket", "file.txt", "edited".into(), "\"old\"")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("changed since it was opened"));
        assert_eq!(server.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_concurrent_write_is_reported_as_a_conflict() {
        let (client, server) = scripted_client(vec![
            head("\"old\""),
            acl(),
            tags(),
            response(412, "", "<Error><Code>PreconditionFailed</Code></Error>"),
        ])
        .await;
        let error = save_object_text(&client, "bucket", "file.txt", "edited".into(), "\"old\"")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("changed since it was opened"));
        assert_eq!(server.await.unwrap().len(), 4);
    }

    #[tokio::test]
    async fn unreadable_permissions_prevent_a_destructive_save() {
        let (client, server) = scripted_client(vec![
            head("\"old\""),
            response(403, "", "<Error><Code>AccessDenied</Code></Error>"),
        ])
        .await;
        let error = save_object_text(&client, "bucket", "file.txt", "edited".into(), "\"old\"")
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("permissions could not be preserved"));
        assert_eq!(server.await.unwrap().len(), 2);
    }
}

#[cfg(test)]
mod large_copy_tests {
    use super::copy_object_from_head;
    use crate::commands::test_s3::{response, scripted_client};
    use aws_sdk_s3::operation::head_object::HeadObjectOutput;

    const LARGE_SIZE: u64 = 5 * 1024 * 1024 * 1024 + 1;

    fn head(size: u64) -> HeadObjectOutput {
        HeadObjectOutput::builder()
            .content_length(size as i64)
            .e_tag("\"source\"")
            .version_id("v1")
            .content_type("text/plain")
            .cache_control("max-age=60")
            .metadata("owner", "brows3")
            .build()
    }

    fn start_responses() -> Vec<String> {
        vec![
            response(200, "", "<Tagging><TagSet><Tag><Key>team</Key><Value>docs</Value></Tag></TagSet></Tagging>"),
            response(200, "", "<InitiateMultipartUploadResult><UploadId>upload</UploadId></InitiateMultipartUploadResult>"),
        ]
    }

    #[tokio::test]
    async fn large_copy_uses_contiguous_parts_and_preserves_metadata() {
        let plan = crate::s3::plan_multipart_upload(LARGE_SIZE).unwrap();
        let mut responses = start_responses();
        responses.extend(plan.parts.iter().map(|_| {
            response(
                200,
                "",
                "<CopyPartResult><ETag>&quot;part&quot;</ETag></CopyPartResult>",
            )
        }));
        responses.push(response(200, "", "<CompleteMultipartUploadResult><ETag>&quot;complete&quot;</ETag></CompleteMultipartUploadResult>"));
        let (client, server) = scripted_client(responses).await;
        copy_object_from_head(
            (&client, "source", "original.txt"),
            (&client, "destination", "renamed.txt"),
            &head(LARGE_SIZE),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with("GET /source/original.txt?tagging"));
        assert!(requests[0].contains("versionId=v1"));
        assert!(requests[1].starts_with("POST /destination/renamed.txt?uploads"));
        for header in [
            "content-type: text/plain",
            "cache-control: max-age=60",
            "x-amz-meta-owner: brows3",
            "x-amz-tagging: team=docs",
        ] {
            assert!(requests[1].contains(header));
        }
        for (request, part) in requests[2..requests.len() - 1].iter().zip(plan.parts) {
            assert!(request.starts_with("PUT /destination/renamed.txt?"));
            assert!(request.contains("x-amz-copy-source: source/original.txt?versionId=v1"));
            assert!(request.contains("x-amz-copy-source-if-match: \"source\""));
            assert!(request.contains(&format!(
                "x-amz-copy-source-range: bytes={}-{}",
                part.offset,
                part.offset + part.length - 1
            )));
        }
        assert!(requests
            .last()
            .unwrap()
            .starts_with("POST /destination/renamed.txt?uploadId=upload"));
    }

    #[tokio::test]
    async fn failed_large_copy_aborts_without_completing_or_deleting_the_source() {
        let mut responses = start_responses();
        responses.push(response(
            412,
            "",
            "<Error><Code>PreconditionFailed</Code></Error>",
        ));
        responses.push(response(204, "", ""));
        let (client, server) = scripted_client(responses).await;
        assert!(copy_object_from_head(
            (&client, "source", "original.txt"),
            (&client, "destination", "renamed.txt"),
            &head(LARGE_SIZE)
        )
        .await
        .is_err());
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 4);
        assert!(requests[3].starts_with("DELETE /destination/renamed.txt?"));
        assert!(requests[3].contains("uploadId=upload"));
    }

    #[tokio::test]
    async fn objects_at_the_single_copy_limit_keep_using_copy_object() {
        let (client, server) = scripted_client(vec![response(
            200,
            "",
            "<CopyObjectResult><ETag>&quot;copy&quot;</ETag></CopyObjectResult>",
        )])
        .await;
        copy_object_from_head(
            (&client, "source", "original.txt"),
            (&client, "destination", "renamed.txt"),
            &head(LARGE_SIZE - 1),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("PUT /destination/renamed.txt"));
        assert!(requests[0].contains("x-amz-copy-source: source/original.txt?versionId=v1"));
    }
}
