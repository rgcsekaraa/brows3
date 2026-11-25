use libsodium_sys as sodium;
use sodium::{
    crypto_pwhash, crypto_secretstream_xchacha20poly1305_init_pull,
    crypto_secretstream_xchacha20poly1305_init_push, crypto_secretstream_xchacha20poly1305_pull,
    crypto_secretstream_xchacha20poly1305_push, randombytes_buf, sodium_init,
};
use std::io::{self, Read, Write};
use std::ptr;
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"B3ENC\0\0\x01";
const OBJECT_MAGIC: &[u8; 8] = b"B3OBJ\0\0\x01";
const CHUNK: usize = 64 * 1024;
const OVERHEAD: usize = sodium::crypto_secretstream_xchacha20poly1305_ABYTES as usize;
const FINAL: u8 = sodium::crypto_secretstream_xchacha20poly1305_TAG_FINAL as u8;
pub(crate) const MAX_PLAIN: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_CIPHER: u64 =
    32 + MAX_PLAIN + (MAX_PLAIN / CHUNK as u64 + 1) * OVERHEAD as u64;
pub(crate) type Key = Zeroizing<[u8; 32]>;

struct Stream(Box<sodium::crypto_secretstream_xchacha20poly1305_state>);

impl Drop for Stream {
    fn drop(&mut self) {
        unsafe {
            sodium::sodium_memzero(
                std::ptr::from_mut(self.0.as_mut()).cast(),
                std::mem::size_of_val(self.0.as_ref()),
            );
        }
    }
}

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Invalid encrypted file or passphrase",
    )
}

pub(crate) fn valid_passphrase(pass: &str) -> bool {
    (12..=1024).contains(&pass.len())
}

fn init() -> io::Result<Stream> {
    if unsafe { sodium_init() } < 0 {
        return Err(invalid());
    }
    Ok(Stream(Box::new(unsafe { std::mem::zeroed() })))
}

fn derive(pass: &str, salt: &[u8; 16]) -> io::Result<Zeroizing<[u8; 32]>> {
    if !valid_passphrase(pass) {
        return Err(invalid());
    }
    let mut key = Zeroizing::new([0; 32]);
    let status = unsafe {
        crypto_pwhash(
            key.as_mut_ptr(),
            32,
            pass.as_ptr().cast(),
            pass.len() as u64,
            salt.as_ptr(),
            2,
            64 << 20,
            sodium::crypto_pwhash_ALG_ARGON2ID13 as i32,
        )
    };
    if status != 0 {
        return Err(invalid());
    }
    Ok(key)
}

fn fill(reader: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut used = 0;
    while used < buf.len() {
        match reader.read(&mut buf[used..]) {
            Ok(0) => break,
            Ok(count) => used += count,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        }
    }
    Ok(used)
}

pub(crate) fn random_key() -> io::Result<Key> {
    if unsafe { sodium_init() } < 0 {
        return Err(invalid());
    }
    let mut key = Zeroizing::new([0; 32]);
    unsafe { randombytes_buf(key.as_mut_ptr().cast(), key.len()) };
    Ok(key)
}

pub(crate) fn encrypt(input: impl Read, mut output: impl Write, pass: &str) -> io::Result<()> {
    let state = init()?;
    let mut salt = [0; 16];
    unsafe { randombytes_buf(salt.as_mut_ptr().cast(), salt.len()) };
    let key = derive(pass, &salt)?;
    output.write_all(MAGIC)?;
    output.write_all(&salt)?;
    seal(input, output, &key, MAGIC, state)
}

pub(crate) fn encrypt_object(
    input: impl Read,
    mut output: impl Write,
    key: &Key,
    context: &[u8],
) -> io::Result<()> {
    output.write_all(OBJECT_MAGIC)?;
    seal(input, output, key, context, init()?)
}

fn seal(
    mut input: impl Read,
    mut output: impl Write,
    key: &Key,
    context: &[u8],
    mut state: Stream,
) -> io::Result<()> {
    let mut header = [0; 24];
    if unsafe {
        crypto_secretstream_xchacha20poly1305_init_push(
            state.0.as_mut(),
            header.as_mut_ptr(),
            key.as_ptr(),
        )
    } != 0
    {
        return Err(invalid());
    }
    output.write_all(&header)?;
    let mut plain = Zeroizing::new(vec![0; CHUNK]);
    let mut cipher = vec![0; CHUNK + OVERHEAD];
    let mut total = 0;
    loop {
        let count = fill(&mut input, &mut plain)?;
        total += count as u64;
        if total > MAX_PLAIN {
            return Err(invalid());
        }
        let tag = if count < CHUNK { FINAL } else { 0 };
        if unsafe {
            crypto_secretstream_xchacha20poly1305_push(
                state.0.as_mut(),
                cipher.as_mut_ptr(),
                ptr::null_mut(),
                plain.as_ptr(),
                count as u64,
                context.as_ptr(),
                context.len() as u64,
                tag,
            )
        } != 0
        {
            return Err(invalid());
        }
        output.write_all(&cipher[..count + OVERHEAD])?;
        if tag == FINAL {
            return Ok(());
        }
    }
}

