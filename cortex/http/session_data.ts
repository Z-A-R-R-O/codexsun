// cortex/framework/session_data.ts
// Shared session types + tiny cookie helpers used across middlewares.

// Core TTL (2 hours)
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 2;

export type SameSite = "Lax" | "Strict" | "None";

export interface SessionSnapshot {
    id: string;
    data: Record<string, any>;
    createdAt: number;  // epoch ms
    expiresAt: number;  // epoch ms
}

export interface SessionCookieOptions {
    name: string;             // cookie name (default: "sid")
    path: string;             // default: "/"
    domain?: string;
    sameSite?: SameSite;      // default: "Lax"
    secure?: boolean;         // default: auto (HTTPS) — set explicitly when needed
    httpOnly?: boolean;       // default: true
    ttlSeconds?: number;      // default: DEFAULT_SESSION_TTL_SECONDS
}

/** Standard defaults used by our session middleware. */
export const DEFAULT_SESSION_COOKIE: Required<Omit<SessionCookieOptions, "domain" | "secure" | "ttlSeconds">> & {
    ttlSeconds: number;
} = {
    name: "sid",
    path: "/",
    sameSite: "Lax",
    secure: false,      // middleware will auto-upgrade to true on HTTPS
    httpOnly: true,
    ttlSeconds: DEFAULT_SESSION_TTL_SECONDS,
};

/** Build a Set-Cookie header value. */
export function serializeCookie(name: string, value: string, opts: SessionCookieOptions = DEFAULT_SESSION_COOKIE): string {
    const o = { ...DEFAULT_SESSION_COOKIE, ...opts };
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path}`];

    if (o.domain) parts.push(`Domain=${o.domain}`);
    if (o.httpOnly !== false) parts.push("HttpOnly");
    if (o.sameSite) parts.push(`SameSite=${o.sameSite}`);
    if (o.secure) parts.push("Secure");
    if (o.ttlSeconds && o.ttlSeconds > 0) parts.push(`Max-Age=${o.ttlSeconds}`);

    return parts.join("; ");
}

/** Parse a Cookie header into a simple object map. */
export function parseCookies(header: string | undefined): Record<string, string> {
    if (!header) return {};
    const out: Record<string, string> = {};
    const parts = header.split(";");
    for (const p of parts) {
        const [k, ...rest] = p.trim().split("=");
        if (!k) continue;
        out[k] = decodeURIComponent(rest.join("=") || "");
    }
    return out;
}
