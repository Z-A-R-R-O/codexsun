// apps/cxsun/src/tenant/code/tenant.controller.ts
import crypto from 'node:crypto';
import type { Tenant, ListOptions } from './tenant.types';

// In-memory store (namespaced). Swap with DB easily.
const STORE = new Map<string, Map<string, Tenant>>(); // namespace -> (id -> tenant)
const IDEMPO = new Map<string, Map<string, string>>(); // namespace -> (idempotencyKey -> tenantId)

function b64(s: string) { return Buffer.from(s, 'utf8').toString('base64url'); }
function unb64(s: string) { return Buffer.from(s, 'base64url').toString('utf8'); }

export function makeEtag(item: Pick<Tenant, 'id' | 'updatedAt' | 'version'>): string {
    const h = crypto.createHash('sha1').update(`${item.id}:${item.updatedAt}:${item.version}`).digest('hex').slice(0, 16);
    return `"ten-${h}"`;
}

export class TenantController {
    constructor(private namespace: string) {}

    async init(): Promise<void> {
        if (!STORE.has(this.namespace)) STORE.set(this.namespace, new Map());
        if (!IDEMPO.has(this.namespace)) IDEMPO.set(this.namespace, new Map());
    }

    /** Full-text-ish filter */
    private matches(t: Tenant, q?: string): boolean {
        if (!q) return true;
        const needle = q.toLowerCase();
        return (
            t.name.toLowerCase().includes(needle) ||
            t.slug.toLowerCase().includes(needle) ||
            JSON.stringify(t.meta ?? {}).toLowerCase().includes(needle)
        );
    }

    private sorters = {
        createdAt: (a: Tenant, b: Tenant) => a.createdAt - b.createdAt,
        name: (a: Tenant, b: Tenant) => a.name.localeCompare(b.name)
    } as const;

    async list(limit: number, offset: number, q?: string, opts: ListOptions = {}): Promise<{ items: Tenant[]; total: number; nextCursor?: string }>{
        const db = STORE.get(this.namespace)!;
        let items = Array.from(db.values());
        if (!opts.includeDeleted) items = items.filter(t => !t.deletedAt);
        items = items.filter(t => this.matches(t, q));

        const sortKey = opts.sort ?? 'createdAt';
        const order = opts.order ?? 'desc';
        items.sort(this.sorters[sortKey]);
        if (order === 'desc') items.reverse();

        const total = items.length;

        if (opts.cursor) {
            // cursor is base64(index)
            const start = Math.max(0, parseInt(unb64(opts.cursor), 10) || 0);
            const slice = items.slice(start, start + limit);
            const nextIdx = start + limit;
            const nextCursor = nextIdx < total ? b64(String(nextIdx)) : undefined;
            return { items: slice, total, ...(nextCursor ? { nextCursor } : {}) };
        }

        const slice = items.slice(offset, offset + limit);
        return { items: slice, total };
    }

    async get(id: string): Promise<Tenant | null> {
        const db = STORE.get(this.namespace)!;
        return db.get(id) ?? null;
    }

    async getBySlug(slug: string): Promise<Tenant | null> {
        const db = STORE.get(this.namespace)!;
        for (const t of db.values()) if (t.slug === slug) return t;
        return null;
    }

    async create(data: { name: string; slug: string; meta?: Record<string, any> }, opts: { idempotencyKey?: string } = {}): Promise<Tenant> {
        const db = STORE.get(this.namespace)!;
        const idempot = IDEMPO.get(this.namespace)!;

        if (opts.idempotencyKey) {
            const priorId = idempot.get(opts.idempotencyKey);
            if (priorId) {
                const prior = db.get(priorId);
                if (prior) return prior; // idempotent replay
            }
        }

        // uniqueness on slug
        if (await this.getBySlug(data.slug)) {
            throw new Error('slug must be unique');
        }

        const now = Date.now();
        const id = crypto.randomUUID();
        const doc: Tenant = {
            id,
            name: data.name,
            slug: data.slug,
            meta: data.meta ?? {},
            createdAt: now,
            updatedAt: now,
            version: 1,
        };
        db.set(id, doc);

        if (opts.idempotencyKey) idempot.set(opts.idempotencyKey, id);
        return doc;
    }

    async update(id: string, data: { name: string; slug: string; meta?: Record<string, any> }, opts: { expectedEtag?: string } = {}): Promise<Tenant | null> {
        const db = STORE.get(this.namespace)!;
        const existing = db.get(id);
        if (!existing || existing.deletedAt) return null;

        if (opts.expectedEtag) {
            const currentTag = makeEtag(existing);
            if (currentTag !== opts.expectedEtag) {
                const err: any = new Error('etag_mismatch');
                err.status = 412; // Precondition Failed
                throw err;
            }
        }

        // slug uniqueness (excluding current)
        if (data.slug && data.slug !== existing.slug) {
            const dup = await this.getBySlug(data.slug);
            if (dup && dup.id !== id) throw new Error('slug must be unique');
        }

        existing.name = data.name ?? existing.name;
        existing.slug = data.slug ?? existing.slug;
        existing.meta = (typeof data.meta === 'object' && data.meta !== null) ? data.meta : existing.meta;
        existing.updatedAt = Date.now();
        existing.version += 1;
        db.set(id, existing);
        return existing;
    }

    async remove(id: string): Promise<boolean> {
        const db = STORE.get(this.namespace)!;
        const t = db.get(id);
        if (!t || t.deletedAt) return false;
        t.deletedAt = Date.now();
        t.updatedAt = t.deletedAt;
        t.version += 1;
        db.set(id, t);
        return true;
    }

    async health(id: string): Promise<{ ok: boolean; tenant?: string }> {
        const t = await this.get(id);
        return { ok: !!t, tenant: t?.slug };
    }
}
