// chttpx.ts — bare Node HTTP/HTTPS router with CORS toggle, JSON logs, and DB log hooks.

import http, { IncomingMessage, ServerResponse } from "http";
import https, { ServerOptions as HttpsServerOptions } from "https";
import { URL } from "url";
import { randomUUID } from "crypto";
import type { CORSOptions } from "./cors";
import { loadCorsOptions, normCors, matchOrigin, appendVary } from "./cors";

/* -----------------------------------------------------------------------------
   # CORS + Logging Defaults (top-level constants as requested)
   --------------------------------------------------------------------------- */

// Enable/disable CORS at the file level (can still be overridden by opts/env)
export const CORS_ENABLED_BY_DEFAULT = true;
// If true, we honor CORS_DISABLE / CORS env overrides (see logic below)
export const HONOR_CORS_ENV = true;
// Emit JSON logs to console when no external logger is provided
export const DEFAULT_CONSOLE_JSON_LOG = true;

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
    body?: any;                               // if string + you set text/html header, it will be sent as-is
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

/* --------------------------- Logging / Build opts --------------------------- */

export interface AccessLogRecord {
    ts: string;
    method: string;
    url: string;
    path: string;
    status: number;
    duration_ms: number;
    bytes: number;
    ip?: string;
    request_id: string;
    user_agent?: string;
    referer?: string;
}

export interface LoggerOptions {
    access?: (rec: AccessLogRecord) => void;                       // called after response
    error?: (err: any, ctx: Partial<AccessLogRecord>) => void;     // called on exceptions
}

/** Provide a DB-backed log sink by implementing these methods. */
export interface LogStore {
    writeAccess(rec: AccessLogRecord): Promise<void> | void;
    writeError(err: any, ctx: Partial<AccessLogRecord>): Promise<void> | void;
}

/** Internal helpers */
interface CompiledPath { re: RegExp; keys: string[]; }
interface NodeCompiled { def: RouteDef; cp: CompiledPath; }

interface BuildOpts {
    base?: string;
    jsonLimitBytes?: number;
    onError?: (e: any) => void;
    /** CORS:
     *  - false => disabled
     *  - true  => enabled (load defaults from ENV if present, else from cors.ts defaults)
     *  - object => enabled with provided options
     *  If omitted: driven by top-level constants and ENV (see logic below)
     */
    cors?: CORSOptions | boolean;
    logger?: LoggerOptions;               // structured logs
    logStore?: LogStore;                  // persist logs to DB (optional)
    requestIdHeader?: string;             // default: 'x-request-id'
}

/* ------------------------------- Path compiler ------------------------------ */

function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function compilePath(path: string): CompiledPath {
    const keys: string[] = [];
    const parts = path.split("/").map((seg) => {
        if (!seg) return "";
        if (seg === "*") { keys.push("wildcard"); return "(.*)"; }
        if (seg.startsWith(":")) { keys.push(seg.slice(1)); return "([^/]+)"; }
        return escapeRe(seg);
    });
    const pattern = "^" + parts.join("/") + "/?$";
    return { re: new RegExp(pattern), keys };
}

/* --------------------------------- Helpers --------------------------------- */

const truthy = (v?: string) => /^(1|true|yes|on)$/i.test(v || "");
const falsy  = (v?: string) => /^(0|false|no|off)$/i.test(v || "");

function preferredType(req: IncomingMessage, ...types: string[]): string | null {
    const accept = String(req.headers["accept"] || "").toLowerCase();
    if (!accept) return types[0] ?? null;
    for (const t of types) {
        if (accept.includes(t.toLowerCase())) return t;
    }
    return types[0] ?? null;
}

function writeJson(res: ServerResponse, status: number, obj: any) {
    res.statusCode = status;
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
}

/* -------------------------- Shared request handler -------------------------- */

