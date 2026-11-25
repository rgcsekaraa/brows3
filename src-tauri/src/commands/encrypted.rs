use super::profiles::ProfileState;
use super::transfer::{require_active_profile, validate_path};
use crate::error::{AppError, Result};
use crate::s3::{plan_multipart_upload, MultipartUploadGuard, S3State, MULTIPART_UPLOAD_THRESHOLD};
use crate::transfer::{bucket_crypto, download::DownloadDestination, envelope};
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::{primitives::ByteStream, Client};
use aws_smithy_types::byte_stream::Length;
use std::io::{self, Seek};
use std::path::Path;
use tauri::State;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Semaphore;
use zeroize::Zeroizing;

#[cfg(test)]
#[path = "test_s3/protected_profile.rs"]
mod protected_profile;

#[cfg(test)]
#[path = "test_s3/encryption_timing.rs"]
mod encryption_timing;

static TRANSFERS: Semaphore = Semaphore::const_new(1);

fn failed() -> AppError {
    AppError::InvalidContent(
        "Encrypted transfer failed; check the file, passphrase and destination.".into(),
    )
}

fn validate(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(failed());
    }
    validate_path(path).map_err(|_| failed())
}

async fn client(
    profile_state: &ProfileState,
    s3_state: &S3State,
    expected: &str,
    bucket: &str,
    region: Option<String>,
) -> Result<(String, Client)> {
    if !bucket_crypto::physical(bucket) {
        return Err(failed());
    }
    let profile = require_active_profile(profile_state, expected)
        .await
        .map_err(|_| failed())?;
    let mut manager = s3_state.write().await;
    let region = manager.get_bucket_region(&profile, bucket).or(region);
    let client = match region {
        Some(region) => manager.get_client_for_region(&profile, &region).await,
        None => manager.get_client(&profile).await,
    }
    .cloned()
    .map_err(|_| failed())?;
    let endpoint = match &profile.credential_type {
        crate::credentials::CredentialType::CustomEndpoint { endpoint_url, .. } => {
            endpoint_url.as_str()
        }
        _ => "",
    };
    let region = client
        .config()
        .region()
        .map_or("", |region| region.as_ref());
    use sha2::{Digest, Sha256};
    let scope =
        Sha256::digest(format!("{}\0{region}\0{endpoint}", profile.cache_identity()).as_bytes());
    Ok((format!("{scope:x}"), client))
}

pub(crate) async fn upload(
    client: &Client,
    bucket: &str,
    key: &str,
    path: &Path,
    secret: envelope::Key,
) -> Result<()> {
    upload_with_start(client, bucket, key, path, secret, || {}).await
}

async fn upload_with_start(
    client: &Client,
    bucket: &str,
    key: &str,
    path: &Path,
    secret: envelope::Key,
    encryption_started: impl FnOnce() + Send + 'static,
) -> Result<()> {
    validate(path)?;
    let context = bucket_crypto::context(bucket, key).map_err(|_| failed())?;
    let _permit = TRANSFERS
        .try_acquire()
        .map_err(|_| AppError::ConfigError("Another encrypted transfer is active".into()))?;
    let path = path.to_owned();
    let file = tokio::task::spawn_blocking(move || -> io::Result<_> {
        if !path.is_file() {
            return Err(io::Error::other("Not a file"));
        }
        let source = std::fs::File::open(path)?;
        let meta = source.metadata()?;
        if !meta.is_file() || meta.len() > envelope::MAX_PLAIN {
            return Err(io::Error::other("File exceeds limit"));
        }
        let mut ciphertext = tempfile::tempfile()?;
        encryption_started();
        envelope::encrypt_object(source, &mut ciphertext, &secret, &context)?;
        ciphertext.rewind()?;
        Ok(ciphertext)
    })
    .await
    .map_err(|_| failed())?
    .map_err(|_| failed())?;
    let size = file.metadata().map_err(|_| failed())?.len();
    let file = tokio::fs::File::from_std(file);
    if size >= MULTIPART_UPLOAD_THRESHOLD {
        return multipart(client, bucket, key, file, size).await;
    }
    let body = ByteStream::read_from()
        .file(file)
        .build()
        .await
        .map_err(|_| failed())?;
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .if_none_match("*")
        .content_type("application/octet-stream")
        .body(body)
        .send()
        .await
        .map_err(|_| failed())?;
    Ok(())
}

