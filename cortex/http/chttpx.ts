// chttpx.ts (bare Node only, HTTPS-ready, with CORS from ./cors)
import http, { IncomingMessage, ServerResponse } from 'http';
import https, { ServerOptions as HttpsServerOptions } from 'https';
import { URL } from 'url';
import type { CORSOptions } from './cors';
import { loadCorsOptions, normCors, matchOrigin, appendVary } from './cors';

/* ---------------------------------- Types ---------------------------------- */

export type HttpMethod =
    | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    | 'OPTIONS' | 'HEAD' | 'TRACE' | 'CONNECT';

export type ValidationResult<T> =
    | { ok: true; data: T }
    | { ok: false; errors: string[] };

export type Validator<T> = (value: unknown) => ValidationResult<T>;

export interface RouteSchema<Q = any, P = any, B = any> {
    validateQuery?: Validator<Q>;
    validateParams?: Validator<P>;
    validateBody?: Validator<B>;
}

export interface ResponseOut {
    status?: number;
    body?: any;
    headers?: Record<string, string>;
}

export interface RequestContext<Q = any, P = any, B = any> {
    params: P;
    query: Q;
    body: B;
    headers: Record<string, string | string[] | undefined>;
    raw?: { req: IncomingMessage; res: ServerResponse };
}

export interface RouteDef<Q = any, P = any, B = any> {
    method: HttpMethod;
    path: string;
    schema?: RouteSchema<Q,P,B>;
    handler: (ctx: RequestContext<Q,P,B>) => Promise<ResponseOut> | ResponseOut;
}

/* ------------------------------- Path compiler ------------------------------ */

interface CompiledPath { re: RegExp; keys: string[]; }

function escapeRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function compilePath(path: string): CompiledPath {
    const keys: string[] = [];
    const parts = path.split('/').map(seg => {
        if (!seg) return '';
        if (seg === '*') { keys.push('wildcard'); return '(.*)'; }
        if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
        return escapeRe(seg);
    });
    const pattern = '^' + parts.join('/') + '/?$';
    return { re: new RegExp(pattern), keys };
}

/* -------------------------- Shared request handler -------------------------- */

interface NodeCompiled { def: RouteDef; cp: CompiledPath; }

interface BuildOpts {
    base?: string;
    jsonLimitBytes?: number;
    onError?: (e: any) => void;
    cors?: CORSOptions | true; // <— now pulled from cors.ts, or true for defaults
}

