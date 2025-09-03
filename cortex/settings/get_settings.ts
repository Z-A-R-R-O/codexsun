// cortex/settings/get_settings.ts

export type PoolSettings = {
    min?: number;
    max?: number;
    idleMillis?: number;
    acquireTimeoutMillis?: number;
};

/**
 * Internal helper to read from process.env treating empty string as undefined.
 */
function getEnv(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const v = process.env[name];
    return v === "" || v === undefined ? undefined : v;
}

/**
 * Return a raw env var by key (no prefix logic).
 * Example: getGlobalEnv("HOME") -> process.env.HOME
 */
export function getGlobalEnv(key: string): string | undefined {
    const k = String(key || "").trim();
    if (!k) return undefined;
    return getEnv(k);
}

/**
 * Read an env with a PREFIX_KEY form. Empty string is treated as undefined.
 * The prefix is used verbatim (uppercased). We DO NOT inject extra segments.
 *
 * Examples:
 *  - getPrefixedEnv("MDB", "DRIVER")        -> process.env.MDB_DRIVER
 *  - getPrefixedEnv("DB", "HOST")           -> process.env.DB_HOST
 *  - getPrefixedEnv("BLUE_DB", "PASSWORD")  -> process.env.BLUE_DB_PASSWORD
 */
export function getPrefixedEnv(prefix: string, key: string): string | undefined {
    const P = String(prefix || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const K = String(key || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!P || !K) return undefined;
    return getEnv(`${P}_${K}`);
}

/**
 * Parse a string to number (undefined if invalid/missing).
 */
function toNum(v?: string): number | undefined {
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Pool settings reader for a given prefix. Example prefixes:
 *  - "MDB"
 *  - "DB"
 *  - "BLUE_DB"
 *  - "SANDBOX_DB"
 *
 * It reads (new names first, fallback to legacy names for compatibility):
 *   <PREFIX>_POOL_MIN
 *   <PREFIX>_POOL_MAX
 *   <PREFIX>_POOL_IDLE_MS           (fallback: <PREFIX>_POOL_IDLE)
 *   <PREFIX>_POOL_ACQUIRE_TIMEOUT_MS (fallback: <PREFIX>_POOL_ACQUIRE)
 */
export function getPoolSettings(prefix: string): PoolSettings {
    const read = (k: string) => getPrefixedEnv(prefix, k);
    const first = (...xs: (string | undefined)[]) => xs.find((x) => x !== undefined);

    const min = toNum(read("POOL_MIN"));
    const max = toNum(read("POOL_MAX"));
    const idleMillis = toNum(first(read("POOL_IDLE_MS"), read("POOL_IDLE")));
    const acquireTimeoutMillis = toNum(
        first(read("POOL_ACQUIRE_TIMEOUT_MS"), read("POOL_ACQUIRE"))
    );

    const pool: PoolSettings = {};
    if (min !== undefined) pool.min = min;
    if (max !== undefined) pool.max = max;
    if (idleMillis !== undefined) pool.idleMillis = idleMillis;
    if (acquireTimeoutMillis !== undefined) pool.acquireTimeoutMillis = acquireTimeoutMillis;

    return pool;
}
