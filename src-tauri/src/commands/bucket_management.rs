use super::profiles::ProfileState;
use crate::credentials::Profile;
use crate::error::{AppError, Result};
use crate::s3::S3State;
use aws_sdk_s3::error::{DisplayErrorContext, ProvideErrorMetadata};
use aws_sdk_s3::types::{BucketLocationConstraint, CreateBucketConfiguration};
use aws_sdk_s3::Client;
use tauri::State;

static POLICY_WRITES: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

async fn selected_client(
    expected_profile_id: &str,
    region: Option<&str>,
    profiles: &ProfileState,
) -> Result<(Profile, Client, bool)> {
    let profile = profiles
        .read()
        .await
        .get_active_profile()
        .await?
        .ok_or_else(|| AppError::ProfileNotFound("No active profile selected".into()))?;
    if profile.id != expected_profile_id {
        return Err(AppError::ConfigError(
            "The active profile changed. Reopen the bucket action.".into(),
        ));
    }
    let sdk = crate::s3::client::load_sdk_config(&profile, region.map(str::to_string)).await;
    let custom = matches!(
        profile.credential_type,
        crate::credentials::CredentialType::CustomEndpoint { .. }
    ) || sdk.endpoint_url().is_some();
    let client = crate::s3::client::client_from_sdk_config(&sdk, &profile);
    Ok((profile, client, custom))
}

async fn request<T, E: std::error::Error + 'static>(
    action: &str,
    future: impl std::future::Future<Output = std::result::Result<T, E>>,
) -> Result<T> {
    tokio::time::timeout(std::time::Duration::from_secs(120), future)
        .await
        .map_err(|_| {
            AppError::S3Error(format!(
                "{action} timed out. Check the connection and refresh before retrying."
            ))
        })?
        .map_err(|error| AppError::S3Error(format!("{action}: {}", DisplayErrorContext(&error))))
}

fn validate_bucket_name(name: &str) -> Result<()> {
    let valid_edge = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    if !(3..=63).contains(&name.len())
        || !name
            .bytes()
            .all(|byte| valid_edge(byte) || byte == b'-' || byte == b'.')
        || !name.bytes().next().is_some_and(valid_edge)
        || !name.bytes().last().is_some_and(valid_edge)
        || name.contains("..")
        || name.parse::<std::net::Ipv4Addr>().is_ok()
    {
        return Err(AppError::ConfigError("Use a bucket name with 3 to 63 lowercase letters, numbers, dots or hyphens. Start and end with a letter or number.".into()));
    }
    Ok(())
}

async fn create_with_client(
    client: &Client,
    name: &str,
    region: &str,
    custom_endpoint: bool,
) -> Result<()> {
    validate_bucket_name(name)?;
    if !custom_endpoint && region == "us-east-1" {
        // S3 can reset an existing bucket's ACL in us-east-1.
        let existing = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            client.head_bucket().bucket(name).send(),
        )
        .await
        .map_err(|_| AppError::S3Error("Checking bucket availability timed out.".into()))?;
        match existing {
            Ok(_) => {
                return Err(AppError::ConfigError(
                    "This bucket already exists. Choose a different name.".into(),
                ))
            }
            Err(error)
                if error
                    .raw_response()
                    .is_some_and(|response| response.status().as_u16() == 404) => {}
            Err(error) => {
                return Err(AppError::S3Error(format!(
                    "Could not check bucket availability: {}",
                    DisplayErrorContext(&error)
                )))
            }
        }
    }
    let mut create = client.create_bucket().bucket(name);
    if !custom_endpoint && region != "us-east-1" {
        create = create.create_bucket_configuration(
            CreateBucketConfiguration::builder()
                .location_constraint(BucketLocationConstraint::from(region))
                .build(),
        );
    }
    request("Could not create bucket", create.send()).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_bucket(
    bucket_name: String,
    region: String,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    if region.trim().is_empty() {
        return Err(AppError::ConfigError(
            "Enter a region for the bucket.".into(),
        ));
    }
    let (profile, client, custom) =
        selected_client(&expected_profile_id, Some(&region), &profile_state).await?;
    create_with_client(&client, &bucket_name, &region, custom).await?;
    s3_state
        .write()
        .await
        .remove_bucket_cache(&profile.id, &bucket_name);
    Ok(())
}

#[tauri::command]
pub async fn delete_bucket(
    bucket_name: String,
    bucket_region: Option<String>,
    confirmation: String,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    if bucket_name.is_empty() || confirmation != bucket_name {
        return Err(AppError::ConfigError(
            "Type the bucket name exactly to confirm deletion.".into(),
        ));
    }
    let (profile, client, _) = selected_client(
        &expected_profile_id,
        bucket_region.as_deref(),
        &profile_state,
    )
    .await?;
    request(
        "Could not delete bucket. It must be empty, including object versions and delete markers",
        client.delete_bucket().bucket(&bucket_name).send(),
    )
    .await?;
    s3_state
        .write()
        .await
        .remove_bucket_cache(&profile.id, &bucket_name);
    Ok(())
}

async fn read_policy(client: &Client, bucket: &str) -> Result<Option<String>> {
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        client.get_bucket_policy().bucket(bucket).send(),
    )
    .await
    .map_err(|_| AppError::S3Error("Reading bucket policy timed out.".into()))?;
    match response {
        Ok(output) => Ok(output.policy),
        Err(error)
            if error.as_service_error().and_then(|error| error.code())
                == Some("NoSuchBucketPolicy") =>
        {
            Ok(None)
        }
        Err(error) => Err(AppError::S3Error(format!(
            "Could not read bucket policy: {}",
            DisplayErrorContext(&error)
        ))),
    }
}

