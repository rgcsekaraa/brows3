//! AWS SDK HTTPS client using the Mozilla CA bundle (curl `cacert.pem`) instead of relying solely
//! on OS native roots parsed by rustls. On some Windows setups, `rustls-native-certs` yields zero
//! roots that rustls accepts, which triggers a `debug_assert!` panic inside `aws-smithy-http-client`.

use std::sync::OnceLock;

use aws_config::ConfigLoader;
use aws_smithy_http_client::{tls, Builder};
use aws_types::sdk_config::SharedHttpClient;
use tls::rustls_provider::CryptoMode;

static HTTPS_CLIENT: OnceLock<SharedHttpClient> = OnceLock::new();

/// Install the aws-lc rustls crypto provider once per process (required for rustls 0.23+).
pub fn init_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

/// Shared HTTPS client wired to Mozilla trust anchors (bundled `certs/cacert.pem`).
pub fn shared_https_client() -> SharedHttpClient {
    HTTPS_CLIENT.get_or_init(build_https_client).clone()
}

/// [`aws_config::defaults`] with the Brows3 HTTPS client applied.
pub fn config_defaults() -> ConfigLoader {
    aws_config::defaults(aws_config::BehaviorVersion::latest()).http_client(shared_https_client())
}

fn build_https_client() -> SharedHttpClient {
    const MOZILLA_CA_PEM: &[u8] = include_bytes!("../certs/cacert.pem");
    let trust = tls::TrustStore::empty()
        .with_native_roots(false)
        .with_pem_certificate(MOZILLA_CA_PEM);
    let tls_ctx = tls::TlsContext::builder()
        .with_trust_store(trust)
        .build()
        .expect("bundled Mozilla CA PEM should produce a valid TLS trust store");

    Builder::new()
        .tls_provider(tls::Provider::Rustls(CryptoMode::AwsLc))
        .tls_context(tls_ctx)
        .build_https()
}
