import { IncomingMessage, ServerResponse } from "http";
import { logger as baseLogger } from "../logger";

/**
 * Tenant resolver middleware.
 *
 * Precedence:
 *   1) session.tenant_id
 *   2) Mode A: X-App-Key + X-App-Secret (static creds)
 *   3) Dev fallback: ?tenant=code
 *
 * On success: sets ctx.tenant and persists session.tenant_id.
 * Includes a skeleton for Mode B (HMAC) — wiring will be added in Milestone 2.
 */

// ------------------------- Types
export interface Tenant {
    id: string | number;
    code?: string;
    name?: string;
    // Additional attributes are allowed
    [k: string]: unknown;
}

export interface TenantResolver {
    /** Optional: load tenant by unique id stored in session */
    byId?: (id: string | number) => Promise<Tenant | null>;
    /** Mode A: resolve tenant using static app credentials */
    byAppCreds?: (appKey: string, appSecret: string) => Promise<Tenant | null>;
    /** Dev: resolve tenant by short code provided in querystring */
    byCode?: (code: string) => Promise<Tenant | null>;
}

export interface TenantOptions {
    resolver: TenantResolver;
    /** When true (default in APP_DEBUG), allow `?tenant=code` dev override */
    allowDevParam?: boolean;
    /** Persist tenant_id in session (default: true) */
    persistSession?: boolean;
    /** If true and no tenant resolved, respond 401 (default: false) */
    required?: boolean;
    /** Custom header names for Mode A */
    headerNames?: { appKey?: string; appSecret?: string };
}

export interface SessionAPI {
    id: string;
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    all<T = Record<string, unknown>>(): Promise<T>;
    destroy(): Promise<void>;
    regenerate(opts?: { keepData?: boolean }): Promise<void>;
}

export interface CtxLike {
    req: IncomingMessage & { [k: string]: any };
    res: ServerResponse & { [k: string]: any };
    session?: SessionAPI;
    state?: Record<string, unknown>;
    // target property set by this middleware
    tenant?: Tenant | null;
}

// ------------------------- Helpers
const bool = (v: unknown, def = false) => {
    if (v == null) return def;
    const s = String(v).toLowerCase().trim();
    return ["1", "true", "yes", "on"].includes(s);
};

function header(req: IncomingMessage, name: string): string | undefined {
    const v = req.headers[name.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v as string | undefined;
}

function parseQueryParam(req: IncomingMessage, key: string): string | undefined {
    try {
        const base = (header(req, "x-forwarded-proto") || "http") + "://" + (header(req, "x-forwarded-host") || header(req, "host") || "local");
        const u = new URL(req.url || "", base);
        const val = u.searchParams.get(key);
        return val || undefined;
    } catch {
        return undefined;
    }
}

// tiny LRU-ish cache to avoid repeated DB hits during hot paths
interface CacheEntry { v: Tenant | null; t: number }
const inMemCache = new Map<string, CacheEntry>();
const CACHE_MS = 5_000; // 5s soft cache

function cacheGet(k: string): Tenant | null | undefined {
    const it = inMemCache.get(k);
    if (!it) return undefined;
    if (Date.now() - it.t > CACHE_MS) { inMemCache.delete(k); return undefined; }
    return it.v;
}
function cachePut(k: string, v: Tenant | null) { inMemCache.set(k, { v, t: Date.now() }); }

// ------------------------- Middleware
export function tenant(options: TenantOptions) {
    const {
        resolver,
        persistSession = true,
        required = false,
        headerNames = { appKey: "x-app-key", appSecret: "x-app-secret" },
    } = options;
    const allowDevParam = options.allowDevParam ?? bool(process.env.APP_DEBUG, false);

    if (!resolver) throw new Error("tenant(): resolver is required");

    return async function tenantMiddleware(ctx: CtxLike, next: () => Promise<any>) {
        const log = baseLogger.child({ mod: "tenant" });
        const { req, res, session } = ctx;

        let resolved: Tenant | null = null;
        let resolvedBy: "session" | "modeA" | "dev" | undefined;

        // 1) session.tenant_id
        const sid = await session?.get<string | number>("tenant_id");
        if (sid != null) {
            if (resolver.byId) {
                const ck = `id:${sid}`;
                const cached = cacheGet(ck);
                resolved = cached !== undefined ? cached : await resolver.byId(sid);
                cachePut(ck, resolved);
                if (resolved) resolvedBy = "session";
            } else {
                // If no byId resolver provided, still use the id for downstream isolation
                resolved = { id: sid } as Tenant;
                resolvedBy = "session";
            }
        }

        // 2) Mode A: X-App-Key + X-App-Secret (only if not set by session or session failed to load)
        if (!resolved) {
            const appKey = header(req, headerNames.appKey || "x-app-key");
            const appSecret = header(req, headerNames.appSecret || "x-app-secret");
            if (appKey && appSecret && resolver.byAppCreds) {
                const ck = `ak:${appKey}`; // assume appKey unique; secret checked in resolver
                const cached = cacheGet(ck);
                resolved = cached !== undefined ? cached : await resolver.byAppCreds(appKey, appSecret);
                cachePut(ck, resolved);
                if (resolved) resolvedBy = "modeA";
            }
        }

        // 3) Dev: ?tenant=code
        if (!resolved && allowDevParam && resolver.byCode) {
            const code = parseQueryParam(req, "tenant");
            if (code) {
                const ck = `code:${code}`;
                const cached = cacheGet(ck);
                resolved = cached !== undefined ? cached : await resolver.byCode(code);
                cachePut(ck, resolved);
                if (resolved) resolvedBy = "dev";
            }
        }

        // ---- Mode B (HMAC) skeleton — Milestone 2 wiring
        // const sig = header(req, "x-signature");
        // const ts  = header(req, "x-timestamp");
        // const key = header(req, headerNames.appKey || "x-app-key");
        // if (!resolved && sig && ts && key && resolver.byId) {
        //   // TODO: verify signature with shared secret retrieved via key → tenant
        //   // TODO: check timestamp drift / replay protection
        //   // if valid → resolved = await resolver.byId(tenantId)
        // }

        // Attach or reject
        if (resolved) {
            ctx.tenant = resolved;
            // reflect tenant id for downstream and clients
            try { res.setHeader("x-tenant-id", String(resolved.id)); } catch {}
            if (persistSession && session) {
                const cur = await session.get("tenant_id");
                if (cur !== resolved.id) await session.set("tenant_id", resolved.id);
            }
            const code = (resolved as any).code || undefined;
            log.debug("tenant resolved", { by: resolvedBy, id: resolved.id, code });
        } else {
            ctx.tenant = null;
            log.debug("tenant not resolved", { required });
            if (required) {
                res.statusCode = 401;
                res.setHeader("content-type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "tenant_required", message: "Tenant could not be resolved" }));
                return; // do not call next()
            }
        }

        await next();
    };
}

export default tenant;




// ------------------------- Usage example
// Import and use after session() middleware

// tenant({
//     resolver: {
//         byId?: (id) => Promise<Tenant|null>,
//         byAppCreds?: (appKey, appSecret) => Promise<Tenant|null>,
//         byCode?: (code) => Promise<Tenant|null>,
//     },
//     allowDevParam?: boolean,     // defaults to APP_DEBUG
//     persistSession?: boolean,    // default true
//     required?: boolean,          // if true => 401 when unresolved
//     headerNames?: { appKey?, appSecret? } // override header keys if needed
// })
//
