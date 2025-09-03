import { IncomingMessage, ServerResponse } from "http";

/**
 * '/healthz' route — JSON health check for probes and dashboards.
 * Tries a lightweight DB ping when available.
 */

export interface SessionAPI { id: string }
export interface TenantLike { id: string | number; code?: string }
export interface DBHandle { profile: string; driver(): Promise<string>; healthz(): Promise<{ ok: boolean; driver: string }> }

export interface CtxLike {
    req: IncomingMessage & { [k: string]: any };
    res: ServerResponse & { [k: string]: any };
    session?: SessionAPI;
    tenant?: TenantLike | null;
    db?: DBHandle;
}

export async function healthz(ctx: string) {
    const { res, db, tenant, session } = ctx;
    const app = process.env.APP_NAME || "CodexSun";
    const version = process.env.APP_VERSION || "0.0.0";

    let dbStatus: { ok: boolean; driver?: string; profile?: string; error?: string } = { ok: false };
    if (db) {
        try {
            const h = await db.healthz();
            dbStatus = { ok: !!h.ok, driver: h.driver, profile: db.profile };
        } catch (e: any) {
            dbStatus = { ok: false, profile: db.profile, error: e?.message || String(e) };
        }
    } else {
        dbStatus = { ok: true, driver: undefined, profile: undefined }; // no DB bound for this route; treat as ok
    }

    const ok = dbStatus.ok; // you can expand this with other subsystem checks

    const payload = {
        status: ok ? "ok" : "degraded",
        time: new Date().toISOString(),
        app,
        version,
        uptime_s: Math.round(process.uptime()),
        pid: process.pid,
        session_id: session?.id ?? null,
        tenant_id: tenant?.id ?? null,
        db: dbStatus,
    } as const;

    res.statusCode = ok ? 200 : 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(payload));
}

export default healthz;
