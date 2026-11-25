export const reservedBucket = (name: string) => name.startsWith('b3e1-');
export const validProtectedBucket = (name: string) => /^b3e1-[0-9a-f]{32}$/.test(name);
export const lockedBucketTitle = (name: string) => validProtectedBucket(name) ? `Locked bucket · ${name.slice(-8)}` : 'Unrecognized protected bucket';
export const validPrivateLabel = (label: string) => !!label.trim() && new TextEncoder().encode(label.trim()).length <= 128 && !Array.from(label).some(character => {
  const code = character.charCodeAt(0);
  return code < 32 || (code >= 127 && code <= 159);
});
export const isUserObject = (key: string) => key !== '.brows3' && !key.startsWith('.brows3/');

export function watchSessionExpiry(expiresAtMs: number, expire: () => void) {
  const remaining = expiresAtMs - Date.now();
  const check = () => { if (Date.now() >= expiresAtMs) expire(); };
  const timer = window.setTimeout(expire, Math.max(0, remaining));
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', check);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('focus', check);
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', check);
  };
}

export type EncryptedTarget = { mode: 'upload'; prefix: string } | { mode: 'download'; key: string };

export function encryptedObjectKey(target: EncryptedTarget, localPath: string) {
  if (!localPath) return null;
  if (target.mode === 'download') return isUserObject(target.key) ? target.key : null;
  const name = localPath.split(/[\\/]/).pop();
  const key = `${target.prefix}${name}`;
  return name && isUserObject(key) ? key : null;
}

export function validTransferPassphrase(passphrase: string) {
  const bytes = new TextEncoder().encode(passphrase).length;
  return bytes >= 12 && bytes <= 1024;
}
