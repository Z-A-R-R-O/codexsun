// cortex/framework/config.ts
// Env helpers + a small, typed app config loader.
// Uses dotenv (loaded in your entrypoints).

export type Truthy = "1" | "true" | "yes" | "on";
export type Falsy = "0" | "false" | "no" | "off";

export function boolEnv(name: string, def = false): boolean {
    const v = process.env[name];
    if (v == null) return def;
    return /^(1|true|yes|on)$/i.test(v);
}

export function intEnv(name: string, def: number): number {
    const v = process.env[name];
    if (v == null || v.trim() === "") return def;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}

export function floatEnv(name: string, def: number): number {
    const v = process.env[name];
    if (v == null || v.trim() === "") return def;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
}

export function strEnv(name: string, def = ""): string {
    const v = process.env[name];
    return v == null ? def : v;
}

export function listEnv(name: string, sep = ",", def: string[] = []): string[] {
    const v = process.env[name];
    if (v == null || !v.trim()) return def;
    return v.split(sep).map(s => s.trim()).filter(Boolean);
}

export function requiredEnv(name: string): string {
    const v = process.env[name];
    if (!v || !v.trim()) {
        throw new Error(`Missing required env: ${name}`);
    }
    return v;
}

// ─────────────────────────────────────────────────────────────
// Typed app config (optional convenience)
// ─────────────────────────────────────────────────────────────
export interface AppConfig {
    appName: string;
    appKey?: string;
    appDebug: boolean;

    host: string;
    httpPort: number;
    httpsPort?: number;

    logJson: boolean;

    // Session defaults (used by your session middleware)
    session: {
        cookieName: string;
        ttlSeconds: number;
        sameSite: "Lax" | "Strict" | "None";
        secure?: boolean; // auto when HTTPS if undefined
    };

    // CORS toggle (you can pass an object instead when booting)
    corsEnabled: boolean;

    // Optional SFTP defaults
    sftp: {
        enable: boolean;
        port: number;
        rootDir: string;
        hostKeyPath?: string;
    };
}

export function loadConfig(): AppConfig {
    const appName = strEnv("APP_NAME", "CodexSun");
    const appKey = process.env.APP_KEY;
    const appDebug = boolEnv("APP_DEBUG", false);

    const host = strEnv("APP_HOST", strEnv("HOST", "0.0.0.0"));
    const httpPort = intEnv("APP_PORT", intEnv("PORT", 3006));
    const httpsPort = process.env.HTTPS_PORT ? intEnv("HTTPS_PORT", 3443) : undefined;

    const logJson = boolEnv("LOG_JSON", false);

    const session = {
        cookieName: strEnv("SESSION_COOKIE", "sid"),
        ttlSeconds: intEnv("SESSION_TTL", 60 * 60 * 2), // 2h
        sameSite: (strEnv("SESSION_SAMESITE", "Lax") as "Lax" | "Strict" | "None"),
        secure: process.env.SESSION_SECURE ? boolEnv("SESSION_SECURE", true) : undefined,
    };

    const corsEnabled = !boolEnv("CORS_DISABLE", false);

    const sftp = {
        enable: boolEnv("SFTP_ENABLE", false),
        port: intEnv("SFTP_PORT", 2222),
        rootDir: strEnv("SFTP_ROOT", "storage/sftp"),
        hostKeyPath: process.env.SFTP_HOST_KEY,
    };

    return { appName, appKey, appDebug, host, httpPort, httpsPort, logJson, session, corsEnabled, sftp };
}

// Export a ready-to-use singleton if you want simple imports.
const config = loadConfig();
export default config;
