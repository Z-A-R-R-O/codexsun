// cortex/http/route.ts
// -----------------------------------------------------------------------------
// Lightweight HTTP routing with safety hardening + common route helpers
// Type-aligned to chttpx.Handler (void | Promise<void>) and RequestExtras (query: URLSearchParams)
// -----------------------------------------------------------------------------

import type {
    RouteDef,
    Handler as CHttpxHandler,
    RequestExtras, // Assumed: { query: URLSearchParams } (no 'path' required)
} from "./chttpx";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

// Re-export for convenience (single declarations to avoid TS2484)
export type Handler = CHttpxHandler;
export type NodeHandler = Handler;

export interface LoggerLike {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
    debug?(msg: string, meta?: Record<string, unknown>): void;
}

export interface RouterOptions {
    logger?: LoggerLike;
    maxUrlLength?: number;               // default 2048
    strictTrailingSlash?: boolean;       // default false
    allowedMethods?: readonly string[];  // default common verbs
    onNotFound?: (req: IncomingMessage & RequestExtras, res: ServerResponse) => void;
    onError?: (err: unknown, req: IncomingMessage & RequestExtras, res: ServerResponse) => void;
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------
export class Router {
    private readonly routes: RouteDef[];
    private readonly prefix: string;
    private readonly log: Required<LoggerLike>;
    private readonly opt: Required<Omit<RouterOptions, "logger" | "onNotFound" | "onError">>;
    private readonly onNotFound?: RouterOptions["onNotFound"];
    private readonly onError?: RouterOptions["onError"];

    constructor(options?: RouterOptions);
    constructor(routes?: RouteDef[], prefix?: string, options?: RouterOptions);
    constructor(a?: RouteDef[] | RouterOptions, b?: string, c?: RouterOptions) {
        const isOpts = (x: unknown): x is RouterOptions => !!x && !Array.isArray(x);
        const routes = Array.isArray(a) ? a : [];
        const prefix = typeof b === "string" ? b : "";
        const opts: RouterOptions = (Array.isArray(a) ? c : (isOpts(a) ? a : c)) ?? {};

        const logger: LoggerLike = opts.logger ?? {};
        this.log = {
            info: logger.info ?? (() => {}),
            warn: logger.warn ?? (() => {}),
            error: logger.error ?? (() => {}),
            debug: logger.debug ?? (() => {}),
        };

        this.routes = routes;
        this.prefix = normalizePrefix(prefix);
        this.opt = {
            maxUrlLength: opts.maxUrlLength ?? 2048,
            strictTrailingSlash: opts.strictTrailingSlash ?? false,
            allowedMethods: opts.allowedMethods ?? ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
        };
        this.onNotFound = opts.onNotFound;
        this.onError = opts.onError;
    }

    // Core verbs
    get(path: string | RegExp, handler: Handler)    { return this.add("GET", path, handler); }
    post(path: string | RegExp, handler: Handler)   { return this.add("POST", path, handler); }
    put(path: string | RegExp, handler: Handler)    { return this.add("PUT", path, handler); }
    delete(path: string | RegExp, handler: Handler) { return this.add("DELETE", path, handler); }

    // Optional verbs
    patch(path: string | RegExp, handler: Handler)  { return this.add("PATCH", path, handler); }
    head(path: string | RegExp, handler: Handler)   { return this.add("HEAD", path, handler); }
    options(path: string | RegExp, handler: Handler){ return this.add("OPTIONS", path, handler); }

    /** Custom method */
    method(method: string, path: string | RegExp, handler: Handler) {
        return this.add(method.toUpperCase(), path, handler);
    }

    /** Create a child router that prefixes all added paths with `prefix` */
    group(prefix: string): Router {
        const merged = joinPrefix(this.prefix, prefix);
        return new Router(this.routes, merged, {
            logger: this.log,
            maxUrlLength: this.opt.maxUrlLength,
            strictTrailingSlash: this.opt.strictTrailingSlash,
            allowedMethods: this.opt.allowedMethods,
            onNotFound: this.onNotFound,
            onError: this.onError,
        });
    }

    /** Return all collected route definitions */
    all(): RouteDef[] {
        return this.routes;
    }

