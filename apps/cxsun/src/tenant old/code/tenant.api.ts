// apps/cxsun/src/tenant/code/tenant.api.ts
import type {RouteDef} from '../../../../../cortex/http/chttpx';
import {makeHealthRoute} from '../../../../../cortex/http/chttpx';
import {TenantService} from './tenant.service';

// Provider for serve_all

export async function tenantRouteProvider(): Promise<RouteDef[]> {
    const svc = new TenantService('default');
    await svc.init();

    return [
        // Health for tenant API
        makeHealthRoute('/api/tenants/healthz'),

        // List tenants
        {
            method: 'GET',
            path: '/api/tenants',
            handler: async ({query}) => {
                const limit = query?.limit ? parseInt(String(query.limit), 10) : 50;
                const offset = query?.offset ? parseInt(String(query.offset), 10) : 0;
                const q = typeof query?.q === 'string' ? query.q : undefined;
                const items = await svc.list(limit, offset, q);
                return {status: 200, body: {items, limit, offset}};
            }
        },

        // Get by id
        {
            method: 'GET',
            path: '/api/tenants/:id',
            handler: async ({params}) => {
                const item = await svc.get((params as any).id);
                return item ? {status: 200, body: item} : {status: 404, body: {error: 'Not found'}};
            }
        },

        // Create
        {
            method: 'POST',
            path: '/api/tenants',
            handler: async ({body}) => {
                try {
                    const created = await svc.create(body as any);
                    return {status: 201, body: created};
                } catch (e: any) {
                    return {status: 400, body: {error: String(e?.message ?? e)}};
                }
            }
        },

        // Update
        {
            method: 'PUT',
            path: '/api/tenants/:id',
            handler: async ({params, body}) => {
                try {
                    const updated = await svc.update((params as any).id, body as any);
                    return updated ? {status: 200, body: updated} : {status: 404, body: {error: 'Not found'}};
                } catch (e: any) {
                    return {status: 400, body: {error: String(e?.message ?? e)}};
                }
            }
        },

        // Delete
        {
            method: 'DELETE',
            path: '/api/tenants/:id',
            handler: async ({params}) => {
                const ok = await svc.remove((params as any).id);
                return ok ? {status: 200, body: {ok: true}} : {status: 404, body: {error: 'Not found'}};
            }
        }
    ];
}

export default tenantRouteProvider;
