// tests/base/bootstrap.ts
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

export function section(logger: LoggerLike, title: string, char: "_" | "-" | "=" = "_"): void {
    const line = char.repeat(60);
    logger.info(""); // blank spacer
    logger.info(line);
    logger.info(`  ${title}`);
    logger.info(line);
}

export type NativeResponse = { status: number; headers: IncomingHttpHeaders; buffer: Buffer; text: string; json: any };
export type SendFn = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<NativeResponse>;

// ----------------- Logger -----------------
export async function resolveLogger(): Promise<LoggerLike> {
    if (process.env.E2E_FORCE_CONSOLE === "1") return console;
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
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + (url.search || ""),
        method,
        headers: { ...bodyHeaders, ...headers },
    };

    return new Promise((resolve, reject) => {
        const req = (isHttps ? httpsRequest : httpRequest)(options, (res: IncomingMessage) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const buffer = Buffer.concat(chunks);
                const text = buffer.toString();
                let json: any;
                try {
                    json = JSON.parse(text);
                } catch {
                    json = null;
                }
                resolve({
                    status: res.statusCode || 500,
                    headers: res.headers,
                    buffer,
                    text,
                    json,
                });
            });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

// ----------------- Client -----------------
export function buildClient(base: string, logger: LoggerLike) {
    const jar: Record<string, string> = {};
    const verbose = process.env.E2E_VERBOSE === "1";

    async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<NativeResponse> {
        const start = Date.now();
        const res = await sendRaw(base, method, path, body, { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") });
        const took = Date.now() - start;

        if (res.headers["set-cookie"]) {
            for (const cookie of res.headers["set-cookie"]) {
                const [pair] = cookie.split(";").map(s => s.trim());
                const [key, value] = pair.split("=");
                jar[key] = value;
            }
        }

        if (verbose) {
            logger.info("[E2E:res]", {
                method,
                path,
                status: res.status,
                ms: took,
                headers: res.headers,
                body: res.json ?? res.text,
            });
        }

        return res;
    }

    const get = (p: string, h?: Record<string, string>) => send("GET", p, undefined, h);
    const post = (p: string, b?: unknown, h?: Record<string, string>) => send("POST", p, b, h);
    const patch = (p: string, b?: unknown, h?: Record<string, string>) => send("PATCH", p, b, h);
    return { send, jar, get, post, patch };
}

// ----------------- Base picker & bootstrap -----------------
export async function pickBase(bases: string[], probePath: string, logger: LoggerLike): Promise<string> {
    const verbose = process.env.E2E_VERBOSE === "1";
    let lastErr: unknown = null;
    for (const base of bases) {
        logger.info(`[E2E] probe ${base}${probePath}`);
        try {
            const res = await withRetry(() => sendRaw(base, "GET", probePath), { retries: 3, delay: 1000 });
            if (res.status >= 200 && res.status < 500) {
                logger.info(`[E2E] probe OK -> ${res.status} @ ${base}`);
                if (verbose) {
                    logger.info("[E2E:probe:res]", { base, status: res.status, headers: res.headers, body: res.json ?? res.text });
                }
                return base;
            }
            lastErr = new Error(`probe ${base}${probePath} returned ${res.status}`);
        } catch (e) {
            lastErr = e;
            logger.info("[E2E] probe failed", { base, error: e instanceof Error ? e.message : String(e) });
        }
    }
    throw lastErr ?? new Error("no responsive base URL");
}

async function withRetry<T>(fn: () => Promise<T>, { retries = 3, delay = 1000 } = {}): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

export async function bootstrap(opts?: {
    probePath?: string;
    envVar?: string;
    defaults?: string[];
}) {
    const logger = await resolveLogger();
    const probePath = opts?.probePath ?? "/healthz";
    const envVar = opts?.envVar ?? "E2E_BASE_URL";

    const defaults = opts?.defaults ?? [
        "http://localhost:3006",
    ];

    const bases = [process.env[envVar] || defaults[0], ...defaults.slice(1)];
    const baseURL = await pickBase(bases, probePath, logger);
    const client = buildClient(baseURL, logger);
    return { baseURL, logger, client };
}