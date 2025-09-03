// cortex/framework/cache.ts
// Simple app cache with TTL, namespacing, and optional Redis (ioredis) backend.
//
// Usage:
//   import { cache } from "./cache";
//   await cache.set("greet", "hello", 60);
//   const v = await cache.get<string>("greet");
//   const data = await cache.wrap("users:42", 120, () => fetchUser(42));
//
// ENV (optional):
//   CACHE_DRIVER=redis|memory        (default: memory)
//   REDIS_URL=redis://...            (used when driver=redis)
//   CACHE_NAMESPACE=app              (prefix for all keys)
//   CACHE_TTL=600                    (default TTL used by wrap() when not provided)

type Jsonable = unknown;

export type CacheDriver = "memory" | "redis";

export interface CacheOptions {
    driver?: CacheDriver;
    namespace?: string;
    ttlSecondsDefault?: number; // used by wrap() when ttl not provided
    redisUrl?: string;
    json?: boolean;             // JSON-encode values; default true
}

export interface Cache {
    get<T = Jsonable>(key: string): Promise<T | undefined>;
    set<T = Jsonable>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    del(key: string): Promise<void>;
    incr(key: string, by?: number, ttlSeconds?: number): Promise<number>;
    decr(key: string, by?: number, ttlSeconds?: number): Promise<number>;
    expire(key: string, ttlSeconds: number): Promise<void>;
    ttl(key: string): Promise<number | null>; // seconds remaining; null if not found or no TTL
    keys(pattern?: string): Promise<string[]>; // pattern is suffix-only for memory; for redis it's prefix scan
    flush(): Promise<void>; // flush namespace only
    wrap<T = Jsonable>(key: string, ttlSeconds: number | undefined, loader: () => Promise<T> | T): Promise<T>;
}

const now = () => Date.now();