export function buildRequestListener(routes: RouteDef[], opts?: BuildOpts) {
    const base = opts?.base ?? "";
    const jsonLimit = opts?.jsonLimitBytes ?? 1_000_000; // 1MB
    const onError = opts?.onError ?? (() => {});

    /* ---- Determine CORS state (by consts, env, and opts) ---- */
    const envDisable = HONOR_CORS_ENV && (truthy(process.env.CORS_DISABLE) || falsy(process.env.CORS));
    const defaultEnabled = CORS_ENABLED_BY_DEFAULT && !envDisable;

    let corsDisabled: boolean;
    let corsCfg: ReturnType<typeof normCors> | null = null;

    if (opts?.cors === false) {
        corsDisabled = true;
    } else if (opts?.cors === true) {
        corsDisabled = false;
        corsCfg = normCors({});
    } else if (typeof opts?.cors === "object") {
        corsDisabled = false;
        corsCfg = normCors(opts.cors);
    } else {
        // opts.cors omitted -> use default logic
        corsDisabled = !defaultEnabled;
        corsCfg = corsDisabled ? null : loadCorsOptions();
    }

    const compiled: NodeCompiled[] = routes.map((def) => ({
        def,
        cp: compilePath(joinUrl(base, def.path)),
    }));

    return async function listener(req: IncomingMessage, res: ServerResponse) {
        const t0 = process.hrtime.bigint();
        const reqIdHeader = (opts?.requestIdHeader || "x-request-id").toLowerCase();
        const requestId =
            (req.headers[reqIdHeader] as string | undefined) || randomUUID();
        const ip =
            (req.socket && (req.socket as any).remoteAddress) ||
            (req.headers["x-forwarded-for"] as string | undefined);
        const ua = req.headers["user-agent"] as string | undefined;
        const ref = req.headers["referer"] as string | undefined;

        try {
            const methodRaw = (req.method || "GET").toUpperCase();
            const method = methodRaw as HttpMethod;
            const url = new URL(req.url || "/", "http://localhost");
            const path = url.pathname;
            const query = Object.fromEntries(url.searchParams.entries());
            const reqOrigin = req.headers["origin"] as string | undefined;

            // ---------- CORS pre-compute ----------
            let allowOriginHeader: string | null = null;
            if (!corsDisabled && corsCfg) {
                if (corsCfg.origin) {
                    const matched = matchOrigin(reqOrigin, corsCfg.origin);
                    // Rule: if credentials=true, you cannot use '*'
                    allowOriginHeader = corsCfg.credentials && matched === "*"
                        ? (reqOrigin ?? "")
                        : matched;
                }
                if (corsCfg.vary && reqOrigin) {
                    res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Origin"));
                }
            }

            // Handle preflight
            const isPreflight = method === "OPTIONS" && !!req.headers["access-control-request-method"];
            if (!corsDisabled && corsCfg && isPreflight) {
                const acrm = String(req.headers["access-control-request-method"]).toUpperCase();
                const acrh = String(req.headers["access-control-request-headers"] || "")
                    .split(",").map((s) => s.trim()).filter(Boolean);

                if (allowOriginHeader) res.setHeader("Access-Control-Allow-Origin", allowOriginHeader);
                if (corsCfg.credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
                const methods = corsCfg.methods.includes(acrm) ? [acrm] : corsCfg.methods;
                res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
                const allowed = acrh.length ? acrh : corsCfg.allowedHeaders;
                res.setHeader("Access-Control-Allow-Headers", allowed.join(", "));
                if (corsCfg.maxAge) res.setHeader("Access-Control-Max-Age", String(corsCfg.maxAge));
                res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Access-Control-Request-Method"));
                res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Access-Control-Request-Headers"));
                if (!res.hasHeader("X-Request-Id")) res.setHeader("X-Request-Id", requestId);
                res.statusCode = 204;

                const t1 = process.hrtime.bigint();
                const rec: AccessLogRecord = {
                    ts: new Date().toISOString(),
                    method,
                    url: String(url),
                    path,
                    status: 204,
                    duration_ms: Number((t1 - t0) / 1_000_000n),
                    bytes: 0,
                    ip: typeof ip === "string" ? ip : undefined,
                    request_id: requestId,
                    user_agent: ua,
                    referer: ref,
                };
                if (opts?.logger?.access) opts.logger.access(rec);
                else if (DEFAULT_CONSOLE_JSON_LOG) console.log(JSON.stringify({ level: "access", ...rec }));
                await opts?.logStore?.writeAccess(rec);
                return res.end();
            }

            // ---------- Route matching ----------
            const match = compiled.find((r) => r.def.method === method && r.cp.re.test(path));
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
                return writeJson(res, 404, { error: "Not Found" });
            }

            // ---------- Params ----------
            const m = path.match(match.cp.re)!;
            const params: Record<string, string> = {};
            for (let i = 1; i < m.length; i++) params[match.cp.keys[i - 1]] = decodeURIComponent(m[i] ?? "");

            // ---------- Body (skip for GET/HEAD/TRACE/CONNECT) ----------
            let body: any = undefined;
            if (!["GET", "HEAD", "TRACE", "CONNECT"].includes(method)) {
                const chunks: Buffer[] = [];
                let total = 0;
                await new Promise<void>((resolve, reject) => {
                    req.on("data", (chunk: Buffer) => {
                        total += chunk.length;
                        if (total > jsonLimit) {
                            const err: any = new Error("Payload too large"); err.status = 413;
                            reject(err); req.destroy();
                        } else { chunks.push(chunk); }
                    });
                    req.on("end", resolve);
                    req.on("error", reject);
                });
                const raw = Buffer.concat(chunks).toString("utf8").trim();
                if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
            }

            // ---------- Build ctx ----------
            const ctx: RequestContext = { params, query, body, headers: req.headers, raw: { req, res } };

            // ---------- Optional validation ----------
            const { def } = match;
            if (def.schema?.validateParams) {
                const v = def.schema.validateParams(ctx.params);
                if (!v.ok) return writeJson(res, 400, { error: "Invalid params", details: v.errors });
                ctx.params = v.data;
            }
            if (def.schema?.validateQuery) {
                const v = def.schema.validateQuery(ctx.query);
                if (!v.ok) return writeJson(res, 400, { error: "Invalid query", details: v.errors });
                ctx.query = v.data;
            }
            if (def.schema?.validateBody && !["GET", "HEAD", "TRACE", "CONNECT"].includes(method)) {
                const v = def.schema.validateBody(ctx.body);
                if (!v.ok) return writeJson(res, 400, { error: "Invalid body", details: v.errors });
                ctx.body = v.data;
            }

            // ---------- Call handler ----------
            const out = await def.handler(ctx);

            // ---------- Merge headers + CORS ----------
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

            // Prepare payload and compute bytes
            const isJson = String(res.getHeader("Content-Type") || "").toLowerCase().includes("application/json");
            const bodyStr = isJson ? JSON.stringify(out?.body ?? null) : String(out?.body ?? "");
            const bytes = Buffer.byteLength(bodyStr, "utf8");

            res.end(bodyStr);

            // ---------- Access log ----------
            const t1 = process.hrtime.bigint();
            const rec: AccessLogRecord = {
                ts: new Date().toISOString(),
                method,
                url: String(url),
                path,
                status: res.statusCode,
                duration_ms: Number((t1 - t0) / 1_000_000n),
                bytes,
                ip: typeof ip === "string" ? ip : undefined,
                request_id: requestId,
                user_agent: ua,
                referer: ref,
            };
            if (opts?.logger?.access) opts.logger.access(rec);
            else if (DEFAULT_CONSOLE_JSON_LOG) console.log(JSON.stringify({ level: "access", ...rec }));
            await opts?.logStore?.writeAccess(rec);

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
                if (opts?.logger?.error) opts.logger.error(e, ctx);
                else if (DEFAULT_CONSOLE_JSON_LOG) console.error(JSON.stringify({ level: "error", ...ctx, error: String(e?.stack || e) }));
                await opts?.logStore?.writeError(e, ctx);
            } catch { /* ignore logging failures */ }
            writeJson(res, status, { error: status === 413 ? "Payload too large" : "Internal Server Error" });
        }
    };
}