    // -----------------------------------------------------------------------------
    // Dispatcher with hardening + req augmentation (fixes TS2345)
    // -----------------------------------------------------------------------------
    async resolve(reqRaw: IncomingMessage, res: ServerResponse): Promise<void> {
        // Augment to satisfy IncomingMessage & RequestExtras (query: URLSearchParams)
        const req = reqRaw as IncomingMessage & RequestExtras;

        const rawUrl = req.url ?? "/";
        const method = (req.method ?? "GET").toUpperCase();

        if (!this.opt.allowedMethods.includes(method)) {
            return this.writeJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED", method });
        }

        if (rawUrl.length > this.opt.maxUrlLength) {
            this.log.warn?.("blocked_overlong_url", { len: rawUrl.length, cap: this.opt.maxUrlLength, url: elide(rawUrl) });
            return this.writeJson(res, 414, { ok: false, error: "URI_TOO_LONG" });
        }

        const safe = safeParseUrl(rawUrl);
        if (!safe.ok) {
            this.log.warn?.("blocked_malformed_url", { reason: safe.reason, url: elide(rawUrl) });
            return this.writeJson(res, 400, { ok: false, error: "BAD_URL" });
        }

        // Build URLSearchParams for RequestExtras.query
        const url = safe.value;
        const sanitizedPath = sanitizePath(url.pathname || "/", { strictTrailingSlash: this.opt.strictTrailingSlash });
        const searchParams = new URLSearchParams(url.searchParams); // clone to ensure mutability

        // Attach ONLY the required RequestExtras fields (query)
        attachQuery(req, searchParams);

        const suspicious = detectSuspicious(sanitizedPath);
        if (suspicious) {
            this.log.warn?.("suspicious_path_detected", { path: sanitizedPath, issues: suspicious });
            // Optionally early block:
            // return this.writeJson(res, 400, { ok: false, error: "SUSPICIOUS_PATH" });
        }

        const match = findRoute(this.routes, method, sanitizedPath);
        if (!match) {
            this.log.info?.("route_not_found", { method, path: sanitizedPath });
            if (this.onNotFound) return this.onNotFound(req, res);
            return this.writeJson(res, 404, { ok: false, error: "NOT_FOUND", method, path: sanitizedPath });
        }

        try {
            await (match.handler as Handler)(req, res); // void | Promise<void>
            if (!res.writableEnded) res.end();          // avoid hanging sockets
        } catch (err: any) {
            this.log.error?.("route_handler_error", { method, path: sanitizedPath, message: err?.message ?? String(err) });
            if (this.onError) return this.onError(err, req, res);
            return this.writeJson(res, 500, { ok: false, error: "INTERNAL", message: err?.message ?? "Unknown error" });
        }
    }

    // -------- internals --------

    private add(method: string, path: string | RegExp, handler: Handler) {
        const fullPath = typeof path === "string" ? joinPrefix(this.prefix, path || "/") : path;
        const r: RouteDef = { method, path: fullPath, handler };
        this.routes.push(r);
        return {
            named: (name: string) => {
                (r as any).name = name;
                return this as Router;
            },
        };
    }

    private writeJson(res: ServerResponse, status: number, data: unknown) {
        const body = Buffer.from(JSON.stringify(data));
        if (!res.headersSent) {
            res.statusCode = status;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("content-length", String(body.byteLength));
        }
        res.end(body);
    }
}

// -----------------------------------------------------------------------------
// Feature route abstraction (shared helpers)
// -----------------------------------------------------------------------------

export interface IRoutes<C = unknown> {
    readonly prefix: string;     // e.g., "/api/tenants"
    readonly controller: C;
    register(router: Router): Router;
}

/**
 * Routes — abstract base that encapsulates common adapters & helpers so
 * feature routes only describe paths + controllers.
 */
export abstract class Routes<C = unknown> implements IRoutes<C> {
    constructor(public readonly controller: C, public readonly prefix: string) {}
    abstract register(router: Router): Router;

    /**
     * Convert Node IncomingMessage (+RequestExtras) into a minimal request object
     * for controllers. We keep `req.query` as URLSearchParams to satisfy type
     * requirements, but expose a plain-object `queryObj` to controllers.
     */
    protected toHttpRequest(reqRaw: IncomingMessage): any {
        const req = reqRaw as IncomingMessage & RequestExtras;
        const rawUrl = req.url ?? "/";
        const safe = safeParseUrl(rawUrl);
        const url = safe.ok ? safe.value : new URL("/", "http://localhost");

        const path = sanitizePath(url.pathname || "/");

        // Build a plain object for controller convenience, but DO NOT attach to req
        const queryObj: Record<string, string | string[]> = urlSearchParamsToObject(req.query ?? url.searchParams);

        return {
            method: (req.method || "GET").toUpperCase(),
            path,
            query: queryObj,
            headers: req.headers,
            // params can be added by your own route param logic if needed
        };
    }

    /** Write JSON response with status */
    protected writeJson(res: ServerResponse, data: unknown, status = 200) {
        const body = Buffer.from(JSON.stringify(data));
        res.statusCode = status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("content-length", String(body.byteLength));
        res.end(body);
    }

    /** Wrap a controller handler; returns a Node-style Handler (void | Promise<void>) */
    protected withHandler(fn: (httpReq: any) => any | Promise<any>): Handler {
        return async (reqRaw, res) => {
            const req = reqRaw as IncomingMessage & RequestExtras;
            try {
                const data = await fn(this.toHttpRequest(req));
                if (!res.headersSent) this.writeJson(res, data, 200);
            } catch (err: any) {
                if (!res.headersSent) {
                    this.writeJson(res, { ok: false, error: "INTERNAL", message: err?.message || String(err) }, 500);
                } else {
                    try { res.end(); } catch {}
                }
            }
        };
    }

