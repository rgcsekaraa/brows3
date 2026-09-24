//! Unauthenticated/public HTTP transport. Validate and pin DNS on every redirect.
use crate::error::{AppError, Result};
use reqwest::{header::HeaderMap, Method, Response};
use std::{net::IpAddr, time::Duration};
use url::Url;

pub fn parse_url(value: &str) -> Result<Url> {
    if value.len() > 16_384 || value.chars().any(char::is_control) || value.trim() != value {
        return Err(AppError::ConfigError(
            "URL is too long or contains whitespace/control characters.".into(),
        ));
    }
    let url = Url::parse(value)
        .map_err(|_| AppError::ConfigError("Enter an absolute HTTP or HTTPS URL.".into()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AppError::ConfigError(
            "Use HTTP or HTTPS without embedded credentials.".into(),
        ));
    }
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_broadcast()
                || v.is_documentation()
                || a == 0
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 198 && (b == 18 || b == 19))
                || (a == 192 && b == 0 && c == 0))
        }
        IpAddr::V6(v) => {
            // Only global unicast, excluding documentation and transition mechanisms.
            let s = v.segments();
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
        }
    }
}

pub async fn request(value: &str, method: Method, headers: HeaderMap) -> Result<Response> {
    let mut url = parse_url(value)?;
    let original_origin = url.origin();
    for _ in 0..=5 {
        let host = url
            .host_str()
            .ok_or_else(|| AppError::ConfigError("Missing URL host.".into()))?;
        let port = url.port_or_known_default().unwrap_or(443);
        let addresses: Vec<_> = tokio::time::timeout(
            Duration::from_secs(15),
            tokio::net::lookup_host((host.trim_matches(['[', ']']), port)),
        )
        .await
        .map_err(|_| AppError::S3Error("Source DNS lookup timed out.".into()))?
        .map_err(|_| AppError::S3Error("Cannot resolve source host.".into()))?
        .collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
            return Err(AppError::ConfigError("URL imports and access checks require a public internet address; private/local networks are blocked.".into()));
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|_| AppError::ConfigError("Cannot initialize HTTP client.".into()))?;
        let mut outgoing = if url.origin() == original_origin {
            headers.clone()
        } else {
            HeaderMap::new()
        };
        outgoing.insert(
            reqwest::header::ACCEPT_ENCODING,
            reqwest::header::HeaderValue::from_static("identity"),
        );
        let response = tokio::time::timeout(
            Duration::from_secs(60),
            client
                .request(method.clone(), url.clone())
                .headers(outgoing)
                .send(),
        )
        .await
        .map_err(|_| AppError::S3Error("Source request timed out. Retry the import.".into()))?
        .map_err(|_| {
            AppError::S3Error(
                "Cannot connect to source. Check the URL, TLS certificate and network, then retry."
                    .into(),
            )
        })?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        let next = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|s| s.to_str().ok())
            .and_then(|s| url.join(s).ok())
            .ok_or_else(|| AppError::ConfigError("Invalid source redirect.".into()))?;
        parse_url(next.as_str())?;
        if url.scheme() == "https" && next.scheme() != "https" {
            return Err(AppError::ConfigError(
                "HTTPS downgrade redirects are blocked.".into(),
            ));
        }
        url = next;
    }
    Err(AppError::ConfigError(
        "Source redirected more than five times.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_local_metadata_and_non_http_sources() {
        for ip in [
            "127.0.0.1",
            "169.254.169.254",
            "10.0.0.1",
            "100.100.100.200",
            "192.168.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fd00::1",
            "2002:7f00:1::",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/a",
            "https://user:pass@example.com/a",
            "https://example.com/\n",
        ] {
            assert!(parse_url(url).is_err());
        }
    }
}
