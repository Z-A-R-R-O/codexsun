// // apps/cxsun/src/tenant/code/tenant.api.ts
// // One-stop, production-friendly Tenant API (v1) with:
// // - Input validation
// // - Consistent error envelope
// // - Sorting & filters + offset/limit OR cursor pagination
// // - Pagination headers (X-Total-Count, Link)
// // - ETags + conditional GET (If-None-Match) and optimistic concurrency (If-Match)
// // - Idempotent create (Idempotency-Key)
// // - Soft delete semantics (svc.remove expected to be soft)
// // - API versioning under /api/v1/tenants
// // - OpenAPI descriptor at /api/v1/tenants/openapi.json
// // - Request tracing (x-request-id)
// // - RBAC hooks (scope-based)
// // - Rate limiting (simple in-memory token bucket)
// // - Batch ops, import/export
// // - Per-tenant and global health endpoints
//
// import type { RouteDef } from '../../../../../cortex/http/chttpx';
// import { json } from '../../../../../cortex/http/chttpx';
// import { routes as healthRoutes } from '../../../../../cortex/http/routes/health';
// import { TenantService } from './tenant.service';
// import crypto from 'node:crypto';
//
// /** =============================
//  * Utilities & helpers
//  * ============================= */
// const API_BASE = '/api/v1/tenants';
// const TENANT_ID_RE = new RegExp(`^${API_BASE}/([^/]+)$`);
//
// function getUrl(req: any): URL {
//     return new URL(req?.url || '/', `http://${req?.headers?.host || 'localhost'}`);
// }
//
// function getPathParamId(req: any, re: RegExp): string | null {
//     const m = getUrl(req).pathname.match(re);
//     return m && m[1] ? decodeURIComponent(m[1]) : null;
// }
//
// async function readJsonBody<T = any>(req: any): Promise<T> {
//     if (typeof req?.body !== 'undefined') return req.body as T; // pre-parsed upstream
//     const chunks: Buffer[] = [];
//     await new Promise<void>((resolve, reject) => {
//         req.on('data', (c: Buffer) => chunks.push(c));
//         req.on('end', () => resolve());
//         req.on('error', (e: any) => reject(e));
//     });
//     if (chunks.length === 0) return {} as T;
//     const raw = Buffer.concat(chunks).toString('utf8').trim();
//     if (!raw) return {} as T;
//     try { return JSON.parse(raw) as T; } catch (e: any) { throw new Error(`Invalid JSON body: ${e?.message || e}`); }
// }
//
// function ensureReqId(req: any, res: any) {
//     const rid = (req.headers?.['x-request-id'] as string) || crypto.randomUUID();
//     res.setHeader('x-request-id', rid);
//     (req as any).rid = rid;
// }
//
// function err(res: any, status: number, code: string, message: string, meta?: any) {
//     json(res, { error: { code, message, ...(meta ? { meta } : {}) } }, status);
// }
//
// function ok(res: any, payload: any, status = 200) {
//     json(res, payload, status);
// }
//
// function makeEtag(item: any): string {
//     const id = String(item?.id ?? item?._id ?? 'unknown');
//     const ver = String(item?.updatedAt ?? item?.version ?? 0);
//     const h = crypto.createHash('sha1').update(`${id}:${ver}`).digest('hex').slice(0, 16);
//     return `"ten-${h}"`;
// }
//
// function parseListQuery(req: any) {
//     const url = getUrl(req);
//     const sp = url.searchParams;
//     const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));
//     const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10));
//     const q = sp.get('q') ?? undefined;
//     const sort = (sp.get('sort') ?? 'createdAt') as 'createdAt' | 'name';
//     const order = (sp.get('order') ?? 'desc') as 'asc' | 'desc';
//     const includeDeleted = (sp.get('includeDeleted') ?? 'false') === 'true';
//     const cursor = sp.get('cursor') ?? undefined; // base64 cursor (implementation-specific)
//     return { limit, offset, q, sort, order, includeDeleted, cursor };
// }
//
// // Lightweight validation
// export function assertTenantPayload(x: any) {
//     if (!x || typeof x !== 'object') throw new Error('Body must be a JSON object');
//     const name = String(x.name ?? '').trim();
//     const slug = String(x.slug ?? '').trim();
//     if (!name) throw new Error('name is required');
//     if (!slug) throw new Error('slug is required');
//     const meta = (x.meta && typeof x.meta === 'object') ? x.meta : {};
//     return { name, slug, meta };
// }
//
// // RBAC: simple scope checker wrapper
// function requireScope(scope: string, handler: RouteDef['handler']): RouteDef['handler'] {
//     return async (req, res) => {
//         ensureReqId(req, res);
//         const scopes: string[] = (req?.auth?.scopes as string[]) || [];
//         if (!scopes.includes(scope)) return err(res, 403, 'forbidden', `Missing scope: ${scope}`);
//         return handler(req, res);
//     };
// }
//
// // Rate limiting: naive token bucket per key (IP or auth subject)
// const RATE_LIMIT = { capacity: 20, refillPerSec: 10 }; // burst 20, +10 tokens/sec
// const buckets = new Map<string, { tokens: number; stamp: number }>();
// function rateKey(req: any) { return String(req?.auth?.sub || req?.socket?.remoteAddress || 'anon'); }
// function rateLimit(req: any): boolean {
//     const now = Date.now() / 1000; // seconds
//     const key = rateKey(req);
//     const b = buckets.get(key) || { tokens: RATE_LIMIT.capacity, stamp: now };
//     const delta = Math.max(0, now - b.stamp);
//     b.tokens = Math.min(RATE_LIMIT.capacity, b.tokens + delta * RATE_LIMIT.refillPerSec);
//     b.stamp = now;
//     if (b.tokens < 1) { buckets.set(key, b); return false; }
//     b.tokens -= 1; buckets.set(key, b); return true;
// }
//
// function withGuards(scope: string | null, handler: RouteDef['handler']): RouteDef['handler'] {
//     const core: RouteDef['handler'] = async (req, res) => {
//         ensureReqId(req, res);
//         if (!rateLimit(req)) return err(res, 429, 'rate_limited', 'Too many requests');
//         try { await handler(req, res); } catch (e: any) { err(res, 500, 'internal', e?.message ?? 'Internal error'); }
//     };
//     return scope ? requireScope(scope, core) : core;
// }
//
// // Idempotency store (process-local)
// const idempo = new Map<string, { status: number; body: any; ts: number }>();
// const IDEMPO_TTL_MS = 10 * 60 * 1000; // 10 minutes
// function rememberIdempotency(key: string, status: number, body: any) {
//     idempo.set(key, { status, body, ts: Date.now() });
// }
// function recallIdempotency(key: string): { status: number; body: any } | null {
//     const v = idempo.get(key);
//     if (!v) return null;
//     if (Date.now() - v.ts > IDEMPO_TTL_MS) { idempo.delete(key); return null; }
//     return { status: v.status, body: v.body };
// }
//
// // Pagination headers (RFC-5988-ish for next only)
// function setListHeaders(req: any, res: any, total: number, limit: number, offset: number) {
//     res.setHeader('X-Total-Count', String(total));
//     const base = getUrl(req);
//     base.searchParams.set('limit', String(limit));
//     if (offset + limit < total) {
//         base.searchParams.set('offset', String(offset + limit));
//         res.setHeader('Link', `<${base.href}>; rel="next"`);
//     }
// }
//
// // Event emitter hook (optional svc.emit)
// async function emitEvent(svc: any, type: string, payload: any) {
//     if (typeof svc.emit === 'function') {
//         try { await svc.emit(type, payload); } catch { /* ignore */ }
//     }
// }
//
// /** =============================
//  * Route Provider
//  * ============================= */
// export async function tenantRouteProvider(): Promise<RouteDef[]> {
//     const svc = new TenantService('default');
//     await svc.init();
//
//     // Health (global → tenant API namespace)
//     const healthz = healthRoutes().map(r => ({ ...r, path: `${API_BASE}/healthz` }));
//
//     const routes: RouteDef[] = [
//         ...healthz,
//
//         // Per-tenant health (checks deps for one tenant)
//         {
//             method: 'GET',
//             path: new RegExp(`^${API_BASE}/([^/]+)/healthz$`),
//             handler: withGuards('tenant:read', async (req, res) => {
//                 const id = getPathParamId(req, new RegExp(`^${API_BASE}/([^/]+)/healthz$`));
//                 if (!id) return err(res, 404, 'not_found', 'Tenant not found');
//                 if (typeof (svc as any).health !== 'function') return ok(res, { ok: true }, 200);
//                 const report = await (svc as any).health(id);
//                 ok(res, report, 200);
//             })
//         },
//
//         // OpenAPI descriptor (minimal but useful)
//         {
//             method: 'GET',
//             path: `${API_BASE}/openapi.json`,
//             handler: withGuards(null, async (_req, res) => {
//                 ok(res, {
//                     openapi: '3.0.0',
//                     info: { title: 'Tenant API', version: '1.0.0' },
//                     paths: {
//                         [`${API_BASE}`]: { get: {}, post: {} },
//                         [`${API_BASE}/{id}`]: { get: {}, put: {}, delete: {} },
//                         [`${API_BASE}:batch`]: { post: {} },
//                         [`${API_BASE}/import`]: { post: {} },
//                         [`${API_BASE}/{id}/export`]: { get: {} },
//                         [`${API_BASE}/healthz`]: { get: {} },
//                         [`${API_BASE}/{id}/healthz`]: { get: {} },
//                     },
//                 }, 200);
//             })
//         },
//
//         // LIST (supports offset/limit or cursor)
//         {
//             method: 'GET',
//             path: new RegExp(`^${API_BASE}/?$`),
//             handler: withGuards('tenant:read', async (req, res) => {
//                 const { limit, offset, q, sort, order, includeDeleted, cursor } = parseListQuery(req);
//                 const result = await svc.list(limit, offset, q, { sort, order, includeDeleted, cursor });
//                 // Expect result as { items, total, nextCursor? }
//                 const items = result?.items ?? result ?? [];
//                 const total = Number(result?.total ?? items.length);
//                 if (!result?.nextCursor) setListHeaders(req, res, total, limit, offset);
//                 ok(res, { items, limit, offset, total, ...(result?.nextCursor ? { nextCursor: result.nextCursor } : {}) }, 200);
//             })
//         },
//
//         // CREATE (idempotent via Idempotency-Key)
//         {
//             method: 'POST',
//             path: new RegExp(`^${API_BASE}/?$`),
//             handler: withGuards('tenant:write', async (req, res) => {
//                 const key = String(req.headers?.['idempotency-key'] || '');
//                 if (key) {
//                     const prior = recallIdempotency(key);
//                     if (prior) return ok(res, prior.body, prior.status);
//                 }
//                 const payload = assertTenantPayload(await readJsonBody(req));
//                 const created = await svc.create(payload, { idempotencyKey: key || undefined });
//                 const etag = makeEtag(created);
//                 res.setHeader('ETag', etag);
//                 const body = created;
//                 if (key) rememberIdempotency(key, 201, body);
//                 ok(res, body, 201);
//                 await emitEvent(svc, 'tenant.created', { id: created?.id, payload });
//             })
//         },
//
//         // GET by id (conditional GET)
//         {
//             method: 'GET',
//             path: TENANT_ID_RE,
//             handler: withGuards('tenant:read', async (req, res) => {
//                 const id = getPathParamId(req, TENANT_ID_RE);
//                 if (!id) return err(res, 404, 'not_found', 'Tenant not found');
//                 const item = await svc.get(id);
//                 if (!item) return err(res, 404, 'not_found', 'Tenant not found');
//                 const etag = makeEtag(item);
//                 res.setHeader('ETag', etag);
//                 if ((req.headers?.['if-none-match'] as string) === etag) { res.statusCode = 304; return res.end(); }
//                 ok(res, item, 200);
//             })
//         },
//
//         // UPDATE (optimistic concurrency via If-Match)
//         {
//             method: 'PUT',
//             path: TENANT_ID_RE,
//             handler: withGuards('tenant:write', async (req, res) => {
//                 const id = getPathParamId(req, TENANT_ID_RE);
//                 if (!id) return err(res, 404, 'not_found', 'Tenant not found');
//                 const ifMatch = req.headers?.['if-match'] as string | undefined;
//                 if (!ifMatch) return err(res, 428, 'precondition_required', 'Provide If-Match header');
//                 const payload = assertTenantPayload(await readJsonBody(req));
//                 const updated = await (svc as any).update(id, payload, { expectedEtag: ifMatch });
//                 if (!updated) return err(res, 404, 'not_found', 'Tenant not found');
//                 const etag = makeEtag(updated);
//                 res.setHeader('ETag', etag);
//                 ok(res, updated, 200);
//                 await emitEvent(svc, 'tenant.updated', { id, payload });
//             })
//         },
//
//         // DELETE (soft delete)
//         {
//             method: 'DELETE',
//             path: TENANT_ID_RE,
//             handler: withGuards('tenant:write', async (req, res) => {
//                 const id = getPathParamId(req, TENANT_ID_RE);
//                 if (!id) return err(res, 404, 'not_found', 'Tenant not found');
//                 const okFlag = await svc.remove(id); // expected to soft-delete (sets deletedAt)
//                 if (!okFlag) return err(res, 404, 'not_found', 'Tenant not found');
//                 await emitEvent(svc, 'tenant.deleted', { id });
//                 ok(res, { ok: true }, 200);
//             })
//         },
//
//         // BATCH operations
//         {
//             method: 'POST',
//             path: `${API_BASE}:batch`,
//             handler: withGuards('tenant:write', async (req, res) => {
//                 const body = await readJsonBody(req);
//                 const ops: Array<{ op: 'create' | 'update' | 'delete'; id?: string; data?: any }>
//                     = Array.isArray(body?.operations) ? body.operations : [];
//                 const results: any[] = [];
//                 for (const op of ops) {
//                     try {
//                         if (op.op === 'create') {
//                             const c = await svc.create(assertTenantPayload(op.data ?? {}));
//                             results.push({ ok: true, op: 'create', id: c?.id, item: c });
//                             await emitEvent(svc, 'tenant.created', { id: c?.id });
//                         } else if (op.op === 'update' && op.id) {
//                             const u = await (svc as any).update(op.id, assertTenantPayload(op.data ?? {}));
//                             results.push({ ok: true, op: 'update', id: op.id, item: u });
//                             await emitEvent(svc, 'tenant.updated', { id: op.id });
//                         } else if (op.op === 'delete' && op.id) {
//                             const d = await svc.remove(op.id);
//                             results.push({ ok: !!d, op: 'delete', id: op.id });
//                             await emitEvent(svc, 'tenant.deleted', { id: op.id });
//                         } else {
//                             results.push({ ok: false, error: 'Invalid op' });
//                         }
//                     } catch (e: any) {
//                         results.push({ ok: false, error: String(e?.message ?? e) });
//                     }
//                 }
//                 ok(res, { results }, 200);
//             })
//         },
//
//         // EXPORT one tenant
//         {
//             method: 'GET',
//             path: new RegExp(`^${API_BASE}/([^/]+)/export$`),
//             handler: withGuards('tenant:read', async (req, res) => {
//                 const id = getPathParamId(req, new RegExp(`^${API_BASE}/([^/]+)/export$`));
//                 if (!id) return err(res, 404, 'not_found', 'Tenant not found');
//                 const item = await svc.get(id);
//                 if (!item) return err(res, 404, 'not_found', 'Tenant not found');
//                 res.setHeader('Content-Disposition', `attachment; filename="tenant-${id}.json"`);
//                 ok(res, item, 200);
//             })
//         },
//
//         // IMPORT many tenants
//         {
//             method: 'POST',
//             path: `${API_BASE}/import`,
//             handler: withGuards('tenant:write', async (req, res) => {
//                 const body = await readJsonBody(req);
//                 const arr: any[] = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
//                 if (!Array.isArray(arr) || arr.length === 0) return err(res, 400, 'bad_request', 'Provide an array of tenants');
//                 const created: any[] = [];
//                 const errors: any[] = [];
//                 for (const x of arr) {
//                     try { const c = await svc.create(assertTenantPayload(x)); created.push(c); }
//                     catch (e: any) { errors.push(String(e?.message ?? e)); }
//                 }
//                 ok(res, { created: created.length, items: created, errors }, 201);
//             })
//         },
//     ];
//
//     return routes;
// }
//
// export default tenantRouteProvider;
