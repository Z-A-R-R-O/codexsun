import { IncomingMessage, ServerResponse } from "http";
import * as cm from "../../connection_manager";
import type { Engine } from "../../Engine";
import { logger as baseLogger } from "../logger";

/**
 * db_context middleware
 *
 * Binds `ctx.db` to a tenant-scoped profile using the shared connection_manager.
 * - Profile key default: `TENANT:<tenant_id>` (customizable)
 * - LRU eviction (max profiles)
 * - Idle TTL eviction (timer-based)
 * - Hooks (onEvict) provided for observability
 *
 * Assumes a previous middleware set `ctx.tenant` and/or session `tenant_id`.
 * You can also provide a custom `profileForTenant`.
 */

export interface SessionAPI {
    id: string;
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    all<T = Record<string, unknown>>(): Promise<T>;
    destroy(): Promise<void>;
    regenerate(opts?: { keepData?: boolean }): Promise<void>;
}

export interface TenantLike { id: string | number; code?: string }

export interface CtxLike {
    req: IncomingMessage & { [k: string]: any };
    res: ServerResponse & { [k: string]: any };
    session?: SessionAPI;
    tenant?: TenantLike | null;
    state?: Record<string, unknown>;
    db?: DBHandle;
}

export interface DBHandle {
    /** The resolved profile key (e.g. TENANT:42) */
    profile: string;
    /** Direct access to the low-level Engine (pool) */
    engine(): Engine | undefined;
    /** Driver name */
    driver(): Promise<string>;
    /** SQL helpers */
    query<T = any>(sql: string, params?: unknown): Promise<unknown>;
    fetchOne<T = any>(sql: string, params?: unknown): Promise<T | null>;
    fetchAll<T = any>(sql: string, params?: unknown): Promise<T[]>;
    executeMany(sql: string, paramSets: unknown[]): Promise<unknown>;
    begin(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    healthz(): Promise<{ ok: boolean; driver: string }>; // lightweight ping
}

export interface DbContextOptions {
    /** If true and no tenant could be determined → 401 */
    required?: boolean;
    /** Prefix when building a profile key (default: "TENANT") */
    profilePrefix?: string;
    /** Custom mapper to profile key: takes tenant id and returns profile */
    profileForTenant?: (tenantId: string | number) => string;
    /** Max number of live tenant profiles before LRU eviction (default: 100) */
    maxProfiles?: number;
    /** Idle time (ms) before auto-evict a tenant profile (default: 30 min) */
    idleMs?: number;
    /** Hook called whenever an engine is evicted */
    onEvict?: (profile: string, reason: "lru" | "idle") => void;
}

/* -------------------------------------------------------------------------- */
/*  INTERNAL LRU + IDLE MANAGEMENT                                            */
/* -------------------------------------------------------------------------- */

interface Meta { last: number; timer?: NodeJS.Timeout }
const metas = new Map<string, Meta>();

let LIMIT = 100; // maxProfiles
let IDLE_MS = 30 * 60 * 1000; // 30 minutes
let ON_EVICT: ((profile: string, reason: "lru" | "idle") => void) | undefined;

function profileKeyFrom(tenantId: string | number, prefix = "TENANT") {
    return `${prefix}:${tenantId}`;
}

async function ensureProfile(profile: string) {
    // Ensure engine exists/healthy via manager
    await cm.prepareEngine(profile);
    touch(profile);
}

function touch(profile: string) {
    const meta = metas.get(profile) || { last: 0 };
    meta.last = Date.now();
    // reset idle timer
    if (meta.timer) clearTimeout(meta.timer);
    meta.timer = setTimeout(() => evict(profile, "idle"), IDLE_MS);
    metas.set(profile, meta);
    enforceLimit();
}

async function evict(profile: string, reason: "lru" | "idle") {
    // Close and remove from connection manager + meta map
    try {
        await cm.teardownEngine(profile);
    } catch {/* ignore */}
    metas.delete(profile);
    try { ON_EVICT?.(profile, reason); } catch { /* noop */ }
}

function enforceLimit() {
    if (metas.size <= LIMIT) return;
    // find oldest by last timestamp (exclude the most recently touched ones)
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, m] of metas) {
        if (m.last < oldestTime) { oldestTime = m.last; oldestKey = k; }
    }
    if (oldestKey) void evict(oldestKey, "lru");
}

