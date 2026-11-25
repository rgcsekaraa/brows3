use crate::error::{AppError, Result};
use crate::transfer::bucket_crypto::PREFIX;

pub(crate) fn require_plain(bucket: &str) -> Result<()> {
    let edge = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    if bucket.is_empty()
        || bucket.len() > 63
        || bucket.starts_with(PREFIX)
        || !bucket.bytes().next().is_some_and(edge)
        || !bucket.bytes().last().is_some_and(edge)
        || bucket.contains("..")
        || !bucket
            .bytes()
            .all(|byte| edge(byte) || matches!(byte, b'.' | b'-'))
        || ["-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3"]
            .iter()
            .any(|suffix| bucket.ends_with(suffix))
    {
        Err(AppError::ConfigError("This operation requires an ordinary literal bucket name. Protected buckets require an unlocked encrypted transfer.".into()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_paths_deny_reserved_incomplete_and_aliased_buckets() {
        for bucket in [
            "b3e1-invalid",
            "b3e1-0123456789abcdef0123456789abcdef",
            "arn:aws:s3:::bucket",
            "example-s3alias",
            "example.mrap",
            "example--ol-s3",
            "example--x-s3",
            "example--table-s3",
            "bucket/path",
            "bucket%2f",
            "Bucket",
        ] {
            assert!(require_plain(bucket).is_err());
        }
        assert!(require_plain("ordinary.example-bucket").is_ok());
    }
}