async fn multipart(
    client: &Client,
    bucket: &str,
    key: &str,
    file: tokio::fs::File,
    size: u64,
) -> Result<()> {
    let plan = plan_multipart_upload(size)?;
    let created = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .content_type("application/octet-stream")
        .send()
        .await
        .map_err(|_| failed())?;
    let upload_id = created.upload_id().ok_or_else(failed)?.to_owned();
    let mut guard = MultipartUploadGuard::new(client.clone(), bucket, key, upload_id);
    let result: Result<()> = async {
        let mut completed = Vec::with_capacity(plan.parts.len());
        for part in plan.parts {
            let reader = file.try_clone().await.map_err(|_| failed())?;
            let body = ByteStream::read_from()
                .file(reader)
                .offset(part.offset)
                .length(Length::Exact(part.length))
                .build()
                .await
                .map_err(|_| failed())?;
            let response = client
                .upload_part()
                .bucket(bucket)
                .key(key)
                .upload_id(guard.upload_id())
                .part_number(part.number)
                .content_length(part.length as i64)
                .body(body)
                .send()
                .await
                .map_err(|_| failed())?;
            completed.push(
                CompletedPart::builder()
                    .part_number(part.number)
                    .e_tag(response.e_tag().ok_or_else(failed)?)
                    .build(),
            );
        }
        client
            .complete_multipart_upload()
            .bucket(bucket)
            .key(key)
            .upload_id(guard.upload_id())
            .if_none_match("*")
            .multipart_upload(
                CompletedMultipartUpload::builder()
                    .set_parts(Some(completed))
                    .build(),
            )
            .send()
            .await
            .map_err(|_| failed())?;
        Ok(())
    }
    .await;
    if result.is_ok() {
        guard.disarm();
    } else {
        let _ = guard.abort().await;
    }
    result
}

pub(crate) async fn download(
    client: &Client,
    bucket: &str,
    key: &str,
    path: &Path,
    secret: envelope::Key,
) -> Result<()> {
    validate(path)?;
    let context = bucket_crypto::context(bucket, key).map_err(|_| failed())?;
    let _permit = TRANSFERS
        .try_acquire()
        .map_err(|_| AppError::ConfigError("Another encrypted transfer is active".into()))?;
    let destination = DownloadDestination::from_path(path, false).map_err(|_| failed())?;
    let response = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|_| failed())?;
    let expected = response.content_length();
    receive(destination, response.body, expected, secret, context).await
}

async fn receive(
    destination: DownloadDestination,
    mut body: ByteStream,
    expected: Option<i64>,
    secret: envelope::Key,
    context: Vec<u8>,
) -> Result<()> {
    if expected.is_some_and(|len| !(0..=envelope::MAX_CIPHER as i64).contains(&len)) {
        return Err(failed());
    }
    let mut cipher = tokio::fs::File::from_std(tempfile::tempfile().map_err(|_| failed())?);
    let mut size = 0u64;
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|_| failed())?;
        size = size
            .checked_add(chunk.len() as u64)
            .filter(|len| *len <= envelope::MAX_CIPHER)
            .ok_or_else(failed)?;
        cipher.write_all(&chunk).await.map_err(|_| failed())?;
    }
    if expected.is_some_and(|len| len != size as i64) {
        return Err(failed());
    }
    cipher.rewind().await.map_err(|_| failed())?;
    let mut cipher = cipher.into_std().await;
    let (mut cipher, secret, context) = tokio::task::spawn_blocking(move || -> io::Result<_> {
        envelope::decrypt_object(&mut cipher, io::sink(), &secret, &context)?;
        cipher.rewind()?;
        Ok((cipher, secret, context))
    })
    .await
    .map_err(|_| failed())?
    .map_err(|_| failed())?;
    let mut pending = destination.begin_private().map_err(|_| failed())?;
    let mut writer = pending.take_blocking_writer().await.map_err(|_| failed())?;
    let pending = tokio::task::spawn_blocking(move || -> io::Result<_> {
        envelope::decrypt_object(&mut cipher, &mut writer, &secret, &context)?;
        writer.sync_all()?;
        drop(writer);
        Ok(pending)
    })
    .await
    .map_err(|_| failed())?
    .map_err(|_| failed())?;
    pending.commit().map_err(|_| failed())
}

