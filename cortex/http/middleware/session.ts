// cortex/http/middleware/session.ts
// Signed cookie sessions (sid): HttpOnly, SameSite=Lax, Secure on HTTPS, 2h TTL by default.
// Uses HMAC-SHA256 with APP_KEY to sign the session id.

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "http";
import {
    DEFAULT_SESSION_TTL_SECONDS,
    DEFAULT_SESSION_COOKIE,
    serializeCookie,
    parseCookies,
    type SessionCookieOptions,
} from "../session_data";

export interface SessionOptions {
    cookieName?: string;                 // default: "sid"
    ttlSeconds?: number;                 // default: 2h
    secure?: boolean;                    // default: auto (true on HTTPS / x-forwarded-proto=https)
    sameSite?: "Lax" | "Strict" | "None";// default: "Lax"
    domain?: string;                     // cookie domain
    path?: string;                       // default: "/"
    signKey?: string;                    // HMAC key; default: process.env.APP_KEY
}

export interface SessionData {
    id: string;
    get: (k: string) => any;
    set: (k: string, v: any) => void;
    all: () => Record<string, any>;
    destroy: () => Promise<void>;
    regenerate: () => Promise<void>;
}

type StoreRecord = { data: Record<string, any>; exp: number };

const mem = new Map<string, StoreRecord>();
const nowSec = () => Math.floor(Date.now() / 1000);
const randId = () => crypto.randomBytes(18).toString("base64url");

function hmac(value: string, key: string): string {
    return crypto.createHmac("sha256", key).update(value).digest("base64url");
}
function signCookieValue(sid: string, key: string): string {
    return `${sid}.${hmac(sid, key)}`;
}
function verifyCookieValue(cookieVal: string | undefined, key: string): string | null {
    if (!cookieVal) return null;
    const dot = cookieVal.lastIndexOf(".");
    if (dot <= 0) return null;
    const sid = cookieVal.slice(0, dot);
    const mac = cookieVal.slice(dot + 1);
    const expMac = hmac(sid, key);
    try {
        if (crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expMac))) return sid;
    } catch {}
    return null;
}

function isSecure(req: IncomingMessage, forced?: boolean): boolean {
    if (typeof forced === "boolean") return forced;
    return Boolean((req.socket as any).encrypted) || (req.headers["x-forwarded-proto"] === "https");
}

export function createSessionMiddleware(opts: SessionOptions = {}) {
    const name = opts.cookieName || "sid";
    const ttl = opts.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    const signKey = opts.signKey || process.env.APP_KEY || "change-me";
    const path = opts.path || DEFAULT_SESSION_COOKIE.path;
    const sameSite = opts.sameSite || DEFAULT_SESSION_COOKIE.sameSite;

    return async function sessionMw(
        req: IncomingMessage & { session?: SessionData },
        res: ServerResponse,
        next: () => void | Promise<void>,
    ) {
        const cookies = parseCookies(req.headers["cookie"] as string | undefined);
        const raw = cookies[name];
        const secure = isSecure(req, opts.secure);

        let sid: string | null = verifyCookieValue(raw, signKey);
        if (!sid) sid = randId();

        // load or init
        let rec = mem.get(sid);
        if (!rec || rec.exp <= nowSec()) {
            rec = { data: {}, exp: nowSec() + ttl };
            mem.set(sid, rec);
        }

        const api: SessionData = {
            id: sid,
            get: (k) => rec!.data[k],
            set: (k, v) => {
                rec!.data[k] = v;
            },
            all: () => ({ ...rec!.data }),
            destroy: async () => {
                mem.delete(sid!);
                // overwrite cookie (expire immediately)
                const setCookie = serializeCookie(name, "", {
                    path,
                    domain: opts.domain,
                    sameSite,
                    secure,
                    httpOnly: true,
                    ttlSeconds: 0,
                } as SessionCookieOptions);
                setSetCookie(res, setCookie);
            },
            regenerate: async () => {
                const newId = randId();
                mem.set(newId, { data: rec!.data, exp: nowSec() + ttl });
                mem.delete(sid!);
                sid = newId;
            },
        };

        (req as any).session = api;

        // refresh TTL on every request
        rec.exp = nowSec() + ttl;

        // write (or refresh) signed cookie
        const signed = signCookieValue(sid, signKey);
        const setCookie = serializeCookie(name, signed, {
            path,
            domain: opts.domain,
            sameSite,
            secure,
            httpOnly: true,
            ttlSeconds: ttl,
        } as SessionCookieOptions);
        setSetCookie(res, setCookie);

        await Promise.resolve(next());
    };
}

/** Append Set-Cookie preserving any existing Set-Cookie headers. */
function setSetCookie(res: ServerResponse, value: string) {
    const prev = res.getHeader("Set-Cookie");
    if (!prev) {
        res.setHeader("Set-Cookie", value);
    } else if (Array.isArray(prev)) {
        res.setHeader("Set-Cookie", [...prev, value]);
    } else {
        res.setHeader("Set-Cookie", [String(prev), value]);
    }
}
