import { IncomingMessage, ServerResponse } from "http";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";

/**
 * Cookie‑session middleware for CodexSun (no hard deps).
 *
 * - Signed cookie `sid` using HMAC-SHA256(APP_KEY)
 * - HttpOnly, SameSite=Lax, Path=/, Secure if HTTPS or FORCE_SECURE_COOKIES=1
 * - 2h TTL, rolling refresh on access
 * - Store auto: Redis when REDIS_URL is set (supports `redis` v4 or `ioredis`);
 *   otherwise fast in-memory fallback
 * - Exposes: ctx.session = { id, get, set, all, destroy, regenerate }
 */

// ------------------------- Types
export interface SessionAPI {
    /** Current session id */
    id: string;
    /** Read a value */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** Set a value (json-serializable) */
    set(key: string, value: unknown): Promise<void>;
    /** Get the entire session object */
    all<T = Record<string, unknown>>(): Promise<T>;
    /** Destroy the session (clears cookie and store) */
    destroy(): Promise<void>;
    /** Regenerate the session id. Keep existing data by default. */
    regenerate(opts?: { keepData?: boolean }): Promise<void>;
}

export interface SessionOptions {
    /** Cookie name */
    name?: string; // default: "sid"
    /** TTL seconds (default: 2h) */
    ttlSec?: number; // default: 7200
    /** Force secure cookie (otherwise auto by req) */
    forceSecure?: boolean; // default: FORCE_SECURE_COOKIES
    /** Rolling refresh on access */
    rolling?: boolean; // default: true
}

export interface CtxLike {
    req: IncomingMessage & { [k: string]: any };
    res: ServerResponse & { [k: string]: any };
    // place the session here
    session?: SessionAPI;
    // optional bag some frameworks provide
    state?: Record<string, unknown>;
}

// ------------------------- Small utils
const bool = (v: unknown, def = false) => {
    if (v == null) return def;
    const s = String(v).toLowerCase().trim();
    return ["1", "true", "yes", "on"].includes(s);
};