/** Optional runtime tuning */
export function configureDbContextLimits(opts: { maxProfiles?: number; idleMs?: number; onEvict?: (profile: string, reason: "lru" | "idle") => void }) {
    if (opts.maxProfiles != null) LIMIT = Math.max(1, opts.maxProfiles);
    if (opts.idleMs != null) IDLE_MS = Math.max(5_000, opts.idleMs);
    if (opts.onEvict) ON_EVICT = opts.onEvict;
}

/* -------------------------------------------------------------------------- */
/*  MIDDLEWARE                                                                */
/* -------------------------------------------------------------------------- */

export function dbContext(options: DbContextOptions = {}) {
    const {
        required = false,
        profilePrefix = "TENANT",
        profileForTenant,
        maxProfiles,
        idleMs,
        onEvict,
    } = options;

    if (maxProfiles != null || idleMs != null || onEvict) {
        configureDbContextLimits({ maxProfiles, idleMs, onEvict });
    }

    const log = baseLogger.child({ mod: "db_context" });

    return async function dbContextMiddleware(ctx: CtxLike, next: () => Promise<any>) {
        const { req, res, session } = ctx;

        // Resolve tenant id from ctx or session
        const tenantId = ctx.tenant?.id ?? (await session?.get("tenant_id"));
        if (tenantId == null) {
            if (required) {
                res.statusCode = 401;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "tenant_required", message: "No tenant bound for database context" }));
                return;
            }
            // Fallback to default profile for system endpoints
            const profile = "default";
            await ensureProfile(profile);
            ctx.db = buildHandle(profile);
            try { res.setHeader("x-db-profile", profile); } catch {}
            await next();
            return;
        }

        const profile = profileForTenant ? profileForTenant(tenantId) : profileKeyFrom(tenantId, profilePrefix);

        // Prepare and bind
        await ensureProfile(profile);

        // Small convenience headers for observability
        try { res.setHeader("x-db-profile", profile); } catch {}

        ctx.db = buildHandle(profile);

        log.debug("db context bound", { profile, tenantId });

        await next();
    };
}

function buildHandle(profile: string): DBHandle {
    return {
        profile,
        engine: () => cm.getEngine(profile),
        driver: async () => cm.getDriver(profile),
        query: (sql, params) => cm.execute(profile, sql, params),
        fetchOne: <T = any>(sql: string, params?: unknown) => cm.fetchOne<T>(profile, sql, params),
        fetchAll: <T = any>(sql: string, params?: unknown) => cm.fetchAll<T>(profile, sql, params),
        executeMany: (sql: string, sets: unknown[]) => cm.executeMany(profile, sql, sets),
        begin: () => cm.begin(profile),
        commit: () => cm.commit(profile),
        rollback: () => cm.rollback(profile),
        healthz: async () => ({ ok: true, driver: await cm.getDriver(profile) }),
    };
}

// Best-effort cleanup on shutdown
process.on("beforeExit", () => {
    // clear timers
    for (const [k, m] of metas) { if (m.timer) clearTimeout(m.timer); metas.delete(k); }
    // ask connection_manager to close everything
    void cm.teardownAll();
});

export default dbContext;



// Usage
// --------------------------------------------------------------------------

// Tenant-aware DB context middleware for Cortex apps
//
// db context middleware is in place. It:
//
// Derives a profile per tenant (default TENANT:<tenant_id>) and binds ctx.db to your connection_manager.
//
//     Includes LRU (max profiles, default 100) and idle eviction (default 30 min) with hooks.
//
//     Works even if no tenant is present (binds to default unless required: true).
//
// Use
// import dbContext from './middleware/db_context';
//
// app.use(session());        // your session middleware
// app.use(tenant({ /* ... */ }));  // your tenant resolver
// app.use(dbContext({
//     // optional:
//     required: false,
//     profilePrefix: 'TENANT',
//     // or supply your own mapping:
//     // profileForTenant: (id) => `DBP:${id}`,
//     maxProfiles: 200,
//     idleMs: 10 * 60 * 1000, // 10 minutes
//     onEvict: (profile, reason) => console.log('evicted', profile, reason),
// }));
//
// What you get on each request
// ctx.db = {
//     profile,                       // e.g. 'TENANT:42'
//     engine: () => getEngine(...),  // low-level pool
//     driver: () => Promise<'postgres'|'mysql'|...>,
//     query, fetchOne, fetchAll, executeMany,
//     begin, commit, rollback, healthz
// }
//
//
// It auto-prepares the engine via prepareEngine(profile) and sets x-db-profile on the response.
//     If you want a different eviction policy or to prime certain tenants, we can add helpers to prewarm specific profiles.