    /**
     * Inject a single path param from the URL segments into the handler.
     * We compute the sanitized path locally (do not assume RequestExtras has `path`).
     */
    protected withParam(name: string, fn: (httpReq: any) => any | Promise<any>): Handler {
        return async (reqRaw, res) => {
            const req = reqRaw as IncomingMessage & RequestExtras;
            const safe = safeParseUrl(req.url ?? "/");
            const url = safe.ok ? safe.value : new URL("/", "http://localhost");
            const path = sanitizePath(url.pathname || "/");

            const parts = path.split("/").filter((s: string) => !!s);
            const idx = parts.findIndex((seg: string) => seg === name || seg === `:${name}`);
            const val = parts[(idx >= 0 ? idx : parts.length - 1)] ?? "";

            const httpReq = this.toHttpRequest(req);
            const nextReq = { ...httpReq, params: { ...(httpReq as any).params ?? {}, [name]: val } };

            try {
                const data = await fn(nextReq);
                if (!res.headersSent) this.writeJson(res, data, 200);
            } catch (err: any) {
                if (!res.headersSent) {
                    this.writeJson(res, { ok: false, error: "INTERNAL", message: err?.message || String(err) }, 500);
                } else {
                    try { res.end(); } catch {}
                }
            }
        };
    }
}

// -----------------------------------------------------------------------------
// Utilities (path safety / matching)
// -----------------------------------------------------------------------------

function normalizePrefix(p: string): string {
    if (!p) return "";
    if (p === "/") return "/";
    return p.startsWith("/") ? p : `/${p}`;
}

function joinPrefix(base: string, child: string): string {
    const a = normalizePrefix(base);
    const b = normalizePrefix(child);
    if (a === "/") return b || "/";
    if (!a) return b || "/";
    if (!b || b === "/") return a || "/";
    return `${a.replace(/\/+$/g, "")}/${b.replace(/^\/+/g, "")}`;
}

function safeParseUrl(rawUrl: string): { ok: true; value: URL } | { ok: false; reason: string } {
    try {
        return { ok: true, value: new URL(rawUrl, "http://localhost") };
    } catch (e: any) {
        return { ok: false, reason: e?.message ?? "invalid_url" };
    }
}

function sanitizePath(pathname: string, opts?: { strictTrailingSlash?: boolean }): string {
    let p = pathname.replace(/[\0-\x1F\x7F]/g, ""); // strip control chars
    p = p.replace(/\/{2,}/g, "/");                  // collapse multiple slashes
    const segs: string[] = [];
    for (const part of p.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") { segs.pop(); } else { segs.push(part); }
    }
    p = "/" + segs.join("/");
    if (opts?.strictTrailingSlash) return p;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p;
}

function detectSuspicious(path: string): string[] | null {
    const issues: string[] = [];
    if (path.includes("..")) issues.push("path_traversal");
    if (/\\/.test(path)) issues.push("backslash_in_path");
    if (/%2e/i.test(path) || /%5c/i.test(path)) issues.push("encoded_traversal");
    if (/[:@][/]{2}/.test(path)) issues.push("embedded_scheme_like");
    if (/[<>]/.test(path)) issues.push("angle_brackets");
    if (/\/\/+/.test(path)) issues.push("double_slash");
    if (path.length > 1024) issues.push("path_too_long");
    return issues.length ? issues : null;
}

function findRoute(routes: RouteDef[], method: string, path: string) {
    for (const r of routes) {
        if (r.method !== method) continue;
        if (typeof r.path === "string") {
            if (r.path === path) return r;
        } else {
            if (r.path.test(path)) return r;
        }
    }
    return null;
}

function elide(s: string, max = 256) {
    return s.length <= max ? s : s.slice(0, max) + "…";
}

/** Convert URLSearchParams to a plain object for controller convenience */
function urlSearchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    params.forEach((v: string, k: string) => {
        if (k in out) {
            const prev = out[k];
            out[k] = Array.isArray(prev) ? [...prev, v] : [prev as string, v];
        } else {
            out[k] = v;
        }
    });
    return out;
}

/** Attach query as URLSearchParams onto the IncomingMessage (satisfies RequestExtras) */
function attachQuery(req: IncomingMessage, query: URLSearchParams) {
    Object.defineProperty(req, "query", {
        value: query,
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

// -----------------------------------------------------------------------------
// Aggregate export (default) + named exports (single declarations; no conflicts)
// -----------------------------------------------------------------------------

const RouteKit = { Router, Routes };
export default RouteKit;

export { Router as HttpRouter, Routes as BaseRoutes };
// export type { IRoutes, RouterOptions, LoggerLike };
