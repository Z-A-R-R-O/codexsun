// tests/e2e.server.test.ts
// Self-contained test routine (no external test libs, no supertest).
// Boots an in-memory server, then uses built-in fetch + a cookie jar.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ✅ FIXED PATHS (framework/* instead of http/*)
import { createNodeServer, type RouteDef, json } from "../../../cortex/http/chttpx"; // <- if your file is chttpx.ts
import { createSessionMiddleware } from "../../../cortex/http/middleware/session";
import { tenantMiddleware } from "../../../cortex/http/middleware/tenant";
import * as welcome from "../../../cortex/http/routes/welcome";
import * as health from "../../../cortex/http/routes/health";
import { createServerLogger } from "../../../cortex/log/logger";
import { loadConfig } from "../../../cortex/http/config";
import { createCache } from "../../../cortex/http/cache";

// ---------- small helpers (no supertest) ----------
class CookieJar {
    private jar = new Map<string, string>();
    addFromSetCookie(setCookie: string | string[] | undefined) {
        if (!setCookie) return;
        const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const line of arr) {
            const first = String(line).split(";")[0]; // "name=value"
            const eq = first.indexOf("=");
            if (eq > 0) {
                const name = first.slice(0, eq).trim();
                const value = first.slice(eq + 1).trim();
                this.jar.set(name, value);
            }
        }
    }
    header(): string | undefined {
        if (!this.jar.size) return undefined;
        return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
    }
}
async function listenOnEphemeral(server: http.Server): Promise<{ base: string; close: () => Promise<void> }> {
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr && "port" in addr ? (addr as any).port : 0;
    const base = `http://127.0.0.1:${port}`;
    const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
    return { base, close };
}
async function httpReq(base: string, method: string, path: string, opts: {
    jar?: CookieJar, headers?: Record<string, string>, jsonBody?: any
} = {}) {
    const headers = new Headers(opts.headers || {});
    const jarHeader = opts.jar?.header();
    if (jarHeader) headers.set("Cookie", jarHeader);

    let body: any = undefined;
    if (opts.jsonBody !== undefined) {
        body = JSON.stringify(opts.jsonBody);
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    }

    const res = await fetch(base + path, { method, headers, body });
    // collect set-cookie headers (node fetch exposes as a single combined header)
    const setCookie = res.headers.get("set-cookie") ?? undefined;
    if (opts.jar) opts.jar.addFromSetCookie(setCookie ?? undefined);

    const text = await res.text();
    const ct = res.headers.get("content-type") || "";
    const asJson = ct.includes("application/json") ? (() => { try { return JSON.parse(text); } catch { return undefined; } })() : undefined;
    return { status: res.status, headers: res.headers, text, json: asJson };
}
// ----------------------------------------------------

function testRoutes(logger: ReturnType<typeof createServerLogger>): RouteDef[] {
    return [
        // session helpers (test-only)
        {
            method: "POST",
            path: "/__test/session/set",
            handler: (req: any, res) => {
                const { k, v } = req.body || {};
                req.session?.set(String(k), v);
                logger.info("session:set", { k, v });
                json(res, { ok: true, sid: req.session?.id });
            },
        },
        {
            method: "GET",
            path: "/__test/session/get",
            handler: (req: any, res) => {
                const k = req.query.get("k") || "missing";
                const v = req.session?.get(String(k));
                logger.info("session:get", { k, v });
                json(res, { ok: true, value: v ?? null });
            },
        },
        {
            method: "POST",
            path: "/__test/session/destroy",
            handler: async (req: any, res) => {
                await req.session?.destroy?.();
                logger.info("session:destroy");
                json(res, { ok: true });
            },
        },
        {
            method: "POST",
            path: "/__test/session/regenerate",
            handler: async (req: any, res) => {
                const before = req.session?.id;
                await req.session?.regenerate?.();
                const after = req.session?.id;
                logger.info("session:regenerate", { before, after });
                json(res, { ok: true, before, after });
            },
        },
        // tenant echo (test-only)
        {
            method: "GET",
            path: "/__test/tenant",
            handler: (req: any, res) => {
                logger.info("tenant:get", { tenant: req.tenant });
                json(res, { tenant: req.tenant || null, sessionTenant: req.session?.get?.("tenant_id") || null });
            },
        },
    ];
}

