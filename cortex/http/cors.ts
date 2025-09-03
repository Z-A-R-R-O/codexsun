// cortex/framework/cors.ts
// Small CORS helper used by the HTTP server or standalone middlewares.

import type { IncomingMessage, ServerResponse } from "http";

export type OriginConfig = string | string[] | RegExp | RegExp[] | "*";

export interface CORSOptions {
    origin?: OriginConfig;            // default: "*" (when credentials=false)
    methods?: string[];               // default: common verbs
    allowedHeaders?: string[];        // default: common headers
    exposedHeaders?: string[];        // default: []
    credentials?: boolean;            // default: true
    maxAge?: number;                  // default: 86400 (1 day)
    vary?: boolean;                   // default: true (add Vary: Origin)
}

export const defaultCors: CORSOptions = {
    origin: "*",
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-App-Key", "X-App-Secret"],
    exposedHeaders: [],
    credentials: true,
    maxAge: 86400,
    vary: true,
};

export function normalizeCors(input: CORSOptions | boolean | undefined): CORSOptions | undefined {
    if (input === false) return undefined;
    if (input === true || input == null) return { ...defaultCors };
    return { ...defaultCors, ...input };
}

export function isOriginAllowed(cfg: OriginConfig | undefined, origin: string | undefined): boolean {
    if (!origin) return false;
    if (!cfg) return false;
    if (cfg === "*") return true;
    if (Array.isArray(cfg)) {
        return cfg.some((c) => (typeof c === "string" ? c === origin : c instanceof RegExp ? c.test(origin) : false));
    }
    if (typeof cfg === "string") return cfg === origin;
    if (cfg instanceof RegExp) return cfg.test(origin);
    return false;
}

export function applyCorsHeaders(res: ServerResponse, req: IncomingMessage, cfg: CORSOptions): void {
    const origin = req.headers.origin as string | undefined;

    // credentials → cannot use wildcard origin, must echo allowed origin
    const allowCreds = cfg.credentials !== false;
    const allowMethods = (cfg.methods && cfg.methods.length ? cfg.methods : defaultCors.methods)!.join(", ");
    const allowHeaders = (cfg.allowedHeaders && cfg.allowedHeaders.length ? cfg.allowedHeaders : defaultCors.allowedHeaders)!.join(", ");
    const expose = (cfg.exposedHeaders && cfg.exposedHeaders.length ? cfg.exposedHeaders : defaultCors.exposedHeaders)!.join(", ");

    if (allowCreds) {
        if (cfg.origin === "*" && origin) {
            res.setHeader("Access-Control-Allow-Origin", origin);
        } else if (isOriginAllowed(cfg.origin ?? "*", origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin!);
        }
        if (cfg.vary !== false) {
            const prev = String(res.getHeader("Vary") || "");
            res.setHeader("Vary", prev ? `${prev}, Origin` : "Origin");
        }
        res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
        res.setHeader("Access-Control-Allow-Origin", typeof cfg.origin === "string" ? cfg.origin : "*");
    }

    res.setHeader("Access-Control-Allow-Methods", allowMethods);
    res.setHeader("Access-Control-Allow-Headers", allowHeaders);
    if (expose) res.setHeader("Access-Control-Expose-Headers", expose);
    if (cfg.maxAge != null) res.setHeader("Access-Control-Max-Age", String(cfg.maxAge));
}

/**
 * Handles CORS preflight if applicable.
 * @returns true if the request was a preflight and the response has been ended.
 */
export function handlePreflight(req: IncomingMessage, res: ServerResponse, cfg?: CORSOptions | boolean): boolean {
    const method = (req.method || "GET").toUpperCase();
    const options = normalizeCors(cfg);
    if (!options) return false;

    if (method === "OPTIONS" && req.headers.origin) {
        applyCorsHeaders(res, req, options);
        res.statusCode = 204;
        res.end();
        return true;
    }
    // For non-preflight CORS requests, still emit headers:
    applyCorsHeaders(res, req, options);
    return false;
}
