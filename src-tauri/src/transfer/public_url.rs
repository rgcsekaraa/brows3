use crate::credentials::{CredentialType, Profile};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PublicUrls {
    pub base_url: String,
    pub include_bucket: bool,
    pub bucket_overrides: BTreeMap<String, String>,
}

pub fn base_url(value: &str) -> Result<url::Url> {
    let parsed = super::web::parse_url(value)?;
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError::ConfigError(
            "Public base URLs cannot contain a query or fragment.".into(),
        ));
    }
    Ok(parsed)
}

impl PublicUrls {
    pub fn validate(&self) -> Result<()> {
        if !self.base_url.is_empty() {
            base_url(&self.base_url)?;
        }
        if self.bucket_overrides.len() > 100 {
            return Err(AppError::ConfigError(
                "At most 100 bucket URL overrides are allowed.".into(),
            ));
        }
        for (bucket, value) in &self.bucket_overrides {
            if bucket.is_empty() || bucket.contains('/') {
                return Err(AppError::ConfigError(
                    "Enter a bucket name for each override.".into(),
                ));
            }
            base_url(value)?;
        }
        Ok(())
    }
}

pub fn build(profile: &Profile, bucket: &str, region: Option<&str>, key: &str) -> Result<String> {
    if bucket.is_empty() || bucket.contains('/') || key.is_empty() || key.ends_with('/') {
        return Err(AppError::ConfigError(
            "Choose files, not folders, to copy public URLs.".into(),
        ));
    }
    if key.split('/').any(|s| s == "." || s == "..") {
        return Err(AppError::ConfigError(
            "Keys containing dot-only path segments cannot safely form public URLs.".into(),
        ));
    }
    let settings = &profile.public_urls;
    settings.validate()?;
    let (base, include_bucket) = if let Some(base) = settings.bucket_overrides.get(bucket) {
        (base.clone(), false)
    } else if !settings.base_url.is_empty() {
        (settings.base_url.clone(), settings.include_bucket)
    } else if let CredentialType::CustomEndpoint { endpoint_url, .. } = &profile.credential_type {
        (
            crate::s3::client::normalize_endpoint_url(endpoint_url),
            true,
        )
    } else {
        let region = region.or(profile.region.as_deref()).unwrap_or("us-east-1");
        if !region
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || region.is_empty()
        {
            return Err(AppError::ConfigError(
                "Configure a public base URL for this region.".into(),
            ));
        }
        let suffix = if region.starts_with("cn-") {
            "amazonaws.com.cn"
        } else {
            "amazonaws.com"
        };
        // Path-style avoids TLS wildcard problems for bucket names containing dots.
        (format!("https://s3.{region}.{suffix}"), true)
    };
    let base = base_url(&base)?;
    let key = key
        .split('/')
        .map(|s| urlencoding::encode(s).into_owned())
        .collect::<Vec<_>>()
        .join("/");
    let bucket = if include_bucket {
        format!("{}/", urlencoding::encode(bucket))
    } else {
        String::new()
    };
    Ok(format!(
        "{}/{bucket}{key}",
        base.as_str().trim_end_matches('/')
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encodes_literal_keys_and_honors_bucket_roots() {
        let mut p = Profile::new("test".into(), CredentialType::Environment, None);
        p.public_urls.base_url = "https://cdn.example.com/assets/".into();
        assert_eq!(
            build(&p, "bucket", None, "a b/é#%?.txt").unwrap(),
            "https://cdn.example.com/assets/a%20b/%C3%A9%23%25%3F.txt"
        );
        p.public_urls.include_bucket = true;
        assert!(build(&p, "bucket", None, "a.txt")
            .unwrap()
            .contains("/assets/bucket/a.txt"));
        p.public_urls
            .bucket_overrides
            .insert("bucket".into(), "https://other.example.com".into());
        assert_eq!(
            build(&p, "bucket", None, "a.txt").unwrap(),
            "https://other.example.com/a.txt"
        );
        assert!(build(&p, "bucket", None, "../x").is_err());
        assert!(base_url("https://cdn.example.com/?token=secret").is_err());
        assert!(base_url("https://user:secret@cdn.example.com").is_err());
    }
}