/* ---------------------------------- Servers -------------------------------- */

export function createNodeServer(
    routes: RouteDef[],
    opts?: BuildOpts
) {
    const listener = buildRequestListener(routes, opts);
    return http.createServer(listener);
}

export function createHttpsServer(
    routes: RouteDef[],
    tls: HttpsServerOptions,
    opts?: BuildOpts
) {
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

/* ------------------------------- Route helpers ------------------------------ */

/** Basic JSON health route (GET /healthz) */
export function makeHealthRoute(path = "/healthz"): RouteDef {
    return {
        method: "GET",
        path,
        handler: async () => ({
            status: 200,
            body: { ok: true, ts: new Date().toISOString() },
            headers: { "Content-Type": "application/json" }
        }),
    };
}

/** Browser-friendly welcome route (GET /).
 *  Sends HTML when the client accepts it; otherwise sends JSON.
 */
export function makeWelcomeRoute(appName = "Codexsun"): RouteDef {
    return {
        method: "GET",
        path: "/",
        handler: async ({ raw }) => {
            const req = raw!.req;
            const wants = preferredType(req, "text/html", "application/json");

            if (wants === "text/html") {
                const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${appName}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Helvetica Neue',sans-serif;
         margin:0; padding:48px; background:#0b1020; color:#e9eef7;}
    .card{max-width:780px; margin:0 auto; background:#111834; border-radius:16px; padding:28px; 
          box-shadow:0 6px 32px rgba(0,0,0,.35)}
    h1{margin:0 0 8px; font-weight:700; letter-spacing:.2px}
    code{background:#0f142b; padding:2px 6px; border-radius:6px}
    a{color:#9bd2ff; text-decoration:none} a:hover{text-decoration:underline}
    .muted{opacity:.8}
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ ${appName} API</h1>
    <p class="muted">Your backend is running without a frontend. Try:</p>
    <ul>
      <li><a href="/healthz">/healthz</a> — JSON health check</li>
      <li><a href="/api/tenants">/api/tenants</a> — example API (if registered)</li>
    </ul>
    <p class="muted">Requests are logged as JSON for analysis.</p>
  </div>
</body>
</html>`;
                return { status: 200, body: html, headers: { "Content-Type": "text/html; charset=utf-8" } };
            }

            return {
                status: 200,
                body: { message: `Welcome to ${appName}!`, endpoints: ["/healthz", "/api/tenants"] },
                headers: { "Content-Type": "application/json" }
            };
        }
    };
}
