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
// import type { RouteDef } from '../../../../cortex/http/chttpx';
// import { json } from '../../../../cortex/http/chttpx';
// import { routes as healthRoutes } from '../../../../cortex/http/routes/health';
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
//
//
// // apps/cxsun/src/tenant/code/tenant.types.ts
// export type Tenant = {
//     id: string;
//     name: string;
//     slug: string;
//     meta?: Record<string, any>;
//     createdAt: number; // epoch ms
//     updatedAt: number; // epoch ms
//     deletedAt?: number | null;
//     version: number;   // increments on every update
// };
//
// export type ListOptions = {
//     sort?: 'createdAt' | 'name';
//     order?: 'asc' | 'desc';
//     includeDeleted?: boolean;
//     cursor?: string; // base64
// };
//
// // apps/cxsun/src/tenant/code/tenant.controller.ts
// import crypto from 'node:crypto';
// import type { Tenant, ListOptions } from './tenant.types';
//
// // In-memory store (namespaced). Swap with DB easily.
// const STORE = new Map<string, Map<string, Tenant>>(); // namespace -> (id -> tenant)
// const IDEMPO = new Map<string, Map<string, string>>(); // namespace -> (idempotencyKey -> tenantId)
//
// function b64(s: string) { return Buffer.from(s, 'utf8').toString('base64url'); }
// function unb64(s: string) { return Buffer.from(s, 'base64url').toString('utf8'); }
//
// export function makeEtag(item: Pick<Tenant, 'id' | 'updatedAt' | 'version'>): string {
//     const h = crypto.createHash('sha1').update(`${item.id}:${item.updatedAt}:${item.version}`).digest('hex').slice(0, 16);
//     return `"ten-${h}"`;
// }
//
// export class TenantController {
//     constructor(private namespace: string) {}
//
//     async init(): Promise<void> {
//         if (!STORE.has(this.namespace)) STORE.set(this.namespace, new Map());
//         if (!IDEMPO.has(this.namespace)) IDEMPO.set(this.namespace, new Map());
//     }
//
//     /** Full-text-ish filter */
//     private matches(t: Tenant, q?: string): boolean {
//         if (!q) return true;
//         const needle = q.toLowerCase();
//         return (
//             t.name.toLowerCase().includes(needle) ||
//             t.slug.toLowerCase().includes(needle) ||
//             JSON.stringify(t.meta ?? {}).toLowerCase().includes(needle)
//         );
//     }
//
//     private sorters = {
//         createdAt: (a: Tenant, b: Tenant) => a.createdAt - b.createdAt,
//         name: (a: Tenant, b: Tenant) => a.name.localeCompare(b.name)
//     } as const;
//
//     async list(limit: number, offset: number, q?: string, opts: ListOptions = {}): Promise<{ items: Tenant[]; total: number; nextCursor?: string }>{
//         const db = STORE.get(this.namespace)!;
//         let items = Array.from(db.values());
//         if (!opts.includeDeleted) items = items.filter(t => !t.deletedAt);
//         items = items.filter(t => this.matches(t, q));
//
//         const sortKey = opts.sort ?? 'createdAt';
//         const order = opts.order ?? 'desc';
//         items.sort(this.sorters[sortKey]);
//         if (order === 'desc') items.reverse();
//
//         const total = items.length;
//
//         if (opts.cursor) {
//             // cursor is base64(index)
//             const start = Math.max(0, parseInt(unb64(opts.cursor), 10) || 0);
//             const slice = items.slice(start, start + limit);
//             const nextIdx = start + limit;
//             const nextCursor = nextIdx < total ? b64(String(nextIdx)) : undefined;
//             return { items: slice, total, ...(nextCursor ? { nextCursor } : {}) };
//         }
//
//         const slice = items.slice(offset, offset + limit);
//         return { items: slice, total };
//     }
//
//     async get(id: string): Promise<Tenant | null> {
//         const db = STORE.get(this.namespace)!;
//         return db.get(id) ?? null;
//     }
//
//     async getBySlug(slug: string): Promise<Tenant | null> {
//         const db = STORE.get(this.namespace)!;
//         for (const t of db.values()) if (t.slug === slug) return t;
//         return null;
//     }
//
//     async create(data: { name: string; slug: string; meta?: Record<string, any> }, opts: { idempotencyKey?: string } = {}): Promise<Tenant> {
//         const db = STORE.get(this.namespace)!;
//         const idempot = IDEMPO.get(this.namespace)!;
//
//         if (opts.idempotencyKey) {
//             const priorId = idempot.get(opts.idempotencyKey);
//             if (priorId) {
//                 const prior = db.get(priorId);
//                 if (prior) return prior; // idempotent replay
//             }
//         }
//
//         // uniqueness on slug
//         if (await this.getBySlug(data.slug)) {
//             throw new Error('slug must be unique');
//         }
//
//         const now = Date.now();
//         const id = crypto.randomUUID();
//         const doc: Tenant = {
//             id,
//             name: data.name,
//             slug: data.slug,
//             meta: data.meta ?? {},
//             createdAt: now,
//             updatedAt: now,
//             version: 1,
//         };
//         db.set(id, doc);
//
//         if (opts.idempotencyKey) idempot.set(opts.idempotencyKey, id);
//         return doc;
//     }
//
//     async update(id: string, data: { name: string; slug: string; meta?: Record<string, any> }, opts: { expectedEtag?: string } = {}): Promise<Tenant | null> {
//         const db = STORE.get(this.namespace)!;
//         const existing = db.get(id);
//         if (!existing || existing.deletedAt) return null;
//
//         if (opts.expectedEtag) {
//             const currentTag = makeEtag(existing);
//             if (currentTag !== opts.expectedEtag) {
//                 const err: any = new Error('etag_mismatch');
//                 err.status = 412; // Precondition Failed
//                 throw err;
//             }
//         }
//
//         // slug uniqueness (excluding current)
//         if (data.slug && data.slug !== existing.slug) {
//             const dup = await this.getBySlug(data.slug);
//             if (dup && dup.id !== id) throw new Error('slug must be unique');
//         }
//
//         existing.name = data.name ?? existing.name;
//         existing.slug = data.slug ?? existing.slug;
//         existing.meta = (typeof data.meta === 'object' && data.meta !== null) ? data.meta : existing.meta;
//         existing.updatedAt = Date.now();
//         existing.version += 1;
//         db.set(id, existing);
//         return existing;
//     }
//
//     async remove(id: string): Promise<boolean> {
//         const db = STORE.get(this.namespace)!;
//         const t = db.get(id);
//         if (!t || t.deletedAt) return false;
//         t.deletedAt = Date.now();
//         t.updatedAt = t.deletedAt;
//         t.version += 1;
//         db.set(id, t);
//         return true;
//     }
//
//     async health(id: string): Promise<{ ok: boolean; tenant?: string }> {
//         const t = await this.get(id);
//         return { ok: !!t, tenant: t?.slug };
//     }
// }
//
// // apps/cxsun/src/tenant/code/tenant.service.ts
// import type { ListOptions, Tenant } from './tenant.types';
// import { TenantController, makeEtag } from './tenant.controller';
//
// export class TenantService {
//     private controller: TenantController;
//
//     constructor(private namespace: string) {
//         this.controller = new TenantController(namespace);
//     }
//
//     async init(): Promise<void> { await this.controller.init(); }
//
//     // Keep signature compatible with tenant.api
//     async list(limit: number, offset: number, q?: string, opts?: ListOptions): Promise<{ items: Tenant[]; total: number; nextCursor?: string }>{
//         return this.controller.list(limit, offset, q, opts);
//     }
//
//     async get(id: string): Promise<Tenant | null> { return this.controller.get(id); }
//
//     async create(payload: { name: string; slug: string; meta?: Record<string, any> }, opts?: { idempotencyKey?: string }): Promise<Tenant> {
//         // normalize
//         const data = { ...payload, name: payload.name.trim(), slug: payload.slug.trim().toLowerCase() };
//         return this.controller.create(data, opts);
//     }
//
//     async update(id: string, payload: { name: string; slug: string; meta?: Record<string, any> }, opts?: { expectedEtag?: string }): Promise<Tenant | null> {
//         const data = { ...payload, name: payload.name.trim(), slug: payload.slug.trim().toLowerCase() };
//         return this.controller.update(id, data, opts);
//     }
//
//     async remove(id: string): Promise<boolean> { return this.controller.remove(id); }
//
//     async health(id: string): Promise<{ ok: boolean; tenant?: string }> { return this.controller.health(id); }
//
//     // Event bus hook (no-op by default). API calls emit through this.
//     async emit(type: string, payload: any): Promise<void> {
//         // Replace with your event bus
//         // e.g., await this.bus.publish(`tenant.${type}`, payload)
//         void type; void payload; return;
//     }
//
//     // Expose an etag builder for external uses if needed
//     etag(t: Tenant) { return makeEtag(t); }
// }
//
//
// // apps/cxsun/src/app.ts
// // App entrypoint: expose all routes for the chttpx loader
// import type { RouteDef } from '../../cortex/http/chttpx';
// import tenantRouteProvider from './tenant/code/tenant.api';
//
// export default async function appRoutes(): Promise<RouteDef[]> {
//     const routes = await tenantRouteProvider();
//     return routes;
// }
//
// // cortex/apps/cxsun/app.ts (shim for your loader that expects this path)
// import type { RouteDef } from '../../http/chttpx';
// import appRoutes from '../../apps/cxsun/src/app';
//
// export default async function loadApp(): Promise<RouteDef[]> {
//     return appRoutes();
// }
//
// // cortex/http/auth/scope.ts
// // Minimal RBAC helper used by tests or upstream server middleware
// export type AuthContext = { sub?: string; scopes?: string[] };
// export function attachAuth(req: any, ctx: AuthContext) {
//     (req as any).auth = { ...(req as any).auth, ...ctx };
//     return req;
// }
//
// // tests/tenant.harness.ts
// // Lightweight test harness to execute RouteDef handlers without an HTTP server.
// import type { RouteDef } from '../cortex/http/chttpx';
// import appRoutes from '../apps/cxsun/src/app';
// import { attachAuth } from '../cortex/http/auth/scope';
//
// export type MockRes = { statusCode: number; headers: Record<string,string>; body?: any; end: ()=>void; setHeader: (k:string,v:string)=>void };
// export function makeRes(): MockRes {
//     const r: any = { statusCode: 200, headers: {}, body: undefined };
//     r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = String(v); };
//     r.end = () => {};
//     return r as MockRes;
// }
//
// export async function exec(method: string, path: string, opts: { body?: any; query?: string; headers?: Record<string,string>; scopes?: string[] } = {}) {
//     const routes = await appRoutes();
//     const route = routes.find(r => r.method === method && (typeof r.path === 'string' ? r.path === path : r.path.test(path)));
//     if (!route) throw new Error(`Route not found: ${method} ${path}`);
//
//     const url = `http://test${path}${opts.query ? (path.includes('?') ? '&' : '?') + opts.query : ''}`;
//     const req: any = { method, url, headers: { host: 'test', ...(opts.headers ?? {}) }, body: opts.body };
//     if (opts.scopes) attachAuth(req, { sub: 'tester', scopes: opts.scopes });
//     const res = makeRes();
//     await route.handler(req, res);
//     return res;
// }
//
// // tests/tenant.api.test.ts
// // Run with: npx vitest run tests/tenant.api.test.ts
// import { describe, it, expect } from 'vitest';
// import { exec } from './tenant.harness';
//
// const SCOPE_READ = ['tenant:read'];
// const SCOPE_WRITE = ['tenant:read','tenant:write'];
//
// describe('Tenant API', () => {
//     it('lists tenants (empty)', async () => {
//         const res = await exec('GET', '/api/v1/tenants', { scopes: SCOPE_READ });
//         expect(res.statusCode).toBe(200);
//     });
//
//     it('creates tenant (idempotent)', async () => {
//         const body = { name: 'Acme Inc', slug: 'acme' };
//         const res1 = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body, headers: { 'idempotency-key': 'k1' } });
//         expect(res1.statusCode).toBe(201);
//         const res2 = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body, headers: { 'idempotency-key': 'k1' } });
//         expect(res2.statusCode).toBe(201);
//     });
//
//     it('gets by id with ETag/If-None-Match', async () => {
//         const create = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body: { name: 'Beta', slug: 'beta' } });
//         const id = create.body?.id ?? JSON.parse(JSON.stringify(create.body)).id; // depending on json helper
//         const get1 = await exec('GET', `/api/v1/tenants/${id}`, { scopes: SCOPE_READ });
//         const tag = get1.headers['etag'];
//         const notModified = await exec('GET', `/api/v1/tenants/${id}`, { scopes: SCOPE_READ, headers: { 'if-none-match': tag } });
//         expect(notModified.statusCode).toBe(304);
//     });
//
//     it('updates with If-Match', async () => {
//         const c = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body: { name: 'Gamma', slug: 'gamma' } });
//         const id = (c.body?.id) ?? JSON.parse(JSON.stringify(c.body)).id;
//         const g = await exec('GET', `/api/v1/tenants/${id}`, { scopes: SCOPE_READ });
//         const tag = g.headers['etag'];
//         const u = await exec('PUT', `/api/v1/tenants/${id}`, { scopes: SCOPE_WRITE, body: { name: 'Gamma+', slug: 'gamma' }, headers: { 'if-match': tag } });
//         expect(u.statusCode).toBe(200);
//     });
//
//     it('soft deletes', async () => {
//         const c = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body: { name: 'Delta', slug: 'delta' } });
//         const id = (c.body?.id) ?? JSON.parse(JSON.stringify(c.body)).id;
//         const d = await exec('DELETE', `/api/v1/tenants/${id}`, { scopes: SCOPE_WRITE });
//         expect(d.statusCode).toBe(200);
//     });
// });
//
// // docs/curl-examples.sh
// // Quick smoke tests with curl (adjust host:port)
// # List
// curl -i -H 'x-request-id: demo' -H 'Authorization: Bearer <token-with-tenant:read>' \
//   'http://localhost:3000/api/v1/tenants?limit=10&sort=createdAt&order=desc'
//
// # Create (idempotent)
// curl -i -X POST -H 'Content-Type: application/json' -H 'Idempotency-Key: abc123' \
//   -d '{"name":"Acme","slug":"acme"}' 'http://localhost:3000/api/v1/tenants'
//
// # Get (with conditional)
//     curl -i 'http://localhost:3000/api/v1/tenants/<id>' -H 'If-None-Match: "ten-..."'
//
// # Update (optimistic concurrency)
// curl -i -X PUT -H 'Content-Type: application/json' -H 'If-Match: "ten-..."' \
//   -d '{"name":"Acme+","slug":"acme"}' 'http://localhost:3000/api/v1/tenants/<id>'
//
// # Delete (soft)
// curl -i -X DELETE 'http://localhost:3000/api/v1/tenants/<id>'
