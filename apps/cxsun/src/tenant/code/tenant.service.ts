// apps/cxsun/src/tenant/code/tenant.service.ts
import type { Tenant } from './tenant.types';

export class TenantService {
    constructor(private namespace: string) {}

    async init(): Promise<void> {
        // e.g., connect to store based on this.namespace
    }

    async list(
        _filter: Record<string, unknown> = {},
        _opts: { limit?: number; cursor?: string } = {}
    ): Promise<{ items: Tenant[]; total: number; nextCursor?: string }> {
        // TODO: plug in real data source. For now, return empty typed payload.
        return { items: [], total: 0 };
    }
}
