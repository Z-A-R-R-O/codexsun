// cortex/cache.ts — simple in-memory TTL cache
type Entry<T> = { value: T; expiresAt: number; };
const c = new Map<string, Entry<any>>();

export function cacheSet<T>(key: string, value: T, ttlMs = 60_000) {
    c.set(key, { value, expiresAt: Date.now() + ttlMs });
}
export function cacheGet<T>(key: string): T | undefined {
    const e = c.get(key); if (!e) return undefined;
    if (Date.now() > e.expiresAt) { c.delete(key); return undefined; }
    return e.value as T;
}
export function cacheDel(key: string) { c.delete(key); }
export function cacheClear() { c.clear(); }