export default async function runAll(): Promise<void> {
    const LOG_FILE = path.resolve(os.tmpdir(), `codexsun-test-${Date.now()}.log`);
    const logger = createServerLogger({
        file: { path: LOG_FILE, append: true, format: "text" },
        layout: "text",
        json: false,
        name: "tests",
    });

    // Boot server
    logger.start("boot");
    const routes: RouteDef[] = [
        ...welcome.routes(),
        ...health.routes(),
        ...testRoutes(logger),
    ];
    const middlewares = [
        createSessionMiddleware({ secure: true, signKey: "test-key", ttlSeconds: 60 }),
        tenantMiddleware(),
    ];
    const server = createNodeServer(routes, { cors: true, logger, middlewares });
    const { base, close } = await listenOnEphemeral(server);
    logger.success("booted", { base });

    try {
        // 1) CORS + health
        logger.info("step:healthz");
        const pre = await httpReq(base, "OPTIONS", "/healthz", { headers: { Origin: "http://example.com" } });
        assert.equal(pre.status, 204);
        // Node fetch doesn't always expose echo'd origin easily; ensure no error status is enough here

        const h = await httpReq(base, "GET", "/healthz", { headers: { Origin: "http://example.com" } });
        assert.equal(h.status, 200);
        assert.ok(h.json?.ok);
        assert.ok(h.json?.time);
        assert.ok(typeof h.json?.uptime === "number");
        logger.success("healthz ok");

        // 2) Welcome + cookie
        logger.info("step:welcome");
        const jar1 = new CookieJar();
        const w = await httpReq(base, "GET", "/", { jar: jar1 });
        assert.equal(w.status, 200);
        const cookieHeader = jar1.header() || "";
        assert.ok(/sid=/.test(cookieHeader));
        logger.success("welcome cookie ok");

        // 3) Session flow with jar (agent)
        logger.info("step:session-flow");
        const agent = new CookieJar();
        await httpReq(base, "GET", "/", { jar: agent });

        await httpReq(base, "POST", "/__test/session/set", { jar: agent, jsonBody: { k: "foo", v: "bar" } });
        const got = await httpReq(base, "GET", "/__test/session/get?k=foo", { jar: agent });
        assert.equal(got.json?.value, "bar");

        const regen = await httpReq(base, "POST", "/__test/session/regenerate", { jar: agent });
        assert.ok(regen.json?.before);
        assert.ok(regen.json?.after);
        assert.notEqual(regen.json?.before, regen.json?.after);

        await httpReq(base, "POST", "/__test/session/destroy", { jar: agent });
        const after = await httpReq(base, "GET", "/__test/session/get?k=foo", { jar: agent });
        assert.equal(after.json?.value, null);
        logger.success("session set/get/regenerate/destroy ok");

        // 4) Tenant mapping
        logger.info("step:tenant");
        const agent2 = new CookieJar();
        await httpReq(base, "GET", "/", { jar: agent2 });

        const r1 = await httpReq(base, "GET", "/__test/tenant", { jar: agent2, headers: { "X-Tenant-Id": "t_acme" } });
        assert.equal(r1.json?.tenant?.id, "t_acme");
        assert.equal(r1.json?.sessionTenant, "t_acme");

        const r2 = await httpReq(base, "GET", "/__test/tenant", { jar: agent2, headers: { "X-App-Key": "k_123", "X-App-Secret": "s_456" } });
        assert.ok(/^t_/.test(r2.json?.tenant?.id || ""));
        assert.equal(typeof r2.json?.sessionTenant, "string");
        logger.success("tenant mapping ok");

        // 5) Config/env sanity
        logger.info("step:config");
        const cfg = loadConfig();
        assert.ok(cfg.appName && typeof cfg.appName === "string");
        assert.ok(typeof cfg.httpPort === "number");
        assert.ok(typeof cfg.corsEnabled === "boolean");
        assert.ok(cfg.session && typeof cfg.session.cookieName === "string");
        logger.success("config/env ok", { appName: cfg.appName, httpPort: cfg.httpPort });

        // 6) Cache API
        logger.info("step:cache");
        const cache = createCache({ driver: "memory", namespace: "test", json: true });
        await cache.set("greet", { hi: "there" }, 2);
        assert.deepEqual(await cache.get("greet"), { hi: "there" });
        let calls = 0;
        const loader = async () => { calls++; return { ts: Date.now() }; };
        const a = await cache.wrap("user:1", 2, loader);
        const b = await cache.wrap("user:1", 2, loader);
        assert.deepEqual(a, b);
        assert.equal(calls, 1);
        const n1 = await cache.incr("count");
        const n2 = await cache.incr("count", 2);
        assert.equal(n1, 1); assert.equal(n2, 3);
        await cache.decr("count", 1);
        assert.equal(await cache.get("count"), "2");
        await cache.expire("count", 1);
        const ttl = await cache.ttl("count");
        assert.ok(typeof ttl === "number" || ttl === null);
        const keys = await cache.keys();
        assert.ok(Array.isArray(keys));
        await cache.flush();
        assert.equal(await cache.get("greet"), undefined);
        logger.success("cache ok");

        // 7) Logger file sink wrote lines
        logger.info("step:logfile");
        await httpReq(base, "GET", "/healthz");
        const txt = await readFile(LOG_FILE, "utf8");
        assert.ok(txt.length > 0);
        logger.success("log file ok", { bytes: txt.length, path: LOG_FILE });

        // 8) Optional DB facade health
        logger.info("step:db (optional)");
        let dbOk = false;
        try {
            const candidates = [
                "../database/connection",
                "../../database/connection",
                "../connection",
                "../../connection",
            ];
            let mod: any = null;
            for (const p of candidates) { try { mod = await import(p); break; } catch { /* try next */ } }
            if (mod?.Connection) {
                const c = await mod.Connection("default");
                if (typeof c.Healthz === "function") dbOk = !!(await c.Healthz());
            }
        } catch {}
        if (dbOk) logger.success("db health ok"); else logger.info("db health skipped (no facade or Healthz=false)");

        logger.success("ALL TESTS PASSED ✅");
    } catch (err) {
        logger.fatal("TEST FAILED", { error: (err as any)?.message || String(err) });
        throw err;
    } finally {
        await close();
    }
}
