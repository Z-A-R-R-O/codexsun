// tests/tenant.harness.ts
// Lightweight test harness to execute RouteDef handlers without an HTTP server.
import type { RouteDef } from '../cortex/http/chttpx';
import appRoutes from '../apps/cxsun/src/app';
import { attachAuth } from '../cortex/http/auth/scope';

export type MockRes = { statusCode: number; headers: Record<string,string>; body?: any; end: ()=>void; setHeader: (k:string,v:string)=>void };
export function makeRes(): MockRes {
    const r: any = { statusCode: 200, headers: {}, body: undefined };
    r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = String(v); };
    r.end = () => {};
    return r as MockRes;
}

export async function exec(method: string, path: string, opts: { body?: any; query?: string; headers?: Record<string,string>; scopes?: string[] } = {}) {
    const routes = await appRoutes();
    const route = routes.find(r => r.method === method && (typeof r.path === 'string' ? r.path === path : r.path.test(path)));
    if (!route) throw new Error(`Route not found: ${method} ${path}`);

    const url = `http://test${path}${opts.query ? (path.includes('?') ? '&' : '?') + opts.query : ''}`;
    const req: any = { method, url, headers: { host: 'test', ...(opts.headers ?? {}) }, body: opts.body };
    if (opts.scopes) attachAuth(req, { sub: 'tester', scopes: opts.scopes });
    const res = makeRes();
    await route.handler(req, res);
    return res;
}

