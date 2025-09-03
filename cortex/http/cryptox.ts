// cryptox.ts
/**
 * cryptox — common crypto helpers (encryption, hashing, checksum, HMAC, KDF)
 * - AES-256-GCM encrypt/decrypt
 * - scrypt KDF
 * - SHA-256/SHA-512/MD5 (MD5 for checksum only)
 * - HMAC (SHA-256 by default)
 * - CRC32 checksum (JS table-based)
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, scryptSync } from 'crypto';

export type Encoded = 'hex'|'base64'|'base64url';

export interface AesGcmCiphertext {
  algo: 'aes-256-gcm';
  iv: string;       // base64
  tag: string;      // base64
  ct: string;       // base64
  aad?: string;     // base64
}

export function aes256gcmEncrypt(plaintext: Buffer|string, key: Buffer|string, aad?: Buffer|string): AesGcmCiphertext {
  const k = typeof key === 'string' ? Buffer.from(key, 'base64') : key;
  if (k.length !== 32) throw new Error('Key must be 32 bytes for AES-256-GCM (pass base64 for string input)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  if (aad) cipher.setAAD(toBuf(aad));
  const ct = Buffer.concat([cipher.update(toBuf(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algo: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
    ...(aad ? { aad: toBuf(aad).toString('base64') } : {})
  };
}

export function aes256gcmDecrypt(obj: AesGcmCiphertext, key: Buffer|string, encoding: BufferEncoding = 'utf8'): string {
  const k = typeof key === 'string' ? Buffer.from(key, 'base64') : key;
  if (k.length !== 32) throw new Error('Key must be 32 bytes for AES-256-GCM (pass base64 for string input)');
  const iv = Buffer.from(obj.iv, 'base64');
  const tag = Buffer.from(obj.tag, 'base64');
  const ct = Buffer.from(obj.ct, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', k, iv);
  if (obj.aad) decipher.setAAD(Buffer.from(obj.aad, 'base64'));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString(encoding);
}

export interface DerivedKey {
  salt: string; // base64
  key: string;  // base64 (32 bytes)
}

/** Derive a 32-byte key using scrypt (salt generated if not provided) */
export function deriveKeyScrypt(password: string, salt?: Buffer|string, N = 1<<15, r = 8, p = 1): DerivedKey {
  const s = salt ? toBuf(salt) : randomBytes(16);
  const key = scryptSync(password, s, 32, { N, r, p });
  return { salt: s.toString('base64'), key: key.toString('base64') };
}

/** Hash (SHA-256 default). Use MD5 only for checksums (non-cryptographic). */
export function hash(data: Buffer|string, algo: 'sha256'|'sha512'|'md5' = 'sha256', enc: Encoded = 'hex'): string {
  return createHash(algo).update(toBuf(data)).digest(enc);
}

export function hmac(data: Buffer|string, key: Buffer|string, algo: 'sha256'|'sha512' = 'sha256', enc: Encoded = 'hex'): string {
  return createHmac(algo, toBuf(key)).update(toBuf(data)).digest(enc);
}

/** CRC32 checksum (IEEE 802.3) */
export function crc32(data: Buffer|string): string {
  const table = CRC32_TABLE;
  let crc = 0 ^ -1;
  const buf = toBuf(data);
  for (let i=0; i<buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
}

export function randomKeyBase64(bytes = 32): string {
  return randomBytes(bytes).toString('base64');
}

function toBuf(v: Buffer|string): Buffer {
  return Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8');
}

/* ------------------------------- CRC32 table ------------------------------- */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();


// ------------------------------ Usage examples ------------------------------
// (uncomment to test; run with ts-node or compile to JS)
//
// // Example imports
// import { hash, hmac, crc32, deriveKeyScrypt, aes256gcmEncrypt, aes256gcmDecrypt, randomKeyBase64 } from '../cryptox';
//
// const k = randomKeyBase64(32);
// const cipher = aes256gcmEncrypt('secret data', Buffer.from(k, 'base64'));
// const plain  = aes256gcmDecrypt(cipher, Buffer.from(k, 'base64'));
//
// const digest = hash('hello', 'sha256', 'hex');
// const sig    = hmac('payload', 'shared-secret');
// const sum    = crc32('file-bytes-here');
//
// const { salt, key } = deriveKeyScrypt('password');