pub(crate) fn decrypt(mut input: impl Read, output: impl Write, pass: &str) -> io::Result<()> {
    let mut magic = [0; 8];
    let mut salt = [0; 16];
    input.read_exact(&mut magic)?;
    if magic != *MAGIC {
        return Err(invalid());
    }
    input.read_exact(&mut salt)?;
    let state = init()?;
    let key = derive(pass, &salt)?;
    open(input, output, &key, MAGIC, state)
}

pub(crate) fn decrypt_object(
    mut input: impl Read,
    output: impl Write,
    key: &Key,
    context: &[u8],
) -> io::Result<()> {
    let mut magic = [0; 8];
    input.read_exact(&mut magic)?;
    if magic != *OBJECT_MAGIC {
        return Err(invalid());
    }
    open(input, output, key, context, init()?)
}

fn open(
    mut input: impl Read,
    mut output: impl Write,
    key: &Key,
    context: &[u8],
    mut state: Stream,
) -> io::Result<()> {
    let mut header = [0; 24];
    input.read_exact(&mut header)?;
    if unsafe {
        crypto_secretstream_xchacha20poly1305_init_pull(
            state.0.as_mut(),
            header.as_ptr(),
            key.as_ptr(),
        )
    } != 0
    {
        return Err(invalid());
    }
    let mut plain = Zeroizing::new(vec![0; CHUNK]);
    let mut cipher = vec![0; CHUNK + OVERHEAD];
    let mut total = 0;
    loop {
        let count = fill(&mut input, &mut cipher)?;
        if count < OVERHEAD {
            return Err(invalid());
        }
        let mut tag = 0;
        let len = count - OVERHEAD;
        total += len as u64;
        if total > MAX_PLAIN
            || unsafe {
                crypto_secretstream_xchacha20poly1305_pull(
                    state.0.as_mut(),
                    plain.as_mut_ptr(),
                    ptr::null_mut(),
                    &mut tag,
                    cipher.as_ptr(),
                    count as u64,
                    context.as_ptr(),
                    context.len() as u64,
                )
            } != 0
        {
            return Err(invalid());
        }
        if tag != (if len < CHUNK { FINAL } else { 0 }) {
            return Err(invalid());
        }
        output.write_all(&plain[..len])?;
        if tag == FINAL {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PASS: &str = "ephemeral test passphrase";

    #[test]
    fn authentication_and_chunk_boundaries() {
        for len in [0, 1, CHUNK - 1, CHUNK, CHUNK * 2 + 7] {
            let input = vec![0xa7; len];
            let mut cipher = Vec::new();
            encrypt(&input[..], &mut cipher, PASS).unwrap();
            let mut result = Vec::new();
            decrypt(&cipher[..], &mut result, PASS).unwrap();
            assert_eq!(result, input);
            assert!(!cipher.windows(32).any(|chunk| chunk == [0xa7; 32]));
            assert!(!cipher
                .windows(PASS.len())
                .any(|chunk| chunk == PASS.as_bytes()));
        }
    }

    #[test]
    fn rejects_damaged_reordered_or_unterminated_streams() {
        let mut cipher = Vec::new();
        encrypt(io::repeat(7).take((2 * CHUNK) as u64), &mut cipher, PASS).unwrap();
        let reject = |bytes: &[u8]| assert!(decrypt(bytes, io::sink(), PASS).is_err());
        assert!(decrypt(&cipher[..], io::sink(), "different passphrase").is_err());
        for offset in [0, 8, 24, 48, cipher.len() - 1] {
            let mut altered = cipher.clone();
            altered[offset] ^= 1;
            reject(&altered);
        }
        let frame = CHUNK + OVERHEAD;
        let mut swapped = cipher.clone();
        swapped[48..48 + frame * 2].rotate_left(frame);
        reject(&swapped);
        reject(&cipher[..cipher.len() - OVERHEAD]);
        reject(&cipher[..cipher.len() - 1]);
        cipher.push(0);
        reject(&cipher);
    }

    #[test]
    fn encryption_is_randomized_and_rejects_invalid_passwords() {
        let mut first = Vec::new();
        let mut second = Vec::new();
        assert!(encrypt(io::empty(), &mut first, "short").is_err());
        assert!(first.is_empty());
        encrypt(io::empty(), &mut first, PASS).unwrap();
        encrypt(io::empty(), &mut second, PASS).unwrap();
        assert_ne!(first, second);
    }
}