function nsKey(ns: string, k: string) {
    return ns ? `${ns}:${k}` : k;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Memory cache
 * ────────────────────────────────────────────────────────────────────────── */
class MemoryCache implements Cache {
    private store = new Map<string, { v: string; exp?: number }>();
    constructor(
        private ns: string,
        private json = true,
        private wrapDefaultTtl: number | undefined = undefined,
    ) {}

    private encode(v: any) { return this.json ? JSON.stringify(v) : String(v); }
    private decode<T>(s: string): T { return (this.json ? JSON.parse(s) : (s as any)) as T; }

    private gcOne(k: string) {
        const rec = this.store.get(k);
        if (!rec) return false;
        if (rec.exp && rec.exp <= now()) {
            this.store.delete(k);
            return true;
        }
        return false;
    }

    async get<T = Jsonable>(key: string): Promise<T | undefined> {
        const k = nsKey(this.ns, key);
        if (this.gcOne(k)) return undefined;
        const rec = this.store.get(k);
        if (!rec) return undefined;
        return this.decode<T>(rec.v);
    }

    async set<T = Jsonable>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const k = nsKey(this.ns, key);
        const exp = ttlSeconds && ttlSeconds > 0 ? now() + ttlSeconds * 1000 : undefined;
        this.store.set(k, { v: this.encode(value), exp });
    }

    async has(key: string): Promise<boolean> {
        const k = nsKey(this.ns, key);
        if (this.gcOne(k)) return false;
        return this.store.has(k);
    }

    async del(key: string): Promise<void> {
        this.store.delete(nsKey(this.ns, key));
    }

    async incr(key: string, by = 1, ttlSeconds?: number): Promise<number> {
        const current = Number((await this.get<string>(key)) ?? 0);
        const next = current + by;
        await this.set(key, String(next), ttlSeconds);
        return next;
    }

    async decr(key: string, by = 1, ttlSeconds?: number): Promise<number> {
        return this.incr(key, -by, ttlSeconds);
    }

    async expire(key: string, ttlSeconds: number): Promise<void> {
        const k = nsKey(this.ns, key);
        const rec = this.store.get(k);
        if (!rec) return;
        rec.exp = ttlSeconds > 0 ? now() + ttlSeconds * 1000 : undefined;
        this.store.set(k, rec);
    }

    async ttl(key: string): Promise<number | null> {
        const k = nsKey(this.ns, key);
        if (this.gcOne(k)) return null;
        const rec = this.store.get(k);
        if (!rec) return null;
        if (!rec.exp) return null;
        const t = Math.max(0, Math.floor((rec.exp - now()) / 1000));
        return t;
    }

    async keys(pattern?: string): Promise<string[]> {
        const pref = nsKey(this.ns, "");
        const out: string[] = [];
        for (const k of this.store.keys()) {
            if (this.gcOne(k)) continue;
            if (!k.startsWith(pref)) continue;
            const short = k.slice(pref.length);
            if (!pattern || short.endsWith(pattern)) out.push(short);
        }
        return out;
    }

    async flush(): Promise<void> {
        const pref = nsKey(this.ns, "");
        for (const k of Array.from(this.store.keys())) {
            if (k.startsWith(pref)) this.store.delete(k);
        }
    }

    async wrap<T = Jsonable>(key: string, ttlSeconds: number | undefined, loader: () => Promise<T> | T): Promise<T> {
        const existing = await this.get<T>(key);
        if (existing !== undefined) return existing;
        const value = await Promise.resolve(loader());
        await this.set(key, value, ttlSeconds ?? this.wrapDefaultTtl);
        return value;
    }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Redis cache (ioredis). Falls back to memory if ioredis is not installed.
 * ────────────────────────────────────────────────────────────────────────── */
class RedisCache implements Cache {
    private json: boolean;
    private ns: string;
    private wrapDefaultTtl?: number;
    private client: any;

    constructor(opts: { namespace: string; url?: string; json?: boolean; wrapDefaultTtl?: number }) {
        this.ns = opts.namespace;
        this.json = opts.json ?? true;
        this.wrapDefaultTtl = opts.wrapDefaultTtl;

        // Prefer ioredis
        let Redis: any = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            Redis = require("ioredis");
        } catch {
            throw new Error("ioredis module not found");
        }

        this.client = new Redis(opts.url || process.env.REDIS_URL || undefined);
    }

    private k(key: string) { return nsKey(this.ns, key); }
    private enc(v: any) { return this.json ? JSON.stringify(v) : String(v); }
    private dec<T>(s: string | null): T | undefined {
        if (s == null) return undefined;
        return (this.json ? JSON.parse(s) : (s as any)) as T;
    }

    async get<T = Jsonable>(key: string): Promise<T | undefined> {
        const s = await this.client.get(this.k(key));
        return this.dec<T>(s);
    }

    async set<T = Jsonable>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const k = this.k(key);
        const v = this.enc(value);
        if (ttlSeconds && ttlSeconds > 0) {
            await this.client.set(k, v, "EX", ttlSeconds);
        } else {
            await this.client.set(k, v);
        }
    }

    async has(key: string): Promise<boolean> {
        return (await this.client.exists(this.k(key))) === 1;
    }

    async del(key: string): Promise<void> {
        await this.client.del(this.k(key));
    }

    async incr(key: string, by = 1, ttlSeconds?: number): Promise<number> {
        const k = this.k(key);
        const n = by === 1 ? await this.client.incr(k) : await this.client.incrby(k, by);
        if (ttlSeconds && ttlSeconds > 0) await this.client.expire(k, ttlSeconds);
        return Number(n);
    }

    async decr(key: string, by = 1, ttlSeconds?: number): Promise<number> {
        const k = this.k(key);
        const n = by === 1 ? await this.client.decr(k) : await this.client.decrby(k, by);
        if (ttlSeconds && ttlSeconds > 0) await this.client.expire(k, ttlSeconds);
        return Number(n);
    }

    async expire(key: string, ttlSeconds: number): Promise<void> {
        await this.client.expire(this.k(key), ttlSeconds);
    }

    async ttl(key: string): Promise<number | null> {
        const t = await this.client.ttl(this.k(key));
        if (t < 0) return null; // -1 no expire, -2 not found
        return t;
    }

    async keys(pattern?: string): Promise<string[]> {
        const pref = nsKey(this.ns, "");
        const out: string[] = [];
        let cursor = "0";
        do {
            // SCAN namespace:*
            const [next, arr] = await this.client.scan(cursor, "MATCH", `${pref}*`, "COUNT", "500");
            cursor = next;
            for (const full of arr as string[]) {
                const short = full.startsWith(pref) ? full.slice(pref.length) : full;
                if (!pattern || short.endsWith(pattern)) out.push(short);
            }
        } while (cursor !== "0");
        return out;
    }

    async flush(): Promise<void> {
        const pref = nsKey(this.ns, "");
        const ks = await this.keys();
        if (!ks.length) return;
        const fulls = ks.map((k) => pref + k);
        // pipeline del
        const pipe = this.client.pipeline();
        for (const k of fulls) pipe.del(k);
        await pipe.exec();
    }

    async wrap<T = Jsonable>(key: string, ttlSeconds: number | undefined, loader: () => Promise<T> | T): Promise<T> {
        const cached = await this.get<T>(key);
        if (cached !== undefined) return cached;
        const value = await Promise.resolve(loader());
        await this.set(key, value, ttlSeconds ?? this.wrapDefaultTtl);
        return value;
    }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Factory + default singleton
 * ────────────────────────────────────────────────────────────────────────── */
export function createCache(options: CacheOptions = {}): Cache {
    const driver =
        options.driver ||
        (process.env.CACHE_DRIVER === "redis" ? "redis" : "memory");

    const namespace = options.namespace || process.env.CACHE_NAMESPACE || "cache";
    const ttlDefault =
        options.ttlSecondsDefault ||
        (process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL, 10) : undefined);
    const json = options.json ?? true;

    if (driver === "redis") {
        try {
            return new RedisCache({
                namespace,
                url: options.redisUrl || process.env.REDIS_URL,
                json,
                wrapDefaultTtl: ttlDefault,
            });
        } catch {
            // Fallback to memory if ioredis not present or fails
            // eslint-disable-next-line no-console
            console.warn("[cache] ioredis not available, falling back to memory");
            return new MemoryCache(namespace, json, ttlDefault);
        }
    }

    return new MemoryCache(namespace, json, ttlDefault);
}

// Default cache instance (singleton)
export const cache: Cache = createCache();
