// cortex/framework/cryptox.ts
// Zero-dependency crypto helpers for hashing, HMAC, random IDs,
// AES-256-GCM encryption, KDFs (scrypt/pbkdf2), timing-safe compare,
// and a tiny HS256 JWT helper.
//
// All outputs that are strings use URL-safe Base64 ("base64url") by default.

import crypto from "node:crypto";

/* ────────────────────────────────────────────────────────────────────────────
 * Types & small helpers
 * ──────────────────────────────────────────────────────────────────────────── */
export type ByteSource = string | Buffer | Uint8Array;

function toBuffer(input: ByteSource): Buffer {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) return Buffer.from(input);
    return Buffer.from(String(input), "utf8");
}

export function b64urlEncode(buf: ByteSource): string {
    const b = toBuffer(buf);
    return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlDecode(str: string): Buffer {
    const pad = str.length % 4 ? 4 - (str.length % 4) : 0;
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + (pad ? "=".repeat(pad) : "");
    return Buffer.from(b64, "base64");
}

export function hexEncode(buf: ByteSource): string {
    return toBuffer(buf).toString("hex");
}

export function constantTimeEqual(a: ByteSource, b: ByteSource): boolean {
    const A = toBuffer(a);
    const B = toBuffer(b);
    if (A.length !== B.length) return false;
    try {
        return crypto.timingSafeEqual(A, B);
    } catch {
        return false;
    }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Randomness
 * ──────────────────────────────────────────────────────────────────────────── */
export function randomBytes(size = 32): Buffer {
    return crypto.randomBytes(Math.max(1, size));
}

/** URL-safe random ID (default ~22 chars = 16 random bytes). */
export function randomId(bytes = 16): string {
    return b64urlEncode(randomBytes(bytes));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Hashing & HMAC
 * ──────────────────────────────────────────────────────────────────────────── */
export type HashOut = "hex" | "base64url" | "buffer";

export function sha256(data: ByteSource, out: HashOut = "hex"): string | Buffer {
    const h = crypto.createHash("sha256").update(toBuffer(data)).digest();
    if (out === "buffer") return h;
    if (out === "base64url") return b64urlEncode(h);
    return h.toString("hex");
}

export function sha512(data: ByteSource, out: HashOut = "hex"): string | Buffer {
    const h = crypto.createHash("sha512").update(toBuffer(data)).digest();
    if (out === "buffer") return h;
    if (out === "base64url") return b64urlEncode(h);
    return h.toString("hex");
}

export function hmacSha256(key: ByteSource, data: ByteSource, out: HashOut = "hex"): string | Buffer {
    const mac = crypto.createHmac("sha256", toBuffer(key)).update(toBuffer(data)).digest();
    if (out === "buffer") return mac;
    if (out === "base64url") return b64urlEncode(mac);
    return mac.toString("hex");
}

/* ────────────────────────────────────────────────────────────────────────────
 * AES-256-GCM (authenticated encryption)
 * Key must be 32 bytes (256-bit). We produce a compact token string:
 *   v1.{iv}.{ciphertext}.{tag}   (each base64url)
 * AAD is optional and not embedded (must be provided on decrypt if used).
 * ──────────────────────────────────────────────────────────────────────────── */
export interface AesGcmEncryptOptions {
    iv?: Buffer;              // 12 bytes recommended; if not provided, random
    aad?: ByteSource;         // additional authenticated data (not encrypted)
}
export interface AesGcmDecryptOptions {
    aad?: ByteSource;
}

export function aesGcmEncryptToToken(
    plaintext: ByteSource,
    key: ByteSource,
    opts: AesGcmEncryptOptions = {},
): string {
    const K = toBuffer(key);
    if (K.length !== 32) throw new Error("aesGcmEncryptToToken: key must be 32 bytes (AES-256)");
    const iv = opts.iv ?? crypto.randomBytes(12);

    const cipher = crypto.createCipheriv("aes-256-gcm", K, iv);
    if (opts.aad) cipher.setAAD(toBuffer(opts.aad));
    const ct = Buffer.concat([cipher.update(toBuffer(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}.${b64urlEncode(tag)}`;
}

export function aesGcmDecryptFromToken(
    token: string,
    key: ByteSource,
    opts: AesGcmDecryptOptions = {},
): Buffer {
    const K = toBuffer(key);
    if (K.length !== 32) throw new Error("aesGcmDecryptFromToken: key must be 32 bytes (AES-256)");

    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Invalid token format");
    const iv = b64urlDecode(parts[1]);
    const ct = b64urlDecode(parts[2]);
    const tag = b64urlDecode(parts[3]);

    const decipher = crypto.createDecipheriv("aes-256-gcm", K, iv);
    if (opts.aad) decipher.setAAD(toBuffer(opts.aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/* ────────────────────────────────────────────────────────────────────────────
 * KDFs (scrypt / PBKDF2)
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ScryptOptions {
    N?: number;   // cost (2^14 default)
    r?: number;   // block size (8 default)
    p?: number;   // parallelization (1 default)
    keyLen?: number; // derived key length (32 default)
    salt?: ByteSource; // provide or auto-generate 16 bytes
}

/** Derive a key with scrypt; returns { key, salt } (both Buffers). */
export async function scryptKey(password: ByteSource, opts: ScryptOptions = {}): Promise<{ key: Buffer; salt: Buffer }> {
    const N = opts.N ?? 1 << 14;
    const r = opts.r ?? 8;
    const p = opts.p ?? 1;
    const keyLen = opts.keyLen ?? 32;
    const salt = opts.salt ? toBuffer(opts.salt) : crypto.randomBytes(16);

    // Prefer async scrypt (non-blocking)
    const scryptAsync: (pwd: Buffer, salt: Buffer, keylen: number, opts: any) => Promise<Buffer> =
        (crypto.scrypt as any)[Symbol.toStringTag] === "AsyncFunction"
            ? (crypto.scrypt as unknown as (...args: any[]) => Promise<Buffer>)
            : (pwd, s, k, o) => new Promise((resolve, reject) => {
                crypto.scrypt(pwd, s, k, o, (err, dk) => (err ? reject(err) : resolve(dk as Buffer)));
            });

    const key = await scryptAsync(toBuffer(password), salt, keyLen, { N, r, p });
    return { key, salt };
}

export interface Pbkdf2Options {
    iterations?: number; // default 100_000
    keyLen?: number;     // default 32
    digest?: "sha256" | "sha512";
    salt?: ByteSource;   // provide or auto-generate 16 bytes
}

/** Derive a key with PBKDF2; returns { key, salt }. */
export async function pbkdf2Key(password: ByteSource, opts: Pbkdf2Options = {}): Promise<{ key: Buffer; salt: Buffer }> {
    const iterations = opts.iterations ?? 100_000;
    const keyLen = opts.keyLen ?? 32;
    const digest = opts.digest ?? "sha256";
    const salt = opts.salt ? toBuffer(opts.salt) : crypto.randomBytes(16);

    const pbkdf2Async = (pwd: Buffer, s: Buffer) =>
        new Promise<Buffer>((resolve, reject) =>
            crypto.pbkdf2(pwd, s, iterations, keyLen, digest, (err, dk) => (err ? reject(err) : resolve(dk))),
        );

    const key = await pbkdf2Async(toBuffer(password), salt);
    return { key, salt };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tiny HS256 JWT helper (optional)
 * ──────────────────────────────────────────────────────────────────────────── */
type JwtHeader = { alg: "HS256"; typ: "JWT" };
type NumericDate = number; // seconds since epoch

export interface JwtSignOptions {
    /** seconds since epoch (exp) */
    exp?: NumericDate;
    /** seconds since epoch (nbf) */
    nbf?: NumericDate;
    /** seconds since epoch (iat), default now */
    iat?: NumericDate;
    /** arbitrary registered/public claims (e.g., sub, iss, aud, jti, custom) */
    [claim: string]: any;
}

export function jwtSignHS256(payload: Record<string, any>, secret: ByteSource, opts: JwtSignOptions = {}): string {
    const header: JwtHeader = { alg: "HS256", typ: "JWT" };
    const nowSec = Math.floor(Date.now() / 1000);
    const body = { iat: opts.iat ?? nowSec, ...payload };
    if (opts.exp != null) (body as any).exp = opts.exp;
    if (opts.nbf != null) (body as any).nbf = opts.nbf;
    // include any extra claims from opts (except known ones that we set above)
    for (const [k, v] of Object.entries(opts)) {
        if (k === "exp" || k === "nbf" || k === "iat") continue;
        (body as any)[k] = v;
    }

    const part1 = b64urlEncode(Buffer.from(JSON.stringify(header)));
    const part2 = b64urlEncode(Buffer.from(JSON.stringify(body)));
    const sig = hmacSha256(secret, `${part1}.${part2}`, "base64url") as string;
    return `${part1}.${part2}.${sig}`;
}

export interface JwtVerifyResult {
    header: JwtHeader;
    payload: Record<string, any>;
    valid: boolean;
    reason?: string;
}

export function jwtVerifyHS256(token: string, secret: ByteSource): JwtVerifyResult {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false, reason: "format", header: { alg: "HS256", typ: "JWT" }, payload: {} };
    const [p1, p2, sig] = parts;

    const header = JSON.parse(b64urlDecode(p1).toString("utf8")) as JwtHeader;
    if (header.alg !== "HS256" || header.typ !== "JWT") {
        return { valid: false, reason: "alg", header, payload: {} };
    }

    const payload = JSON.parse(b64urlDecode(p2).toString("utf8")) as Record<string, any>;
    const expSig = hmacSha256(secret, `${p1}.${p2}`, "base64url") as string;
    if (!constantTimeEqual(expSig, sig)) {
        return { valid: false, reason: "signature", header, payload };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.nbf === "number" && nowSec < payload.nbf) {
        return { valid: false, reason: "nbf", header, payload };
    }
    if (typeof payload.exp === "number" && nowSec >= payload.exp) {
        return { valid: false, reason: "exp", header, payload };
    }

    return { valid: true, header, payload };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Simple HMAC request signing (useful for headers like X-App-Signature)
 * signature = base64url(HMAC_SHA256(secret, `${method}\n${path}\n${date}\n${sha256(body)}`))
 * ──────────────────────────────────────────────────────────────────────────── */
export function requestSignature(
    method: string,
    path: string,
    date: string,        // RFC 1123 or ISO string you put in X-Date
    body: ByteSource,
    secret: ByteSource,
): string {
    const bodyHash = sha256(body, "base64url") as string;
    const msg = `${method.toUpperCase()}\n${path}\n${date}\n${bodyHash}`;
    return hmacSha256(secret, msg, "base64url") as string;
}
