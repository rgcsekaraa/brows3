use super::*;
use crate::credentials::CredentialType;
use crate::transfer::download::DownloadDestination;
use sha2::{Digest, Sha256};
use std::future::Future;
use std::time::Instant;

pub(crate) struct Request {
    pub job: TransferJob,
    pub client: Client,
    manager: TransferManager,
    clients: Arc<RwLock<S3ClientManager>>,
    profile: Profile,
}

pub(crate) async fn measure<T, Setup, Ready, F, Fut, V, Check>(
    protected: bool,
    setup: Setup,
    transfer: F,
    verify: V,
) where
    T: Clone,
    Setup: FnOnce(Client) -> Ready,
    Ready: Future<Output = (String, T)>,
    F: Fn(Request, T) -> Fut,
    Fut: Future<Output = crate::error::Result<()>>,
    V: Fn(Client, String, String, std::path::PathBuf, T) -> Check,
    Check: Future<Output = ()>,
{
    let port: u16 = std::env::var("BROWS3_PROFILE_PORT")
        .expect("set the disposable loopback MinIO port")
        .parse()
        .unwrap();
    let profile = Profile::new(
        "profile-fixture".into(),
        CredentialType::CustomEndpoint {
            endpoint_url: format!("http://127.0.0.1:{port}"),
            access_key_id: "profile-test".into(),
            secret_access_key: "profile-test-only".into(),
        },
        Some("us-east-1".into()),
    );
    let clients = Arc::new(RwLock::new(S3ClientManager::new()));
    let client = clients
        .write()
        .await
        .get_client_for_region(&profile, "us-east-1")
        .await
        .unwrap()
        .clone();
    let (bucket, context) = setup(client.clone()).await;
    let root = tempfile::tempdir().unwrap();
    for size in [4096, 8 * 1024 * 1024] {
        let payload: Vec<u8> = (0..size / 32)
            .flat_map(|block: u32| Sha256::digest(block.to_le_bytes()))
            .collect();
        let digest = Sha256::digest(&payload);
        let source = root.path().join("source");
        std::fs::write(&source, &payload).unwrap();
        for sample in 0..=5 {
            let target = root.path().join(format!("target-{size}-{sample}"));
            let key = format!("fixture-{size}-{sample}.bin");
            let mut elapsed = Vec::new();
            let mut stored_bytes = 0;
            for direction in [TransferType::Upload, TransferType::Download] {
                let upload = matches!(direction, TransferType::Upload);
                let mut job = TransferJob::new(
                    direction,
                    profile.id.clone(),
                    bucket.clone(),
                    profile.region.clone(),
                    key.clone(),
                    if upload {
                        source.clone()
                    } else {
                        target.clone()
                    },
                    if upload {
                        u64::from(size)
                    } else {
                        stored_bytes
                    },
                );
                job.status = TransferStatus::InProgress;
                job.bandwidth_limit = Some(0);
                if !upload {
                    job.download_destination = Some(Arc::new(
                        DownloadDestination::from_path(&target, false).unwrap(),
                    ));
                }
                let manager = TransferManager::new();
                manager.add_job(job.clone()).await;
                let request = Request {
                    job,
                    client: client.clone(),
                    manager,
                    clients: clients.clone(),
                    profile: profile.clone(),
                };
                let sample_context = context.clone();
                let start = Instant::now();
                transfer(request, sample_context).await.unwrap();
                elapsed.push(start.elapsed().as_nanos());
                if upload {
                    let object = client
                        .get_object()
                        .bucket(&bucket)
                        .key(&key)
                        .send()
                        .await
                        .unwrap();
                    let bytes = object.body.collect().await.unwrap().into_bytes();
                    stored_bytes = bytes.len() as u64;
                    if protected {
                        assert!(stored_bytes > u64::from(size));
                        assert!(!bytes.windows(32).any(|window| window == &payload[..32]));
                    } else {
                        assert_eq!(&bytes[..], payload.as_slice());
                    }
                }
            }
            assert_eq!(Sha256::digest(std::fs::read(&target).unwrap()), digest);
            if sample == 5 {
                verify(
                    client.clone(),
                    bucket.clone(),
                    key.clone(),
                    target.clone(),
                    context.clone(),
                )
                .await;
            }
            std::fs::remove_file(target).unwrap();
            client
                .delete_object()
                .bucket(&bucket)
                .key(&key)
                .send()
                .await
                .unwrap();
            println!(
                "BROWS3_PROFILE {}",
                serde_json::json!({
                    "protected": protected, "sample": sample, "warmup": sample == 0,
                    "payload_bytes": size, "stored_bytes": stored_bytes,
                    "upload_ns": elapsed[0], "download_ns": elapsed[1],
                    "sha256": format!("{digest:x}"),
                })
            );
        }
    }
    if protected {
        client
            .delete_object()
            .bucket(&bucket)
            .key(".brows3/key-v1")
            .send()
            .await
            .unwrap();
    }
    client.delete_bucket().bucket(bucket).send().await.unwrap();
}

#[tokio::test]
#[ignore = "writes to disposable loopback MinIO"]
async fn profile_plain_single_file() {
    measure(
        false,
        |client| async move {
            let bucket = format!("brows3-profile-{}", uuid::Uuid::new_v4().simple());
            client.create_bucket().bucket(&bucket).send().await.unwrap();
            (bucket, ())
        },
        |request, ()| async move {
            request
                .manager
                .execute_job(&request.job, request.clients, &request.profile)
                .await
        },
        |_, _, _, _, ()| async {},
    )
    .await;
}

/// Time the ordinary upload's preparation with the same SDK transport probe.
pub(crate) async fn prepare_plain_upload(
    client: &Client,
    path: &std::path::Path,
    size: u64,
    preparing: impl FnOnce(),
) -> Instant {
    let job = TransferJob::new(
        TransferType::Upload,
        "profile".into(),
        "plain-benchmark".into(),
        Some("us-east-1".into()),
        "object".into(),
        path.to_path_buf(),
        size,
    );
    let manager = TransferManager::new();
    let start = Instant::now();
    preparing();
    manager
        .upload_file(client, &job, "application/octet-stream")
        .await
        .unwrap_err();
    start
}