struct Session {
    token: Zeroizing<String>,
    bucket: String,
    identity: String,
    secret: envelope::Key,
    expires: std::time::Instant,
    expires_at_ms: i64,
    lifetime: tokio::sync::watch::Sender<()>,
}

impl Session {
    fn allows(&self, identity: &str, bucket: &str, token: &str) -> bool {
        self.identity == identity
            && self.bucket == bucket
            && self.token.as_str() == token
            && self.expires > std::time::Instant::now()
            && self.expires_at_ms > chrono::Utc::now().timestamp_millis()
    }
}

static SESSION: tokio::sync::Mutex<Option<Session>> = tokio::sync::Mutex::const_new(None);
const LIFETIME: std::time::Duration = std::time::Duration::from_secs(15 * 60);

pub(super) async fn clear_session() {
    SESSION.lock().await.take();
}

async fn descriptor(client: &Client, bucket: &str) -> Result<Vec<u8>> {
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        read_descriptor(client, bucket),
    )
    .await
    .map_err(|_| failed())?
}

async fn read_descriptor(client: &Client, bucket: &str) -> Result<Vec<u8>> {
    if !bucket_crypto::physical(bucket) {
        return Err(failed());
    }
    let remote = client
        .get_object()
        .bucket(bucket)
        .key(bucket_crypto::DESCRIPTOR_KEY)
        .send()
        .await
        .map_err(|_| failed())?;
    let size = bucket_crypto::DESCRIPTOR_BYTES;
    if remote
        .content_length()
        .is_some_and(|len| len != size as i64)
    {
        return Err(failed());
    }
    let mut bytes = Vec::with_capacity(size);
    let mut body = remote.body;
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|_| failed())?;
        if chunk.len() > size - bytes.len() {
            return Err(failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() != size || bucket_crypto::physical_name(&bytes) != bucket {
        return Err(failed());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn create_encrypted_bucket(
    bucket_name: String,
    region: String,
    expected_profile_id: String,
    passphrase: String,
    profile_state: State<'_, ProfileState>,
) -> Result<String> {
    let secret = Zeroizing::new(passphrase);
    let label = Zeroizing::new(bucket_name);
    if !bucket_crypto::valid_label(label.trim())
        || !envelope::valid_passphrase(&secret)
        || region.trim().is_empty()
    {
        return Err(failed());
    }
    let (_, client, custom) = super::bucket_management::selected_client(
        &expected_profile_id,
        Some(&region),
        &profile_state,
    )
    .await
    .map_err(|_| failed())?;
    create_with_client(&client, label, secret, &region, custom).await
}

pub(crate) async fn create_with_client(
    client: &Client,
    label: Zeroizing<String>,
    secret: Zeroizing<String>,
    region: &str,
    custom: bool,
) -> Result<String> {
    let _permit = TRANSFERS.try_acquire().map_err(|_| failed())?;
    let bytes = tokio::task::spawn_blocking(move || bucket_crypto::descriptor(&label, &secret))
        .await
        .map_err(|_| failed())?
        .map_err(|_| failed())?;
    let physical = bucket_crypto::physical_name(&bytes);
    super::bucket_management::create_with_client(client, &physical, region, custom)
        .await
        .map_err(|_| failed())?;
    client.put_object().bucket(&physical).key(bucket_crypto::DESCRIPTOR_KEY).content_type("application/octet-stream").if_none_match("*").body(ByteStream::from(bytes)).send().await.map_err(|_| AppError::S3Error("Bucket may have been created, but initialization was not confirmed. No existing bucket will be adopted.".into()))?;
    Ok(physical)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unlocked {
    pub(crate) session_token: String,
    label: String,
    expires_at_ms: i64,
}

#[tauri::command]
pub async fn unlock_encrypted_bucket(
    bucket_name: String,
    bucket_region: Option<String>,
    expected_profile_id: String,
    passphrase: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<Unlocked> {
    let pass = Zeroizing::new(passphrase);
    let (identity, client) = client(
        &profile_state,
        &s3_state,
        &expected_profile_id,
        &bucket_name,
        bucket_region,
    )
    .await?;
    unlock_with_client(&client, identity, bucket_name, pass).await
}

pub(crate) async fn unlock_with_client(
    client: &Client,
    identity: String,
    bucket_name: String,
    pass: Zeroizing<String>,
) -> Result<Unlocked> {
    let _permit = TRANSFERS.try_acquire().map_err(|_| failed())?;
    let mut slot = SESSION.lock().await;
    slot.take();
    let bytes = descriptor(client, &bucket_name).await?;
    let physical = bucket_name.clone();
    let (secret, label) =
        tokio::task::spawn_blocking(move || bucket_crypto::unlock(&physical, &bytes, &pass))
            .await
            .map_err(|_| failed())?
            .map_err(|_| failed())?;
    let token = uuid::Uuid::new_v4().to_string();
    let expires = std::time::Instant::now() + LIFETIME;
    let expires_at_ms = chrono::Utc::now().timestamp_millis() + LIFETIME.as_millis() as i64;
    *slot = Some(Session {
        token: Zeroizing::new(token.clone()),
        identity,
        bucket: bucket_name,
        secret,
        expires,
        expires_at_ms,
        lifetime: tokio::sync::watch::channel(()).0,
    });
    tokio::spawn(async move {
        tokio::time::sleep(LIFETIME).await;
        let mut slot = SESSION.lock().await;
        if slot
            .as_ref()
            .is_some_and(|session| session.expires <= std::time::Instant::now())
        {
            slot.take();
        }
    });
    Ok(Unlocked {
        session_token: token,
        label,
        expires_at_ms,
    })
}

#[tauri::command]
pub async fn lock_encrypted_bucket(session_token: String) -> Result<()> {
    let mut slot = SESSION.lock().await;
    if slot
        .as_ref()
        .is_some_and(|session| session.token.as_str() == session_token)
    {
        slot.take();
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn transfer(
    uploading: bool,
    bucket: &str,
    region: Option<String>,
    key: &str,
    path: &Path,
    profile: &str,
    token: &str,
    profiles: &ProfileState,
    clients: &S3State,
) -> Result<()> {
    let (identity, client) = client(profiles, clients, profile, bucket, region).await?;
    transfer_with_client(&client, &identity, token, uploading, bucket, key, path).await
}

pub(crate) async fn transfer_with_client(
    client: &Client,
    identity: &str,
    token: &str,
    uploading: bool,
    bucket: &str,
    key: &str,
    path: &Path,
) -> Result<()> {
    let (mut revoked, expires, secret) = {
        let slot = SESSION.lock().await;
        let session = slot
            .as_ref()
            .filter(|session| session.allows(identity, bucket, token))
            .ok_or_else(failed)?;
        (
            session.lifetime.subscribe(),
            session.expires,
            session.secret.clone(),
        )
    };
    tokio::select! {
        biased;
        _ = revoked.changed() => Err(failed()),
        _ = tokio::time::sleep_until(expires.into()) => Err(failed()),
        result = async {
            if descriptor(client, bucket).await.is_err() {
                lock_encrypted_bucket(token.to_owned()).await?;
                return Err(failed());
            }
            if !SESSION.lock().await.as_ref().is_some_and(|session| session.allows(identity, bucket, token)) { return Err(failed()); }
            if uploading { upload(client, bucket, key, path, secret).await } else { download(client, bucket, key, path, secret).await }
        } => result,
    }
}

pub(super) async fn authorize_listing(
    profiles: &ProfileState,
    clients: &S3State,
    profile: &str,
    bucket: &str,
    region: Option<String>,
    token: Option<&str>,
) -> Result<()> {
    if !bucket.starts_with(bucket_crypto::PREFIX) {
        return crate::s3::bucket_mode::require_plain(bucket);
    }
    let token = token.ok_or_else(failed)?;
    let (identity, client) = client(profiles, clients, profile, bucket, region).await?;
    validate_listing_session(
        &SESSION,
        &identity,
        bucket,
        token,
        descriptor(&client, bucket),
    )
    .await
}

async fn validate_listing_session(
    sessions: &tokio::sync::Mutex<Option<Session>>,
    identity: &str,
    bucket: &str,
    token: &str,
    check_descriptor: impl std::future::Future<Output = Result<Vec<u8>>>,
) -> Result<()> {
    let matches = |session: &Session| session.allows(identity, bucket, token);
    if !sessions.lock().await.as_ref().is_some_and(matches) {
        return Err(failed());
    }

    let checked = check_descriptor.await;
    let mut slot = sessions.lock().await;
    // A lock, expiry or fresh unlock during the GET invalidates this request.
    if !slot.as_ref().is_some_and(matches) {
        return Err(failed());
    }
    if let Err(error) = checked {
        slot.take();
        return Err(error);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upload_encrypted_file(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    expected_profile_id: String,
    session_token: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    transfer(
        true,
        &bucket_name,
        bucket_region,
        &key,
        Path::new(&local_path),
        &expected_profile_id,
        &session_token,
        &profile_state,
        &s3_state,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn download_encrypted_file(
    bucket_name: String,
    bucket_region: Option<String>,
    key: String,
    local_path: String,
    expected_profile_id: String,
    session_token: String,
    profile_state: State<'_, ProfileState>,
    s3_state: State<'_, S3State>,
) -> Result<()> {
    transfer(
        false,
        &bucket_name,
        bucket_region,
        &key,
        Path::new(&local_path),
        &expected_profile_id,
        &session_token,
        &profile_state,
        &s3_state,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn listing_rechecks_the_session_after_a_slow_descriptor_read() {
        let session = |token: &str| Session {
            token: Zeroizing::new(token.to_string()),
            identity: "profile".into(),
            bucket: "bucket".into(),
            secret: Zeroizing::new([0; 32]),
            expires: std::time::Instant::now() + LIFETIME,
            expires_at_ms: chrono::Utc::now().timestamp_millis() + 900_000,
            lifetime: tokio::sync::watch::channel(()).0,
        };
        for descriptor_succeeds in [true, false] {
            let sessions = tokio::sync::Mutex::new(Some(session("old")));
            let (started, in_flight) = tokio::sync::oneshot::channel();
            let (resume, resumed) = tokio::sync::oneshot::channel();
            let reading = validate_listing_session(&sessions, "profile", "bucket", "old", async {
                started.send(()).unwrap();
                resumed.await.unwrap();
                if descriptor_succeeds {
                    Ok(Vec::new())
                } else {
                    Err(failed())
                }
            });
            let relock = async {
                in_flight.await.unwrap();
                *sessions
                    .try_lock()
                    .expect("listing held the mutex during the GET") = Some(session("new"));
                resume.send(()).unwrap();
            };
            let (result, ()) = tokio::join!(reading, relock);
            assert!(result.is_err());
            assert!(sessions
                .lock()
                .await
                .as_ref()
                .unwrap()
                .allows("profile", "bucket", "new"));
        }
        let sessions = tokio::sync::Mutex::new(Some(session("same")));
        assert!(
            validate_listing_session(&sessions, "profile", "bucket", "same", async {
                Ok(Vec::new())
            })
            .await
            .is_ok()
        );
        assert!(
            validate_listing_session(&sessions, "profile", "bucket", "same", async {
                Err(failed())
            })
            .await
            .is_err()
        );
        assert!(sessions.lock().await.is_none());
    }

    #[test]
    fn authorization_requires_live_matching_profile_bucket_and_token() {
        let mut session = Session {
            token: Zeroizing::new("local-token".to_owned()),
            identity: "profile:revision".into(),
            bucket: "physical".into(),
            secret: Zeroizing::new([0; 32]),
            expires: std::time::Instant::now() + LIFETIME,
            expires_at_ms: chrono::Utc::now().timestamp_millis() + LIFETIME.as_millis() as i64,
            lifetime: tokio::sync::watch::channel(()).0,
        };
        assert!(session.allows("profile:revision", "physical", "local-token"));
        assert!(!session.allows("profile:old", "physical", "local-token"));
        assert!(!session.allows("profile:revision", "different", "local-token"));
        assert!(!session.allows("profile:revision", "physical", "different"));
        session.expires_at_ms = 0;
        assert!(!session.allows("profile:revision", "physical", "local-token"));
    }

    #[tokio::test]
    async fn create_and_upload_send_no_private_markers_or_unconditional_puts() {
        use crate::commands::test_s3::{response, scripted_client};
        let ok = response(200, "", "");
        let (client, requests) = scripted_client(vec![ok.clone(), ok.clone(), ok]).await;
        let label = "private-bucket-display-label-marker";
        let pass = "private-passphrase-should-never-travel";
        let payload = "private-source-body-should-never-travel";
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("private-file-name-marker");
        std::fs::write(&path, payload).unwrap();
        let bucket = create_with_client(
            &client,
            Zeroizing::new(label.into()),
            Zeroizing::new(pass.into()),
            "us-east-1",
            true,
        )
        .await
        .unwrap();
        upload(
            &client,
            &bucket,
            "user-key",
            &path,
            envelope::random_key().unwrap(),
        )
        .await
        .unwrap();
        let observed = requests.await.unwrap();
        assert_eq!(observed.len(), 3);
        for request in &observed {
            assert!(request.starts_with("PUT "));
            assert!(request.lines().next().unwrap().contains(&bucket));
            for marker in [label, pass, payload, "private-file-name-marker"] {
                assert!(!request.contains(marker));
            }
        }
        for object_put in &observed[1..] {
            assert!(object_put
                .to_ascii_lowercase()
                .lines()
                .any(|line| line.trim_end() == "if-none-match: *"));
        }
    }

    #[tokio::test]
    async fn publish_only_authenticated_complete_new_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("destination");
        let destination = || DownloadDestination::from_path(&path, false).unwrap();
        let bucket = format!("b3e1-{}", "a".repeat(32));
        let context = bucket_crypto::context(&bucket, "user/file").unwrap();
        let key = envelope::random_key().unwrap();
        let source = vec![0x42; 140_000];
        let mut cipher = Vec::new();
        envelope::encrypt_object(&source[..], &mut cipher, &key, &context).unwrap();
        let mut corrupt = cipher.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        let mut extended = cipher.clone();
        extended.push(0);
        for invalid in [
            corrupt,
            extended,
            cipher[..cipher.len() - 1].to_vec(),
            source.clone(),
        ] {
            assert!(receive(
                destination(),
                ByteStream::from(invalid),
                None,
                key.clone(),
                context.clone()
            )
            .await
            .is_err());
            assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        }
        assert!(receive(
            destination(),
            ByteStream::from(cipher.clone()),
            None,
            envelope::random_key().unwrap(),
            context.clone()
        )
        .await
        .is_err());
        assert!(receive(
            destination(),
            ByteStream::from(cipher.clone()),
            Some(1),
            key.clone(),
            context.clone()
        )
        .await
        .is_err());
        assert!(!path.exists());
        receive(
            destination(),
            ByteStream::from(cipher.clone()),
            Some(cipher.len() as i64),
            key.clone(),
            context.clone(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), source);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o077,
                0
            );
        }
        std::fs::write(&path, b"keep original").unwrap();
        assert!(
            receive(destination(), ByteStream::from(cipher), None, key, context)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(path).unwrap(), b"keep original");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
