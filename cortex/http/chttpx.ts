// cortex/framework/http/chttpx.ts — minimalist HTTP/HTTPS server with CORS, middleware & access logging

import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import { URL } from "url";
import type { Logger } from "../log/logger";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type OriginConfig = string | string[] | RegExp | RegExp[] | "*";

export interface CORSOptions {
    origin?: OriginConfig;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
    vary?: boolean;
}

export interface RequestExtras {
    query: URLSearchParams;
    body?: any;
    params?: Record<string, string>;
    // common app extras (populated by your middlewares)
    session?: any;
    tenant?: any;
    db?: any;
}

export type Handler = (req: IncomingMessage & RequestExtras, res: ServerResponse) => void | Promise<void>;

export interface RouteDef {
    method: string | string[];
    path: string | RegExp;
    handler: Handler;
}

export type Middleware = (
    req: IncomingMessage & Partial<RequestExtras>,
    res: ServerResponse,
    next: () => void | Promise<void>
) => void | Promise<void>;

export interface ServerOptions {
    cors?: CORSOptions | boolean;
    logger?: Logger | any;
    middlewares?: Middleware[];
    onError?: (err: unknown, req: IncomingMessage, res: ServerResponse) => void;
}

export interface TLSOptions {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function isRegExp(v: unknown): v is RegExp {
    return Object.prototype.toString.call(v) === "[object RegExp]";
}
function asArray<T>(v: T | T[]): T[] {
    return Array.isArray(v) ? v : [v];
}

function defaultCORS(): CORSOptions {
    return {
        origin: "*",
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-App-Key", "X-App-Secret"],
        exposedHeaders: ["X-Request-ID"],
        credentials: true,
        maxAge: 86400,
        vary: true,
    };
}

function originMatches(cfg: OriginConfig, origin: string | undefined): boolean {
    if (!origin) return false;
    if (cfg === "*") return true;
    if (Array.isArray(cfg)) {
        return cfg.some((c) => (typeof c === "string" ? c === origin : isRegExp(c) ? c.test(origin) : false));
    }
    if (typeof cfg === "string") return cfg === origin;
    if (isRegExp(cfg)) return cfg.test(origin);
    return false;
}

function applyCORSHeaders(res: ServerResponse, req: IncomingMessage, cfg: CORSOptions) {
    const origin = req.headers.origin as string | undefined;
    const allowCreds = cfg.credentials !== false;
    const allowMethods = (cfg.methods && cfg.methods.length ? cfg.methods : defaultCORS().methods)!.join(", ");
    const allowHeaders = (cfg.allowedHeaders && cfg.allowedHeaders.length ? cfg.allowedHeaders : defaultCORS().allowedHeaders)!.join(", ");
    const expose = (cfg.exposedHeaders && cfg.exposedHeaders.length ? cfg.exposedHeaders : defaultCORS().exposedHeaders)!.join(", ");

    if (allowCreds) {
        if (cfg.origin === "*" && origin) {
            res.setHeader("Access-Control-Allow-Origin", origin);
        } else if (originMatches(cfg.origin ?? "*", origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin as string);
        }
        if (cfg.vary !== false) res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
        res.setHeader("Access-Control-Allow-Origin", typeof cfg.origin === "string" ? cfg.origin : "*");
    }

    res.setHeader("Access-Control-Allow-Methods", allowMethods);
    res.setHeader("Access-Control-Allow-Headers", allowHeaders);
    if (expose) res.setHeader("Access-Control-Expose-Headers", expose);
    if (cfg.maxAge != null) res.setHeader("Access-Control-Max-Age", String(cfg.maxAge));
}

async function parseBody(req: IncomingMessage): Promise<any> {
    const method = (req.method || "GET").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return undefined;

    const ctype = (req.headers["content-type"] || "").toString();
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return undefined;

    if (ctype.includes("application/json")) {
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }
    if (ctype.includes("application/x-www-form-urlencoded")) {
        const usp = new URLSearchParams(raw);
        const obj: Record<string, any> = {};
        usp.forEach((v, k) => {
            obj[k] = v;
        });
        return obj;
    }
    return raw; // fallback: return raw string/body
}

function matchRoute(r: RouteDef, method: string, pathname: string): boolean {
    const methods = asArray(r.method).map((m) => m.toUpperCase());
    if (!methods.includes(method)) return false;
    if (typeof r.path === "string") return r.path === pathname;
    if (isRegExp(r.path)) return r.path.test(pathname);
    return false;
}

// ─────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────
function makeHandler(routes: RouteDef[], opts?: ServerOptions) {
    const corsCfg: CORSOptions | undefined =
        opts?.cors === false ? undefined : (opts?.cors === true || opts?.cors == null) ? defaultCORS() : opts?.cors;
    const logger: Logger | any = opts?.logger;
    const mws = opts?.middlewares || [];

    return async (req: IncomingMessage & RequestExtras, res: ServerResponse) => {
        const start = Date.now();
        try {
            const method = (req.method || "GET").toUpperCase();
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
            req.query = url.searchParams;
            const pathname = url.pathname;

            // Preflight
            if (method === "OPTIONS" && corsCfg) {
                applyCORSHeaders(res, req, corsCfg);
                res.statusCode = 204;
                res.end();
                return;
            }
            if (corsCfg) applyCORSHeaders(res, req, corsCfg);

            req.body = await parseBody(req);

            // run middlewares sequentially
            let i = -1;
            const next = async () => {
                i++;
                if (i < mws.length) {
                    await Promise.resolve(mws[i](req, res, next));
                }
            };
            await next();

            const route = routes.find((r) => matchRoute(r, method, pathname));
            if (!route) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Not Found", path: pathname }));
                return;
            }

            await Promise.resolve(route.handler(req, res));
        } catch (err) {
            if (opts?.onError) return opts.onError(err, req, res);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Internal Server Error" }));
            if (logger?.error) logger.error("handler crash", { error: (err as any)?.message || String(err) });
        } finally {
            // access log
            const ms = Date.now() - start;
            const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || (req.socket as any).remoteAddress;
            const ua = req.headers["user-agent"];
            const m = (req.method || "GET").toUpperCase();
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
            const path = url.pathname + (url.search || "");
            if (logger?.access) logger.access(`${m} ${path}`, { ip, ua, ms });
        }
    };
}

export function createNodeServer(routes: RouteDef[], opts?: ServerOptions): http.Server {
    const handler = makeHandler(routes, opts);
    return http.createServer(handler);
}

export function createHttpsServer(routes: RouteDef[], tls: TLSOptions, opts?: ServerOptions): https.Server {
    const handler = makeHandler(routes, opts);
    return https.createServer(tls, handler);
}
