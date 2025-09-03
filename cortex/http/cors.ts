// cors.ts
/**
 * Central CORS configuration and helpers.
 * - Reads defaults from environment variables.
 * - Exported helpers are used by chttpx.ts.
 *
 * ENV (all optional):
 *   CORS_ORIGIN="*" | "https://a.com,https://b.com" | "re:^https://(.*)\\.example\\.com$"
 *   CORS_CREDENTIALS=true|false
 *   CORS_ALLOWED_HEADERS="Content-Type,Authorization,X-Requested-With"
 *   CORS_EXPOSED_HEADERS="X-Request-Id"
 *   CORS_METHODS="GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS"
 *   CORS_MAX_AGE=600
 *   CORS_VARY=true|false
 */

export type OriginMatcher =
    | '*'
    | string
    | RegExp
    | Array<string | RegExp>
    | ((origin: string | undefined) => string | boolean);

export interface CORSOptions {
    origin?: OriginMatcher;            // default: '*'
    methods?: string[];                // default: common REST + OPTIONS
    allowedHeaders?: string[];         // default: ['Content-Type','Authorization']
    exposedHeaders?: string[];         // default: []
    credentials?: boolean;             // default: false
    maxAge?: number;                   // default: 600
    vary?: boolean;                    // default: true
}

// ---------- helpers ----------
export function toBool(v: string | undefined, def = false): boolean {
    if (v === undefined) return def;
    return /^(1|true|yes|on)$/i.test(v);
}

export function parseList(v: string | undefined, def: string[] = []): string[] {
    if (!v) return def;
    return v.split(',').map(s => s.trim()).filter(Boolean);
}

/** Parse CORS_ORIGIN to an OriginMatcher */
export function parseOriginEnv(v: string | undefined): OriginMatcher {
    if (!v || v === '*') return '*';
    // allow CSV list
    if (v.includes(',')) return v.split(',').map(s => s.trim()).filter(Boolean);
    // allow regex via "re:pattern"
    if (v.startsWith('re:')) {
        const pat = v.slice(3);
        return new RegExp(pat);
    }
    return v;
}

/** Normalize options to fully-required form */
export function normCors(c: CORSOptions | true | undefined): Required<CORSOptions> {
    if (c === true || c === undefined) {
        return {
            origin: '*',
            methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
            allowedHeaders: ['Content-Type','Authorization'],
            exposedHeaders: [],
            credentials: false,
            maxAge: 600,
            vary: true,
        };
    }
    return {
        origin: c.origin ?? '*',
        methods: c.methods ?? ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
        allowedHeaders: c.allowedHeaders ?? ['Content-Type','Authorization'],
        exposedHeaders: c.exposedHeaders ?? [],
        credentials: !!c.credentials,
        maxAge: c.maxAge ?? 600,
        vary: c.vary ?? true,
    };
}

/** Load defaults from ENV */
export function loadCorsOptions(): Required<CORSOptions> {
    return normCors({
        origin: parseOriginEnv(process.env.CORS_ORIGIN),
        credentials: toBool(process.env.CORS_CREDENTIALS, false),
        allowedHeaders: parseList(process.env.CORS_ALLOWED_HEADERS, ['Content-Type','Authorization']),
        exposedHeaders: parseList(process.env.CORS_EXPOSED_HEADERS, []),
        methods: parseList(process.env.CORS_METHODS, ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']),
        maxAge: Number.isFinite(parseInt(process.env.CORS_MAX_AGE || '', 10))
            ? parseInt(process.env.CORS_MAX_AGE || '600', 10) : 600,
        vary: toBool(process.env.CORS_VARY, true),
    });
}

/** Decide which Origin header to return */
export function matchOrigin(reqOrigin: string | undefined, matcher: OriginMatcher): string | null {
    if (matcher === '*') return '*';
    if (typeof matcher === 'string') return reqOrigin === matcher ? matcher : null;
    if (matcher instanceof RegExp) return reqOrigin && matcher.test(reqOrigin) ? reqOrigin : null;
    if (Array.isArray(matcher)) {
        for (const m of matcher) {
            const v = matchOrigin(reqOrigin, m as any);
            if (v) return v;
        }
        return null;
    }
    if (typeof matcher === 'function') {
        const v = matcher(reqOrigin);
        return v === true ? (reqOrigin ?? '*') : (typeof v === 'string' ? v : null);
    }
    return null;
}

/** Merge Vary header safely */
export function appendVary(current: string | number | string[] | undefined, value: string) {
    const set = new Set<string>(
        (Array.isArray(current) ? current.join(',') : String(current || ''))
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
    );
    set.add(value);
    return Array.from(set).join(', ');
}
