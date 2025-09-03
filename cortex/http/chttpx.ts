/**
 * CORS helpers for chttpx
 */

export type OriginConfig = string | string[] | RegExp | RegExp[] | "*";

export interface CORSOptions {
    origin?: OriginConfig;            // default: "*" in prod unless overridden
    methods?: string[];               // default common methods
    allowedHeaders?: string[];        // default common
    exposedHeaders?: string[];        // default X-* we emit
    credentials?: boolean;            // default true
    maxAge?: number;                  // default 86400 (1 day)
    vary?: boolean;                   // default true
}

export interface NormalizedCORS {
    origin: OriginConfig;
    methods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    credentials: boolean;
    maxAge?: number;
    vary: boolean;
}

const d = {
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowed: ["Content-Type", "Authorization", "X-App-Key", "X-App-Secret"],
    exposed: ["X-Request-Id", "X-Tenant-Id", "X-DB-Profile"],
};

export function normCors(opts: CORSOptions): NormalizedCORS {
    return {
        origin: opts.origin ?? (process.env.CORS_ORIGIN as OriginConfig) ?? (process.env.APP_DEBUG === "true" ? ("*" as OriginConfig) : ("*" as OriginConfig)),
        methods: opts.methods ?? (process.env.CORS_METHODS ? splitCSV(process.env.CORS_METHODS) : d.methods),
        allowedHeaders: opts.allowedHeaders ?? (process.env.CORS_HEADERS ? splitCSV(process.env.CORS_HEADERS) : d.allowed),
        exposedHeaders: opts.exposedHeaders ?? (process.env.CORS_EXPOSE ? splitCSV(process.env.CORS_EXPOSE) : d.exposed),
        credentials: opts.credentials ?? envBool("CORS_CREDENTIALS", true),
        maxAge: opts.maxAge ?? envInt("CORS_MAX_AGE", 86400),
        vary: opts.vary ?? true,
    };
}

export function loadCorsOptions(): NormalizedCORS {
    return normCors({});
}

export function matchOrigin(reqOrigin: string | undefined, cfgOrigin: OriginConfig): string | null {
    if (!reqOrigin) return null;
    if (cfgOrigin === "*") return "*";
    if (typeof cfgOrigin === "string") return reqOrigin === cfgOrigin ? reqOrigin : null;
    if (Array.isArray(cfgOrigin)) {
        for (const it of cfgOrigin) {
            if (typeof it === "string") { if (it === reqOrigin) return reqOrigin; }
            else {
                if (it.test(reqOrigin)) return reqOrigin;
            }
        }
        return null;
    }
    return cfgOrigin.test(reqOrigin) ? reqOrigin : null;
}

export function appendVary(current: string | number | string[] | undefined, value: string): string {
    const existing = (Array.isArray(current) ? current.join(",") : (current ? String(current) : ""))
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    if (!existing.includes(value)) existing.push(value);
    return existing.join(", ");
}

function envBool(name: string, def = false) {
    const v = process.env[name];
    if (v == null) return def;
    return /^(1|true|yes|on)$/i.test(v);
}
function envInt(name: string, def: number) {
    const v = process.env[name];
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : def;
}
function splitCSV(s: string): string[] {
    return s.split(",").map(x => x.trim()).filter(Boolean);
}

export default CORSOptions;
