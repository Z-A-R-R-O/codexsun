// tests/base/bootstrap.ts
// Shared base for e2e tests: logger, node-native HTTP client, cookie jar, base picker, bootstrap()

import {
    request as httpRequest,
    type IncomingMessage,
    type IncomingHttpHeaders,
    type RequestOptions,
} from "http";
import { request as httpsRequest } from "https";
import { URL } from "url";

// ----------------- Types -----------------
export type LoggerLike = { info: (msg: string, meta?: any) => void; error?: (msg: string, meta?: any) => void };
export type NativeResponse = { status: number; headers: IncomingHttpHeaders; buffer: Buffer; text: string; json: any };
export type SendFn = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<NativeResponse>;

// ----------------- Logger -----------------
/** Resolve project logger; fall back to console. Set E2E_FORCE_CONSOLE=1 to force console. */
export async function resolveLogger(): Promise<LoggerLike> {
    if (process.env.E2E_FORCE_CONSOLE === "1") return console;
    // From tests/base/* to project logger — try a few robust candidates
    const candidates = [
        "../../cortex/log/logger",
        "../cortex/log/logger",
        "../../../cortex/log/logger",
    ];
    for (const p of candidates) {
        try {
            const mod = await import(p);
            const l = (mod as any)?.logger;
            if (l && typeof l.info === "function") return l as LoggerLike;
        } catch { /* try next */ }
    }
    return console;
}

// ----------------- HTTP core -----------------
function toJsonBody(body: unknown): { data?: string; headers: Record<string, string> } {
    if (body === undefined || body === null) return { headers: {} };
    if (typeof body === "string") return { data: body, headers: { "content-type": "application/json" } };
    return { data: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

export async function sendRaw(
    base: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
): Promise<NativeResponse> {
    const url = new URL(path, base);
    const isHttps = url.protocol === "https:";
    const { data, headers: bodyHeaders } = toJsonBody(body);

    const options: RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname, // don't force IPv4; we’ll try multiple bases
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
            accept: "application/json",
            ...(data ? { "content-length": Buffer.byteLength(data).toString() } : {}),
            ...bodyHeaders,
            ...headers,
        },
    };

    return new Promise<NativeResponse>((resolve, reject) => {
        const req = (isHttps ? httpsRequest : httpRequest)(options, (res: IncomingMessage) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.on("end", () => {
                const buffer = Buffer.concat(chunks);
                const text = buffer.toString("utf8");
                let json: any = undefined;
                try { json = text ? JSON.parse(text) : undefined; } catch {}
                resolve({ status: res.statusCode ?? 0, headers: res.headers, buffer, text, json });
            });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 3, delayMs = 150): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, delayMs)); }
    }
    throw lastErr;
}

// ----------------- Cookies -----------------
export class CookieJar {
    private jar = new Map<string, string>();
    addFromSetCookie(setCookie?: string[] | string) {
        if (!setCookie) return;
        const list = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const sc of list) {
            const first = sc.split(";")[0]?.trim(); if (!first) continue;
            const eq = first.indexOf("="); if (eq <= 0) continue;
            const name = first.slice(0, eq).trim(); const val = first.slice(eq + 1).trim();
            if (name) this.jar.set(name, val);
        }
    }
    header(): string | undefined {
        if (this.jar.size === 0) return undefined;
        return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
    }
}

// ----------------- Client builder -----------------

// Compact formatter (keeps logs simple)
const truncate = (v: unknown, n = 200) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
};

export function buildClient(baseURL: string, logger: LoggerLike, jar = new CookieJar()) {
    const verbose = process.env.E2E_VERBOSE === "1"; // toggle deep logs if needed

    const send: SendFn = async (method, path, body, headers) => {
        const started = Date.now();
        const hdrs: Record<string, string> = { ...(headers ?? {}) };
        const cookie = jar.header(); if (cookie) hdrs["Cookie"] = cookie;

        // --- minimal logging (default) ---
        // (uncomment next 2 lines for detailed request logs)
        // logger.info("[E2E:req]", { method, path, url: baseURL + path, headers: hdrs, body });

        const res = await sendRaw(baseURL, method, path, body, hdrs);
        const took = Date.now() - started;

        const setCookie = res.headers["set-cookie"]; if (setCookie) jar.addFromSetCookie(setCookie as any);

        // compact one-liner
        logger.info(`[E2E] ${method} ${path} -> ${res.status} (${took}ms)`);

        // show tiny body preview only when error-ish
        if (res.status >= 400) {
            logger.info("[E2E] body (preview)", { preview: truncate(res.json ?? res.text) });
        }

        // --- detailed logging (enable with E2E_VERBOSE=1 or uncomment) ---
        if (verbose) {
            logger.info("[E2E:res]", {
                method, path, status: res.status, ms: took,
                headers: res.headers,
                body: res.json ?? res.text,
            });
        }
        // logger.info("[E2E:success]", { method, path, status: res.status, ms: took });

        return res;
    };

    const get   = (p: string, h?: Record<string,string>) => send("GET", p, undefined, h);
    const post  = (p: string, b?: unknown, h?: Record<string,string>) => send("POST", p, b, h);
    const patch = (p: string, b?: unknown, h?: Record<string,string>) => send("PATCH", p, b, h);
    return { send, jar, get, post, patch };
}

// ----------------- Base picker & bootstrap -----------------
export async function pickBase(bases: string[], probePath: string, logger: LoggerLike): Promise<string> {
    const verbose = process.env.E2E_VERBOSE === "1";
    let lastErr: unknown = null;
    for (const base of bases) {
        // minimal probe line
        logger.info(`[E2E] probe ${base}${probePath}`);
        try {
            const res = await withRetry(() => sendRaw(base, "GET", probePath));
            if (res.status >= 200 && res.status < 500) {
                logger.info(`[E2E] probe OK -> ${res.status} @ ${base}`);
                if (verbose) {
                    // logger.info("[E2E:probe:res]", { base, status: res.status, headers: res.headers, body: res.json ?? res.text });
                }
                return base;
            }
            lastErr = new Error(`probe ${base}${probePath} returned ${res.status}`);
        } catch (e) {
            lastErr = e;
            // (keep error compact)
            logger.info("[E2E] probe failed", { base, error: e instanceof Error ? e.message : String(e) });
            // Uncomment for deep details:
            // if (verbose) logger.info("[E2E:probe:fail]", { base, error: e });
        }
    }
    throw lastErr ?? new Error("no responsive base URL");
}

export async function bootstrap(opts?: {
    probePath?: string;
    envVar?: string;
    defaults?: string[];
}) {
    const logger = await resolveLogger();
    const probePath = opts?.probePath ?? "/healthz";
    const envVar = opts?.envVar ?? "E2E_BASE_URL";

    // Use only localhost by default; keep 127.0.0.1 commented for optional use.
    const defaults = opts?.defaults ?? [
        // "http://127.0.0.1:3006", // uncomment to probe IPv4 explicitly
        "http://localhost:3006",
    ];

    const bases = [process.env[envVar] || defaults[0], ...defaults.slice(1)];
    const baseURL = await pickBase(bases, probePath, logger);
    const client = buildClient(baseURL, logger);
    return { baseURL, logger, client };
}
