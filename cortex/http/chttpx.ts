// cortex/http/chttpx.ts — small bare router with CORS toggle + welcome/health
import http, { IncomingMessage, ServerResponse } from "http";
import https, { ServerOptions as HttpsServerOptions } from "https";
import { URL } from "url";
import { randomUUID } from "crypto";
import type { CORSOptions } from "./cors";
import { loadCorsOptions, normCors, matchOrigin, appendVary } from "./cors";
import type { LoggerOptions, LogStore, AccessLogRecord } from "./logger";

/* ---- CORS toggle constants (can also be overridden by ENV or opts.cors) ---- */
export const CORS_ENABLED_BY_DEFAULT = true;
export const HONOR_CORS_ENV = true;

/* ---------------------------------- Types ---------------------------------- */
export type HttpMethod =
    | "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
    | "OPTIONS" | "HEAD" | "TRACE" | "CONNECT";

export type ValidationResult<T> =
    | { ok: true; data: T }
    | { ok: false; errors: string[] };

export type Validator<T> = (value: unknown) => ValidationResult<T>;

export interface RouteSchema<Q = any, P = any, B = any> {
    validateQuery?: Validator<Q>;
    validateParams?: Validator<P>;
    validateBody?: Validator<B>;
}

export interface ResponseOut {
    status?: number;
    body?: any;
    headers?: Record<string, string>;
}

export interface RequestContext<Q = any, P = any, B = any> {
    params: P;
    query: Q;
    body: B;
    headers: Record<string, string | string[] | undefined>;
    raw?: { req: IncomingMessage; res: ServerResponse };
}

export interface RouteDef<Q = any, P = any, B = any> {
    method: HttpMethod;
    path: string;
    schema?: RouteSchema<Q, P, B>;
    handler: (ctx: RequestContext<Q, P, B>) => Promise<ResponseOut> | ResponseOut;
}

interface BuildOpts {
    base?: string;
    jsonLimitBytes?: number;
    onError?: (e: any) => void;
    cors?: CORSOptions | boolean;     // false = off, true = default, object = options
    logger?: LoggerOptions;
    logStore?: LogStore;
    requestIdHeader?: string;         // default 'x-request-id'
}

/* ------------------------------- Path utils -------------------------------- */
interface CompiledPath { re: RegExp; keys: string[]; }
interface NodeCompiled { def: RouteDef; cp: CompiledPath; }
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function compilePath(path: string): CompiledPath {
    const keys: string[] = [];
    const parts = path.split("/").map(seg => {
        if (!seg) return "";
        if (seg === "*") { keys.push("wildcard"); return "(.*)"; }
        if (seg.startsWith(":")) { keys.push(seg.slice(1)); return "([^/]+)"; }
        return escapeRe(seg);
    });
    return { re: new RegExp("^" + parts.join("/") + "/?$"), keys };
}
const truthy = (v?: string) => /^(1|true|yes|on)$/i.test(v || "");
const falsy  = (v?: string) => /^(0|false|no|off)$/i.test(v || "");

