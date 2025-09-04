
// apps/cxsun/src/tenant/code/tenant.service.ts
import type { ListOptions, Tenant } from './tenant.types';
import { TenantController, makeEtag } from './tenant.controller';

export class TenantService {
    private controller: TenantController;

    constructor(private namespace: string) {
        this.controller = new TenantController(namespace);
    }

    async init(): Promise<void> { await this.controller.init(); }

    // Keep signature compatible with tenant.api
    async list(limit: number, offset: number, q?: string, opts?: ListOptions): Promise<{ items: Tenant[]; total: number; nextCursor?: string }>{
        return this.controller.list(limit, offset, q, opts);
    }

    async get(id: string): Promise<Tenant | null> { return this.controller.get(id); }

    async create(payload: { name: string; slug: string; meta?: Record<string, any> }, opts?: { idempotencyKey?: string }): Promise<Tenant> {
        // normalize
        const data = { ...payload, name: payload.name.trim(), slug: payload.slug.trim().toLowerCase() };
        return this.controller.create(data, opts);
    }

    async update(id: string, payload: { name: string; slug: string; meta?: Record<string, any> }, opts?: { expectedEtag?: string }): Promise<Tenant | null> {
        const data = { ...payload, name: payload.name.trim(), slug: payload.slug.trim().toLowerCase() };
        return this.controller.update(id, data, opts);
    }

    async remove(id: string): Promise<boolean> { return this.controller.remove(id); }

    async health(id: string): Promise<{ ok: boolean; tenant?: string }> { return this.controller.health(id); }

    // Event bus hook (no-op by default). API calls emit through this.
    async emit(type: string, payload: any): Promise<void> {
        // Replace with your event bus
        // e.g., await this.bus.publish(`tenant.${type}`, payload)
        void type; void payload; return;
    }

    // Expose an etag builder for external uses if needed
    etag(t: Tenant) { return makeEtag(t); }
}
