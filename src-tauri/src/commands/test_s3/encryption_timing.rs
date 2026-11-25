use super::*;
use aws_sdk_s3::config::interceptors::BeforeTransmitInterceptorContextRef;
use aws_sdk_s3::config::{ConfigBag, Credentials, Intercept, Region, RuntimeComponents};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(target_os = "linux")]
#[path = "raw_cpu.rs"]
mod raw_cpu;

#[derive(Clone, Debug, Default)]
struct BeforeWire(Arc<Mutex<Option<Instant>>>);

impl Intercept for BeforeWire {
    fn name(&self) -> &'static str {
        "EncryptedUploadBeforeWire"
    }

    fn read_before_transmit(
        &self,
        context: &BeforeTransmitInterceptorContextRef<'_>,
        _: &RuntimeComponents,
        _: &mut ConfigBag,
    ) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let stop = Instant::now();
        #[cfg(target_os = "linux")]
        raw_cpu::end_window();
        let request = context.request();
        assert_eq!(request.method(), "PUT");
        assert!(request.headers().get("authorization").is_some());
        assert!(self.0.lock().unwrap().replace(stop).is_none());
        Err("profiling complete at HTTP transport boundary".into())
    }
}

fn benchmark_client(stop: BeforeWire) -> Client {
    let config = aws_sdk_s3::Config::builder()
        .behavior_version_latest()
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new(
            "TEST",
            "test-secret",
            None,
            None,
            "profile",
        ))
        .endpoint_url("http://127.0.0.1:1")
        .force_path_style(true)
        .retry_config(aws_sdk_s3::config::retry::RetryConfig::disabled())
        .interceptor(stop)
        .build();
    Client::from_conf(config)
}

#[tokio::test]
#[ignore = "release-mode encryption timing"]
async fn profile_encryption_before_wire() {
    let stop = BeforeWire::default();
    let client = benchmark_client(stop.clone());
    let bucket = format!("b3e1-{}", "a".repeat(32));
    let key = envelope::random_key().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("source");
    for bytes in [4096, 8 * 1024 * 1024] {
        std::fs::write(&path, vec![0x57; bytes]).unwrap();
        let mut samples = Vec::new();
        let mut plain_samples = Vec::new();
        for sample in 0..=21 {
            // Alternate the order so neither mode always gets the first preparation.
            for protected in [sample % 2 == 0, sample % 2 != 0] {
                let start = if protected {
                    let (send, start) = tokio::sync::oneshot::channel();
                    let result = upload_with_start(
                        &client,
                        &bucket,
                        "object",
                        &path,
                        key.clone(),
                        move || {
                            let _ = send.send(Instant::now());
                        },
                    )
                    .await;
                    assert!(result.is_err());
                    start.await.unwrap()
                } else {
                    crate::transfer::manager::transfer_profile::prepare_plain_upload(
                        &client,
                        &path,
                        bytes as u64,
                        || {},
                    )
                    .await
                };
                let end = stop
                    .0
                    .lock()
                    .unwrap()
                    .take()
                    .expect("signed PUT reached the pre-transmit hook");
                if sample > 0 {
                    let elapsed = end.duration_since(start).as_nanos();
                    if protected {
                        samples.push(elapsed);
                    } else {
                        plain_samples.push(elapsed);
                    }
                }
            }
        }
        println!(
            "BROWS3_ENCRYPTION_NS {}",
            serde_json::json!({
                "bytes": bytes, "samples_ns": samples, "plain_samples_ns": plain_samples
            })
        );
    }
}
