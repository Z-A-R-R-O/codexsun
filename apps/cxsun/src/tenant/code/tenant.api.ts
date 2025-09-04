// apps/cxsun/src/tenant/code/tenant.api.ts
import type { RouteDef } from '../../../../../cortex/http/chttpx';
import { json } from '../../../../../cortex/http/chttpx';
import { routes as healthRoutes } from '../../../../../cortex/http/routes/health';
import { TenantService } from './tenant.service';

export async function tenantRouteProvider(): Promise<RouteDef[]> {
    const svc = new TenantService('default');
    await svc.init();

    return [
        // Health under tenant namespace — TEMP: obvious reply
        {
            method: 'GET',
            path: /^\/api\/tenants\/healthz$/,
            handler: async (_req, res) => {
                json(res, { message: '✅ tenant health handler reached' }, 200);
            }
        },

        // List — accept optional trailing slash — TEMP: obvious reply
        {
            method: 'GET',
            path: /^\/api\/tenants\/?$/,
            handler: async (_req, res) => {
                json(res, { message: '✅ tenant list handler reached' }, 200);
            }
        },

        // (leave the remaining CRUD as-is for now)
    ];
}

export default tenantRouteProvider;
