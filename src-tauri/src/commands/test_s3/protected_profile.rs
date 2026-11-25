use crate::commands::encrypted::{
    create_with_client, download, lock_encrypted_bucket, transfer_with_client, unlock_with_client,
};
use crate::transfer::bucket_crypto::{unlock, DESCRIPTOR_KEY};
use crate::transfer::{manager::transfer_profile::measure, TransferType};
use aws_sdk_s3::{primitives::ByteStream, Client};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Instant;
use zeroize::Zeroizing;

const PASSPHRASE: &str = "only for the disposable transfer fixture";
const IDENTITY: &str = "loopback-profile-identity";

async fn session(client: &Client, bucket: &str, pass: &str) -> crate::error::Result<String> {
    unlock_with_client(
        client,
        IDENTITY.to_owned(),
        bucket.to_owned(),
        Zeroizing::new(pass.to_owned()),
    )
    .await
    .map(|unlocked| unlocked.session_token)
}

async fn assert_refused(client: &Client, bucket: &str, token: &str, reason: &str) {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    let target = root.path().join("target");
    std::fs::write(&source, b"locked transfer should never publish").unwrap();
    let key = "refused-probe.bin";
    let start = Instant::now();
    assert!(
        transfer_with_client(client, IDENTITY, token, true, bucket, key, &source)
            .await
            .is_err()
    );
    let upload_ns = start.elapsed().as_nanos();
    let start = Instant::now();
    assert!(transfer_with_client(
        client,
        IDENTITY,
        token,
        false,
        bucket,
        "read-probe.bin",
        &target
    )
    .await
    .is_err());
    let download_ns = start.elapsed().as_nanos();
    assert!(!target.exists());
    let listing = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(key)
        .send()
        .await
        .unwrap();
    assert!(listing.contents().is_empty());
    println!("BROWS3_REFUSED {{\"reason\":\"{reason}\",\"upload_ns\":{upload_ns},\"download_ns\":{download_ns}}}");
}

async fn create_fixture(client: &Client, label: &str) -> (String, Vec<u8>) {
    let bucket = create_with_client(
        client,
        Zeroizing::new(label.to_owned()),
        Zeroizing::new(PASSPHRASE.to_owned()),
        "us-east-1",
        true,
    )
    .await
    .unwrap();
    let observed = client
        .get_object()
        .bucket(&bucket)
        .key(DESCRIPTOR_KEY)
        .send()
        .await
        .unwrap();
    let metadata = format!("{:?}", observed.metadata());
    let bytes = observed.body.collect().await.unwrap().into_bytes();
    let digest = format!("{:x}", Sha256::digest(&bytes));
    assert_eq!(bucket, format!("b3e1-{}", &digest[..32]));
    for marker in [label, PASSPHRASE] {
        assert!(!metadata.contains(marker));
        assert!(!bytes
            .windows(marker.len())
            .any(|part| part == marker.as_bytes()));
    }
    (bucket, bytes.to_vec())
}

#[tokio::test]
#[ignore = "writes to disposable loopback MinIO"]
async fn profile_protected_single_file() {
    measure(
        true,
        |client| async move {
            let label = format!("private-fixture-{}", uuid::Uuid::new_v4().simple());
            let (bucket, bytes) = create_fixture(&client, &label).await;
            let (other, other_bytes) = create_fixture(&client, &label).await;
            assert_ne!(bucket, other);
            assert!(unlock(&bucket, &other_bytes, PASSPHRASE).is_err());
            assert!(session(&client, &bucket, "incorrect test passphrase")
                .await
                .is_err());
            let (secret, name) = unlock(&bucket, &bytes, PASSPHRASE).unwrap();
            assert_eq!(name, label);
            let (other_secret, _) = unlock(&other, &other_bytes, PASSPHRASE).unwrap();
            assert!(*secret != *other_secret);
            client
                .delete_object()
                .bucket(&other)
                .key(DESCRIPTOR_KEY)
                .send()
                .await
                .unwrap();
            client.delete_bucket().bucket(other).send().await.unwrap();
            let revoked = session(&client, &bucket, PASSPHRASE).await.unwrap();
            let root = tempfile::tempdir().unwrap();
            let probe = root.path().join("probe");
            std::fs::write(&probe, b"known readable when unlocked").unwrap();
            transfer_with_client(
                &client,
                IDENTITY,
                &revoked,
                true,
                &bucket,
                "read-probe.bin",
                &probe,
            )
            .await
            .unwrap();
            lock_encrypted_bucket(revoked.clone()).await.unwrap();
            assert_refused(&client, &bucket, &revoked, "locked").await;
            let token = session(&client, &bucket, PASSPHRASE).await.unwrap();
            client
                .delete_object()
                .bucket(&bucket)
                .key(DESCRIPTOR_KEY)
                .send()
                .await
                .unwrap();
            assert_refused(&client, &bucket, &token, "missing-descriptor").await;
            client
                .put_object()
                .bucket(&bucket)
                .key(DESCRIPTOR_KEY)
                .body(ByteStream::from(bytes.clone()))
                .send()
                .await
                .unwrap();
            let token = session(&client, &bucket, PASSPHRASE).await.unwrap();
            client
                .put_object()
                .bucket(&bucket)
                .key(DESCRIPTOR_KEY)
                .body(ByteStream::from(other_bytes))
                .send()
                .await
                .unwrap();
            assert_refused(&client, &bucket, &token, "replaced-descriptor").await;
            client
                .put_object()
                .bucket(&bucket)
                .key(DESCRIPTOR_KEY)
                .body(ByteStream::from(bytes))
                .send()
                .await
                .unwrap();
            client
                .delete_object()
                .bucket(&bucket)
                .key("read-probe.bin")
                .send()
                .await
                .unwrap();
            let start = Instant::now();
            let token = session(&client, &bucket, PASSPHRASE).await.unwrap();
            println!(
                "BROWS3_UNLOCK {{\"elapsed_ns\":{}}}",
                start.elapsed().as_nanos()
            );
            (bucket, (token, other_secret))
        },
        |request, (token, _)| async move {
            let job = request.job;
            let path = Path::new(&job.local_path);
            transfer_with_client(
                &request.client,
                IDENTITY,
                &token,
                matches!(job.transfer_type, TransferType::Upload),
                &job.bucket,
                &job.key,
                path,
            )
            .await
        },
        |client, bucket, key, target, (_, wrong_key)| async move {
            let original = std::fs::read(&target).unwrap();
            let vacant = target.with_extension("not-created");
            for destination in [&vacant, &target] {
                assert!(
                    download(&client, &bucket, &key, destination, wrong_key.clone(),)
                        .await
                        .is_err()
                );
            }
            assert!(!vacant.exists());
            assert_eq!(std::fs::read(target).unwrap(), original);
        },
    )
    .await;
}