const b64url = (buf: Buffer) =>
    buf
        .toString("base64")
        .replace(/=+$/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

const fromB64url = (s: string) =>
    Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(appKey: string, sid: string): string {
    return b64url(createHmac("sha256", appKey).update(sid).digest());
}

function verify(appKey: string, sid: string, sig: string): boolean {
    try {
        const a = createHmac("sha256", appKey).update(sid).digest();
        const b = fromB64url(sig);
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    const parts = header.split(";");
    for (const p of parts) {
        const idx = p.indexOf("=");
        if (idx === -1) continue;
        const k = decodeURIComponent(p.slice(0, idx).trim());
        const v = decodeURIComponent(p.slice(idx + 1).trim());
        if (k) out[k] = v;
    }
    return out;
}

function pushSetCookie(res: ServerResponse, cookie: string) {
    const prev = res.getHeader("Set-Cookie");
    if (!prev) res.setHeader("Set-Cookie", cookie);
    else if (Array.isArray(prev)) res.setHeader("Set-Cookie", [...prev, cookie]);
    else res.setHeader("Set-Cookie", [String(prev), cookie]);
}

function isSecure(req: IncomingMessage, force: boolean): boolean {
    if (force) return true;
    // Reverse proxy friendly check
    const xfproto = (req.headers["x-forwarded-proto"] as string) || "";
    // @ts-expect-error Node types differ
    return !!(req.socket?.encrypted || xfproto.toLowerCase() === "https");
}

function makeCookie(
    name: string,
    value: string,
    req: IncomingMessage,
    ttlSec: number,
    forceSecure: boolean
) {
    const attrs = [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.max(0, Math.floor(ttlSec))}`,
    ];
    if (isSecure(req, forceSecure)) attrs.push("Secure");
    const expires = new Date(Date.now() + ttlSec * 1000).toUTCString();
    attrs.push(`Expires=${expires}`);
    return attrs.join("; ");
}

// ------------------------- Store interface + impls
interface Store {
    get(sid: string): Promise<Record<string, any> | null>;
    set(sid: string, data: Record<string, any>, ttlSec: number): Promise<void>;
    del(sid: string): Promise<void>;
    touch?(sid: string, ttlSec: number): Promise<void>;
}

class MemoryStore implements Store {
    private map = new Map<string, { data: Record<string, any>; exp: number }>();

    async get(sid: string) {
        const it = this.map.get(sid);
        if (!it) return null;
        if (Date.now() > it.exp) {
            this.map.delete(sid);
            return null;
        }
        return it.data;
    }
    async set(sid: string, data: Record<string, any>, ttlSec: number) {
        this.map.set(sid, { data: { ...data }, exp: Date.now() + ttlSec * 1000 });
    }
    async del(sid: string) {
        this.map.delete(sid);
    }
    async touch(sid: string, ttlSec: number) {
        const it = this.map.get(sid);
        if (it) it.exp = Date.now() + ttlSec * 1000;
    }
}

class RedisStore implements Store {
    private client: any;
    private flavor: "node-redis" | "ioredis";

    constructor(client: any, flavor: "node-redis" | "ioredis") {
        this.client = client;
        this.flavor = flavor;
    }

    static async connect(url: string): Promise<RedisStore | null> {
        // Try node-redis v4
        try {
            const mod: any = await import("redis");
            if (mod && mod.createClient) {
                const client = mod.createClient({ url });
                client.on("error", (err: any) => console.warn("Redis error", err?.message || err));
                await client.connect();
                return new RedisStore(client, "node-redis");
            }
        } catch {}
        // Try ioredis
        try {
            const mod: any = await import("ioredis");
            if (mod) {
                const client = new mod.default(url);
                // ioredis is ready immediately; no explicit connect
                return new RedisStore(client, "ioredis");
            }
        } catch {}
        return null;
    }

    async get(sid: string) {
        const raw = await (this.flavor === "node-redis" ? this.client.get(sid) : this.client.get(sid));
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    async set(sid: string, data: Record<string, any>, ttlSec: number) {
        const value = JSON.stringify(data);
        if (this.flavor === "node-redis") {
            await this.client.setEx(sid, ttlSec, value);
        } else {
            // ioredis
            await this.client.set(sid, value, "EX", ttlSec);
        }
    }

    async del(sid: string) {
        await this.client.del(sid);
    }

    async touch(sid: string, ttlSec: number) {
        if (this.flavor === "node-redis") await this.client.expire(sid, ttlSec);
        else await this.client.expire(sid, ttlSec);
    }
}

// ------------------------- Session middleware
export function session(options: SessionOptions = {}) {
    const name = options.name ?? "sid";
    const ttlSec = options.ttlSec ?? 2 * 60 * 60; // 2h
    const rolling = options.rolling ?? true;
    const forceSecure = options.forceSecure ?? bool(process.env.FORCE_SECURE_COOKIES, false);
    const APP_KEY = process.env.APP_KEY || "";
    if (!APP_KEY) console.warn("[session] APP_KEY is empty — signing will be weak");

    // Select store
    const REDIS_URL = process.env.REDIS_URL;
    let storePromise: Promise<Store> | null = null;
    const getStore = () => {
        if (!storePromise) {
            if (REDIS_URL) {
                storePromise = (async () => {
                    const r = await RedisStore.connect(REDIS_URL);
                    if (r) return r as Store;
                    console.warn("[session] REDIS_URL set but Redis client not available — using MemoryStore");
                    return new MemoryStore();
                })();
            } else {
                storePromise = Promise.resolve<Store>(new MemoryStore());
            }
        }
        return storePromise;
    };

    return async function sessionMiddleware(ctx: CtxLike, next: () => Promise<any>) {
        const { req, res } = ctx;

        // Parse incoming cookie
        const cookies = parseCookies(req.headers["cookie"] as string | undefined);
        const raw = cookies[name];

        let sid: string | null = null;
        let newSid = false;

        if (raw) {
            const dot = raw.lastIndexOf(".");
            if (dot > 0) {
                const id = raw.slice(0, dot);
                const sig = raw.slice(dot + 1);
                if (verify(APP_KEY, id, sig)) sid = id;
            }
        }

        if (!sid) {
            sid = randomUUID();
            newSid = true;
        }

        // Lazy session state
        const store = await getStore();
        let dataCache: Record<string, any> | null = null;
        let dirty = false;
        let destroyed = false;
        let rotated = newSid; // set-cookie if new

        async function load() {
            if (dataCache) return dataCache;
            const existing = await store.get(sid!);
            dataCache = existing || {};
            return dataCache;
        }

        async function commit() {
            if (destroyed) {
                await store.del(sid!);
                // expire cookie
                pushSetCookie(res, `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=${new Date(0).toUTCString()}`);
                return;
            }
            if (dirty) {
                await store.set(sid!, dataCache || {}, ttlSec);
                rotated = true; // refresh cookie attributes
            } else if (rolling) {
                await (store.touch?.(sid!, ttlSec) ?? Promise.resolve());
                rotated = true; // refresh cookie max-age
            }
            if (rotated) {
                const value = `${sid}.${sign(APP_KEY, sid!)}`;
                pushSetCookie(res, makeCookie(name, value, req, ttlSec, forceSecure));
            }
        }

        // Build public API
        const api: SessionAPI = {
            get id() {
                return sid!;
            },
            async get(key) {
                const d = await load();
                return d[key];
            },
            async set(key, value) {
                const d = await load();
                d[key] = value;
                dirty = true;
            },
            async all() {
                const d = await load();
                // shallow clone to avoid external mutation
                return { ...d };
            },
            async destroy() {
                destroyed = true;
                dataCache = {};
            },
            async regenerate({ keepData = true }: { keepData?: boolean } = {}) {
                const oldId = sid!;
                const oldData = (await load()) || {};
                sid = randomUUID();
                rotated = true;
                // move data
                if (keepData && Object.keys(oldData).length) {
                    await store.set(sid, oldData, ttlSec);
                } else {
                    await store.set(sid, {}, ttlSec);
                }
                await store.del(oldId);
                dataCache = keepData ? { ...oldData } : {};
                dirty = false; // already persisted
            },
        };

        // Attach to ctx
        ctx.session = api;

        try {
            await next();
        } finally {
            await commit();
        }
    };
}

export default session;


// ------------------------- Usage
// In your server setup (e.g. server.ts):
// import { session } from './cortex/http/middleware/session';
// app.use(session({ name: 'sid', ttlSec: 7200, forceSecure: false, rolling: true }));
//
// In your route handlers:
// async function handler(ctx) {
//     const userId = await ctx.session.get('userId');
//     if (!userId) {
//         // not logged in
//         return { status: 401, body: { error: 'Unauthorized' } };
//     }
//     // proceed with userId
//     ...
//     // To set a value:
//     await ctx.session.set('userId', theUserId);
//     // To destroy session (logout):
//     await ctx.session.destroy();
//     ...
// }
//
// The session object has the following shape:
// ctx.session = {
//     id,                   // string
//     get(key),             // -> Promise<any | undefined>
//     set(key, value),      // -> Promise<void>
//     all(),                // -> Promise<Record<string, any>>
//     destroy(),            // -> Promise<void>
//     regenerate({ keepData = true }) // -> Promise<void>
// }