#[tauri::command]
pub async fn get_bucket_policy(
    bucket_name: String,
    bucket_region: Option<String>,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
) -> Result<Option<String>> {
    let (_, client, _) = selected_client(
        &expected_profile_id,
        bucket_region.as_deref(),
        &profile_state,
    )
    .await?;
    read_policy(&client, &bucket_name).await
}

fn parse_policy(policy: &str) -> Result<serde_json::Value> {
    if policy.len() > 20 * 1024 {
        return Err(AppError::ConfigError(
            "Bucket policies must be at most 20 KB.".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_str(policy)
        .map_err(|error| AppError::ConfigError(format!("Invalid policy JSON: {error}")))?;
    if !value.is_object() {
        return Err(AppError::ConfigError(
            "A bucket policy must be a JSON object.".into(),
        ));
    }
    Ok(value)
}

async fn write_policy(
    client: &Client,
    bucket: &str,
    policy: Option<&str>,
    expected: Option<&str>,
) -> Result<()> {
    let _write = POLICY_WRITES.lock().await;
    let new_value = policy.map(parse_policy).transpose()?;
    let expected_value = expected.map(parse_policy).transpose()?;
    let current = read_policy(client, bucket).await?;
    if current.as_deref().map(parse_policy).transpose()? != expected_value {
        return Err(AppError::ConfigError(
            "The bucket policy changed since it was opened. Reload it before saving.".into(),
        ));
    }
    match new_value {
        Some(value) => {
            request(
                "Could not save bucket policy",
                client
                    .put_bucket_policy()
                    .bucket(bucket)
                    .policy(value.to_string())
                    .send(),
            )
            .await?;
        }
        None => {
            request(
                "Could not remove bucket policy",
                client.delete_bucket_policy().bucket(bucket).send(),
            )
            .await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn put_bucket_policy(
    bucket_name: String,
    bucket_region: Option<String>,
    policy: Option<String>,
    expected_policy: Option<String>,
    expected_profile_id: String,
    profile_state: State<'_, ProfileState>,
) -> Result<()> {
    let (_, client, _) = selected_client(
        &expected_profile_id,
        bucket_region.as_deref(),
        &profile_state,
    )
    .await?;
    write_policy(
        &client,
        &bucket_name,
        policy.as_deref(),
        expected_policy.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_s3::{response, scripted_client};

    #[tokio::test]
    async fn bucket_creation_uses_provider_appropriate_location_constraints() {
        for (region, custom, expected) in [
            ("us-east-1", false, None),
            ("eu-west-1", false, Some("eu-west-1")),
            ("auto", true, None),
        ] {
            let mut responses = vec![response(200, "", "")];
            if !custom && region == "us-east-1" {
                responses.insert(0, response(404, "", ""));
            }
            let (client, server) = scripted_client(responses).await;
            create_with_client(&client, "new-bucket", region, custom)
                .await
                .unwrap();
            let requests = server.await.unwrap();
            let created = requests.last().unwrap();
            assert!(created.starts_with("PUT /new-bucket"));
            match expected {
                Some(region) => assert!(requests[0].contains(&format!(
                    "<LocationConstraint>{region}</LocationConstraint>"
                ))),
                None => assert!(!created.contains("LocationConstraint")),
            }
        }
    }

    #[tokio::test]
    async fn creating_an_existing_us_east_bucket_cannot_reset_its_acl() {
        let (client, server) = scripted_client(vec![response(200, "", "")]).await;
        assert!(
            create_with_client(&client, "existing-bucket", "us-east-1", false)
                .await
                .unwrap_err()
                .to_string()
                .contains("already exists")
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("HEAD "));
    }

    #[test]
    fn invalid_bucket_names_and_policies_are_rejected() {
        for name in [
            "",
            "ab",
            "UPPER",
            "../bucket",
            "bucket_1",
            "-bucket",
            "bucket-",
            "127.0.0.1",
        ] {
            assert!(validate_bucket_name(name).is_err(), "{name}");
        }
        assert!(validate_bucket_name("my.bucket-1").is_ok());
        for policy in ["", "[]", "null", "{invalid}"] {
            assert!(parse_policy(policy).is_err());
        }
    }

    #[tokio::test]
    async fn missing_policy_is_distinct_from_denied_access() {
        let (client, server) = scripted_client(vec![response(
            404,
            "",
            "<Error><Code>NoSuchBucketPolicy</Code></Error>",
        )])
        .await;
        assert_eq!(read_policy(&client, "bucket").await.unwrap(), None);
        server.await.unwrap();
        let (client, server) = scripted_client(vec![response(
            403,
            "",
            "<Error><Code>AccessDenied</Code></Error>",
        )])
        .await;
        assert!(read_policy(&client, "bucket")
            .await
            .unwrap_err()
            .to_string()
            .contains("AccessDenied"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn changed_policies_are_not_overwritten() {
        let (client, server) = scripted_client(vec![response(
            200,
            "Content-Type: application/json\r\n",
            "{\"Statement\":[]}",
        )])
        .await;
        let error = write_policy(&client, "bucket", Some("{}"), None)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("changed since"));
        assert_eq!(server.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn policy_updates_preserve_the_document_and_support_removal() {
        let (client, server) = scripted_client(vec![
            response(200, "", "{}"),
            response(204, "", ""),
            response(200, "", "{}"),
            response(204, "", ""),
        ])
        .await;
        write_policy(&client, "bucket", Some("{\"Statement\":[]}"), Some("{}"))
            .await
            .unwrap();
        write_policy(&client, "bucket", None, Some("{}"))
            .await
            .unwrap();
        let requests = server.await.unwrap();
        assert!(requests[1].starts_with("PUT /bucket/?policy"));
        assert!(requests[1].contains("{\"Statement\":[]}"));
        assert!(requests[3].starts_with("DELETE /bucket/?policy"));
    }
}