function buildRequestListener(routes: RouteDef[], opts?: BuildOpts) {
    const base = opts?.base ?? '';
    const jsonLimit = opts?.jsonLimitBytes ?? 1_000_000; // 1MB
    const onError = opts?.onError ?? (() => {});
    // Use provided CORS opts if present; otherwise load from ENV via cors.ts
    const corsCfg = opts?.cors === undefined ? loadCorsOptions()
        : normCors(opts.cors === true ? {} : opts.cors);

    const compiled: NodeCompiled[] = routes.map(def => ({
        def,
        cp: compilePath(joinUrl(base, def.path))
    }));

    return async function listener(req: IncomingMessage, res: ServerResponse) {
        try {
            const methodRaw = (req.method || 'GET').toUpperCase();
            const method = methodRaw as HttpMethod;
            const url = new URL(req.url || '/', 'http://localhost');
            const path = url.pathname;
            const query = Object.fromEntries(url.searchParams.entries());
            const reqOrigin = req.headers['origin'] as string | undefined;

            // ---------- CORS pre-compute ----------
            let allowOriginHeader: string | null = null;
            if (corsCfg.origin) {
                const matched = matchOrigin(reqOrigin, corsCfg.origin);
                // Rule: if credentials=true, you cannot use '*'
                allowOriginHeader = corsCfg.credentials && matched === '*' ? (reqOrigin ?? '') : matched;
            }
            if (corsCfg.vary && reqOrigin) {
                res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Origin'));
            }

            // Handle preflight
            const isPreflight = method === 'OPTIONS' && !!req.headers['access-control-request-method'];
            if (isPreflight) {
                const acrm = String(req.headers['access-control-request-method']).toUpperCase();
                const acrh = String(req.headers['access-control-request-headers'] || '')
                    .split(',').map(s => s.trim()).filter(Boolean);

                if (allowOriginHeader) res.setHeader('Access-Control-Allow-Origin', allowOriginHeader);
                if (corsCfg.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
                const methods = corsCfg.methods.includes(acrm) ? [acrm] : corsCfg.methods;
                res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
                const allowed = acrh.length ? acrh : corsCfg.allowedHeaders;
                res.setHeader('Access-Control-Allow-Headers', allowed.join(', '));
                if (corsCfg.maxAge) res.setHeader('Access-Control-Max-Age', String(corsCfg.maxAge));
                res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Access-Control-Request-Method'));
                res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Access-Control-Request-Headers'));
                res.statusCode = 204;
                return res.end();
            }

            // ---------- Route matching ----------
            const match = compiled.find(r => r.def.method === method && r.cp.re.test(path));
            if (!match) {
                if (method === 'OPTIONS') {
                    if (allowOriginHeader) res.setHeader('Access-Control-Allow-Origin', allowOriginHeader);
                    if (corsCfg.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
                    res.setHeader('Access-Control-Allow-Methods', corsCfg.methods.join(', '));
                    res.setHeader('Access-Control-Allow-Headers', corsCfg.allowedHeaders.join(', '));
                    res.statusCode = 204;
                    return res.end();
                }
                return send(res, 404, { error: 'Not Found' });
            }

            // ---------- Params ----------
            const m = path.match(match.cp.re)!;
            const params: Record<string, string> = {};
            for (let i = 1; i < m.length; i++) params[match.cp.keys[i - 1]] = decodeURIComponent(m[i] ?? '');

            // ---------- Body (skip for GET/HEAD/TRACE/CONNECT) ----------
            let body: any = undefined;
            if (!['GET','HEAD','TRACE','CONNECT'].includes(method)) {
                const chunks: Buffer[] = [];
                let total = 0;
                await new Promise<void>((resolve, reject) => {
                    req.on('data', (chunk: Buffer) => {
                        total += chunk.length;
                        if (total > jsonLimit) {
                            const err: any = new Error('Payload too large'); err.status = 413;
                            reject(err); req.destroy();
                        } else { chunks.push(chunk); }
                    });
                    req.on('end', resolve);
                    req.on('error', reject);
                });
                const raw = Buffer.concat(chunks).toString('utf8').trim();
                if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
            }

            // ---------- Build ctx ----------
            const ctx: RequestContext = { params, query, body, headers: req.headers, raw: { req, res } };

            // ---------- Optional validation ----------
            const { def } = match;
            if (def.schema?.validateParams) {
                const v = def.schema.validateParams(ctx.params);
                if (!v.ok) return send(res, 400, { error: 'Invalid params', details: v.errors });
                ctx.params = v.data;
            }
            if (def.schema?.validateQuery) {
                const v = def.schema.validateQuery(ctx.query);
                if (!v.ok) return send(res, 400, { error: 'Invalid query', details: v.errors });
                ctx.query = v.data;
            }
            if (def.schema?.validateBody && !['GET','HEAD','TRACE','CONNECT'].includes(method)) {
                const v = def.schema.validateBody(ctx.body);
                if (!v.ok) return send(res, 400, { error: 'Invalid body', details: v.errors });
                ctx.body = v.data;
            }

            // ---------- Call handler ----------
            const out = await def.handler(ctx);

            // ---------- Merge headers + CORS ----------
            const headers = Object.assign({ 'Content-Type': 'application/json' }, out?.headers ?? {});
            if (allowOriginHeader) headers['Access-Control-Allow-Origin'] = allowOriginHeader;
            if (corsCfg.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
            if (corsCfg.exposedHeaders.length) headers['Access-Control-Expose-Headers'] = corsCfg.exposedHeaders.join(', ');
            for (const [k,v] of Object.entries(headers)) res.setHeader(k, v as any);

            res.statusCode = out?.status ?? 200;
            res.end(JSON.stringify(out?.body ?? null));
        } catch (e: any) {
            onError(e);
            const status = e?.status ?? 500;
            send(res, status, { error: status === 413 ? 'Payload too large' : 'Internal Server Error' });
        }
    };
}

/* ---------------------------------- Servers -------------------------------- */

export function createNodeServer(
    routes: RouteDef[],
    opts?: BuildOpts
) {
    const listener = buildRequestListener(routes, opts);
    return http.createServer(listener);
}

export function createHttpsServer(
    routes: RouteDef[],
    tls: HttpsServerOptions,
    opts?: BuildOpts
) {
    const listener = buildRequestListener(routes, opts);
    return https.createServer(tls, listener);
}

/* -------------------------------- Utilities -------------------------------- */

function joinUrl(base: string, path: string) {
    if (!base) return path;
    if (base.endsWith('/') && path.startsWith('/')) return base.slice(0, -1) + path;
    if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
    return base + path;
}

function send(res: ServerResponse, status: number, body: any) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

/* ------------------------------- Route helpers ------------------------------ */

export function makeHealthRoute(path = '/health'): RouteDef {
    return {
        method: 'GET',
        path,
        handler: async () => ({ status: 200, body: { ok: true, ts: new Date().toISOString() } })
    };
}
