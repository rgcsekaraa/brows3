use super::envelope::{self, Key};
use sha2::{Digest, Sha256};
use std::io;
use zeroize::Zeroizing;

pub(crate) const PREFIX: &str = "b3e1-";
pub(crate) const DESCRIPTOR_KEY: &str = ".brows3/key-v1";
const PAYLOAD_BYTES: usize = 32 + 1 + 128;
pub(crate) const DESCRIPTOR_BYTES: usize = 48 + PAYLOAD_BYTES + 17;

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Protected bucket unavailable")
}

pub(crate) fn physical_name(descriptor: &[u8]) -> String {
    let hash = format!("{:x}", Sha256::digest(descriptor));
    format!("{PREFIX}{}", &hash[..32])
}

pub(crate) fn physical(bucket: &str) -> bool {
    bucket.strip_prefix(PREFIX).is_some_and(|id| {
        id.len() == 32
            && id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

pub(crate) fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 128
        && label.trim() == label
        && !label.chars().any(char::is_control)
}

pub(crate) fn descriptor(label: &str, pass: &str) -> io::Result<Vec<u8>> {
    let label = label.trim();
    if !valid_label(label) {
        return Err(invalid());
    }
    let key = envelope::random_key()?;
    let mut payload = Zeroizing::new([0; PAYLOAD_BYTES]);
    payload[..32].copy_from_slice(&key[..]);
    payload[32] = label.len() as u8;
    payload[33..33 + label.len()].copy_from_slice(label.as_bytes());
    let mut cipher = Vec::with_capacity(DESCRIPTOR_BYTES);
    envelope::encrypt(&payload[..], &mut cipher, pass)?;
    Ok(cipher)
}

pub(crate) fn unlock(bucket: &str, descriptor: &[u8], pass: &str) -> io::Result<(Key, String)> {
    if descriptor.len() != DESCRIPTOR_BYTES || physical_name(descriptor) != bucket {
        return Err(invalid());
    }
    let mut payload = Zeroizing::new([0; PAYLOAD_BYTES]);
    let mut writer = &mut payload[..];
    envelope::decrypt(descriptor, &mut writer, pass)?;
    if !writer.is_empty() {
        return Err(invalid());
    }
    let length = usize::from(payload[32]);
    let label = std::str::from_utf8(payload.get(33..33 + length).ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    if !valid_label(label) || payload[33 + length..].iter().any(|byte| *byte != 0) {
        return Err(invalid());
    }
    let mut key = Zeroizing::new([0; 32]);
    key.copy_from_slice(&payload[..32]);
    Ok((key, label.to_owned()))
}

pub(crate) fn context(bucket: &str, key: &str) -> io::Result<Vec<u8>> {
    if !physical(bucket)
        || key.is_empty()
        || key.len() > 1024
        || key.contains('\0')
        || key == ".brows3"
        || key.starts_with(".brows3/")
    {
        return Err(invalid());
    }
    Ok(format!("brows3:object:v1\0{bucket}\0{key}").into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_random_names_commit_to_fixed_authenticated_descriptors() {
        let label = "Internal payroll — 東京";
        let pass = "correct horse battery staple";
        let first = descriptor(label, pass).unwrap();
        let other = descriptor(label, pass).unwrap();
        let bucket = physical_name(&first);
        assert!(physical(&bucket));
        assert_eq!(first.len(), DESCRIPTOR_BYTES);
        assert_ne!(bucket, physical_name(&other));
        assert!(!first
            .windows(label.len())
            .any(|window| window == label.as_bytes()));
        assert_eq!(unlock(&bucket, &first, pass).unwrap().1, label);
        assert!(unlock(&bucket, &first, "incorrect passphrase").is_err());
        assert!(unlock(&bucket, &other, pass).is_err());
        assert!(unlock(&bucket, &first[..first.len() - 1], pass).is_err());
    }

    #[test]
    fn object_identity_is_authenticated() {
        let bucket = format!("{PREFIX}{}", "a".repeat(32));
        let secret = envelope::random_key().unwrap();
        let context1 = context(&bucket, "first").unwrap();
        let context2 = context(&bucket, "second").unwrap();
        let mut cipher = Vec::new();
        envelope::encrypt_object(&b"payload"[..], &mut cipher, &secret, &context1).unwrap();
        assert!(envelope::decrypt_object(&cipher[..], io::sink(), &secret, &context2).is_err());
        assert!(envelope::decrypt_object(&cipher[..], io::sink(), &secret, &context1).is_ok());
        assert!(context(&bucket, DESCRIPTOR_KEY).is_err());
    }
}