/* -------------------------- Core request listener -------------------------- */
export function buildRequestListener(routes: RouteDef[], opts?: BuildOpts) {
    const base = opts?.base ?? "";
    const jsonLimit = opts?.jsonLimitBytes ?? 1_000_000;
    const onError = opts?.onError ?? (() => {});

    const envDisable = HONOR_CORS_ENV && (truthy(process.env.CORS_DISABLE) || falsy(process.env.CORS));
    const defaultEnabled = CORS_ENABLED_BY_DEFAULT && !envDisable;

    let corsDisabled: boolean;
    let corsCfg: ReturnType<typeof normCors> | null = null;
    if (opts?.cors === false) corsDisabled = true;
    else if (opts?.cors === true) { corsDisabled = false; corsCfg = normCors({}); }
    else if (typeof opts?.cors === "object") { corsDisabled = false; corsCfg = normCors(opts.cors); }
    else { corsDisabled = !defaultEnabled; corsCfg = corsDisabled ? null : loadCorsOptions(); }

    const compiled: NodeCompiled[] = routes.map(def => ({ def, cp: compilePath(joinUrl(base, def.path)) }));

    return async function listener(req: IncomingMessage, res: ServerResponse) {
        const t0 = process.hrtime.bigint();
        const reqIdHeader = (opts?.requestIdHeader || "x-request-id").toLowerCase();
        const requestId = (req.headers[reqIdHeader] as string | undefined) || randomUUID();
        const ip = (req.socket as any)?.remoteAddress || (req.headers["x-forwarded-for"] as string | undefined);
        const ua = req.headers["user-agent"] as string | undefined;
        const ref = req.headers["referer"] as string | undefined;

        try {
            const method = (req.method || "GET").toUpperCase() as HttpMethod;
            const url = new URL(req.url || "/", "http://localhost");
            const path = url.pathname;
            const query = Object.fromEntries(url.searchParams.entries());
            const reqOrigin = req.headers["origin"] as string | undefined;

            // CORS precompute
            let allowOriginHeader: string | null = null;
            if (!corsDisabled && corsCfg) {
                const matched = matchOrigin(reqOrigin, corsCfg.origin);
                allowOriginHeader = (corsCfg.credentials && matched === "*") ? (reqOrigin ?? "") : matched;
                if (corsCfg.vary && reqOrigin) {
                    res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Origin"));
                }
            }

            // Preflight
            const isPreflight = method === "OPTIONS" && !!req.headers["access-control-request-method"];
            if (!corsDisabled && corsCfg && isPreflight) {
                const acrm = String(req.headers["access-control-request-method"]).toUpperCase();
                const acrh = String(req.headers["access-control-request-headers"] || "")
                    .split(",").map(s => s.trim()).filter(Boolean);
                if (allowOriginHeader) res.setHeader("Access-Control-Allow-Origin", allowOriginHeader);
                if (corsCfg.credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
                res.setHeader("Access-Control-Allow-Methods", (corsCfg.methods.includes(acrm) ? [acrm] : corsCfg.methods).join(", "));
                res.setHeader("Access-Control-Allow-Headers", (acrh.length ? acrh : corsCfg.allowedHeaders).join(", "));
                if (corsCfg.maxAge) res.setHeader("Access-Control-Max-Age", String(corsCfg.maxAge));
                res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Access-Control-Request-Method"));
                res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Access-Control-Request-Headers"));
                res.setHeader("X-Request-Id", requestId);
                res.statusCode = 204;

                const rec: AccessLogRecord = {
                    ts: new Date().toISOString(), method, url: String(url), path, status: 204,
                    duration_ms: Number((process.hrtime.bigint() - t0) / 1_000_000n), bytes: 0,
                    ip: typeof ip === "string" ? ip : undefined, request_id: requestId, user_agent: ua, referer: ref
                };
                opts?.logger?.access?.(rec); await opts?.logStore?.writeAccess?.(rec);
                return res.end();
            }

            // Route match
            const match = compiled.find(r => r.def.method === method && r.cp.re.test(path));
            if (!match) {
                if (!corsDisabled && corsCfg && method === "OPTIONS") {
                    if (allowOriginHeader) res.setHeader("Access-Control-Allow-Origin", allowOriginHeader);
                    if (corsCfg.credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
                    res.setHeader("Access-Control-Allow-Methods", corsCfg.methods.join(", "));
                    res.setHeader("Access-Control-Allow-Headers", corsCfg.allowedHeaders.join(", "));
                    res.setHeader("X-Request-Id", requestId);
                    res.statusCode = 204;
                    return res.end();
                }
                if (!corsDisabled && allowOriginHeader) res.setHeader("Access-Control-Allow-Origin", allowOriginHeader);
                if (!corsDisabled && corsCfg?.credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
                res.setHeader("X-Request-Id", requestId);
                return json(res, 404, { error: "Not Found" });
            }

            // Params
            const m = path.match(match.cp.re)!;
            const params: Record<string, string> = {};
            for (let i = 1; i < m.length; i++) params[match.cp.keys[i - 1]] = decodeURIComponent(m[i] ?? "");

            // Body
            let body: any = undefined;
            if (!["GET","HEAD","TRACE","CONNECT"].includes(method)) {
                const chunks: Buffer[] = [];
                let total = 0;
                await new Promise<void>((resolve, reject) => {
                    req.on("data", (chunk: Buffer) => {
                        total += chunk.length;
                        if (total > jsonLimit) { const err: any = new Error("Payload too large"); err.status = 413; reject(err); req.destroy(); }
                        else chunks.push(chunk);
                    });
                    req.on("end", resolve);
                    req.on("error", reject);
                });
                const raw = Buffer.concat(chunks).toString("utf8").trim();
                if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
            }

            const ctx: RequestContext = { params, query, body, headers: req.headers, raw: { req, res } };

            // Schema validation
            const { def } = match;
            if (def.schema?.validateParams) { const v = def.schema.validateParams(ctx.params); if (!v.ok) return json(res, 400, { error: "Invalid params", details: v.errors }); ctx.params = v.data; }
            if (def.schema?.validateQuery) { const v = def.schema.validateQuery(ctx.query); if (!v.ok) return json(res, 400, { error: "Invalid query", details: v.errors }); ctx.query = v.data; }
            if (def.schema?.validateBody && !["GET","HEAD","TRACE","CONNECT"].includes(method)) {
                const v = def.schema.validateBody(ctx.body); if (!v.ok) return json(res, 400, { error: "Invalid body", details: v.errors }); ctx.body = v.data;
            }

            // Execute
            const out = await def.handler(ctx);

            // Headers + CORS
            const headers = Object.assign({}, out?.headers ?? {});
            if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
            if (!corsDisabled && corsCfg) {
                if (allowOriginHeader) headers["Access-Control-Allow-Origin"] = allowOriginHeader;
                if (corsCfg.credentials) headers["Access-Control-Allow-Credentials"] = "true";
                if (corsCfg.exposedHeaders.length) headers["Access-Control-Expose-Headers"] = corsCfg.exposedHeaders.join(", ");
            }
            headers["X-Request-Id"] = requestId;
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v as any);

            res.statusCode = out?.status ?? 200;
            const isJson = String(res.getHeader("Content-Type") || "").toLowerCase().includes("application/json");
            const bodyStr = isJson ? JSON.stringify(out?.body ?? null) : String(out?.body ?? "");
            const bytes = Buffer.byteLength(bodyStr, "utf8");
            res.end(bodyStr);

            const rec: AccessLogRecord = {
                ts: new Date().toISOString(), method, url: String(url), path, status: res.statusCode,
                duration_ms: Number((process.hrtime.bigint() - t0) / 1_000_000n), bytes,
                ip: typeof ip === "string" ? ip : undefined, request_id: requestId, user_agent: ua, referer: ref
            };
            opts?.logger?.access?.(rec);
            await opts?.logStore?.writeAccess?.(rec);

        } catch (e: any) {
            onError(e);
            const status = e?.status ?? 500;
            try {
                const ctx: Partial<AccessLogRecord> = {
                    ts: new Date().toISOString(),
                    method: (req.method || "GET").toUpperCase(),
                    url: String(req.url || "/"),
                    path: req.url ? new URL(req.url, "http://localhost").pathname : "/",
                    ip: (req.socket as any)?.remoteAddress,
                    request_id: (res.getHeader("X-Request-Id") as string) || "",
                };
                opts?.logger?.error?.(e, ctx);
                await opts?.logStore?.writeError?.(e, ctx);
            } catch {}
            json(res, status, { error: status === 413 ? "Payload too large" : "Internal Server Error" });
        }
    };
}

/* ---------------------------------- Servers -------------------------------- */
export function createNodeServer(routes: RouteDef[], opts?: BuildOpts) {
    const listener = buildRequestListener(routes, opts);
    return http.createServer(listener);
}
export function createHttpsServer(routes: RouteDef[], tls: HttpsServerOptions, opts?: BuildOpts) {
    const listener = buildRequestListener(routes, opts);
    return https.createServer(tls, listener);
}

/* -------------------------------- Utilities -------------------------------- */
function joinUrl(base: string, path: string) {
    if (!base) return path;
    if (base.endsWith("/") && path.startsWith("/")) return base.slice(0, -1) + path;
    if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
    return base + path;
}
function json(res: ServerResponse, status: number, obj: any) {
    res.statusCode = status;
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
}

/* ------------------------------- Route helpers ------------------------------ */
export function makeHealthRoute(path = "/healthz"): RouteDef {
    return { method: "GET", path, handler: async () => ({ status: 200, body: { ok: true, ts: new Date().toISOString() } }) };
}
export function makeWelcomeRoute(appName = "CodexSun"): RouteDef {
    return {
        method: "GET",
        path: "/",
        handler: async ({ raw }) => {
            const req = raw!.req;
            const accept = String(req.headers["accept"] || "").toLowerCase();
            const wantsHtml = accept.includes("text/html");
            if (wantsHtml) {
                const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${appName}</title><style>body{font-family:system-ui;margin:0;padding:48px;background:#0b1020;color:#e9eef7}.card{max-width:760px;margin:0 auto;background:#111834;border-radius:16px;padding:28px;box-shadow:0 6px 32px rgba(0,0,0,.35)}</style></head><body><div class="card"><h1>✅ ${appName} API</h1><p>Your backend is running.</p><ul><li><a href="/healthz">/healthz</a></li><li><a href="/api/tenants">/api/tenants</a></li></ul></div></body></html>`;
                return { status: 200, body: html, headers: { "Content-Type": "text/html; charset=utf-8" } };
            }
            return { status: 200, body: { message: `Welcome to ${appName}!`, endpoints: ["/healthz","/api/tenants"] } };
        }
    };
}
