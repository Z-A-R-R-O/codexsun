// apps/cxsun/src/tenant/code/tenant.api.ts

import type { RouteDef } from '../../../../../cortex/http/chttpx';
// import { json } from '../../../../../cortex/http/chttpx';
import { routes as healthRoutes } from '../../../../../cortex/http/routes/health';
import { TenantService } from './tenant.service';

// Provider for serve_all
export async function tenantRouteProvider(): Promise<RouteDef[]> {
    const svc = new TenantService('default');
    await svc.init();

    return [
        // Health for tenant API (remap global /healthz -> /api/tenants/healthz)
        ...healthRoutes().map(r => ({ ...r, path: '/api/tenants/healthz' })),


// ---- GET: list tenants ----
        {
            method: 'GET',
            path: /^\/api\/tenants\/?$/,
            handler: async (_req, res) => {
                // Call whichever method actually exists
                let rows: unknown = [];
                if (typeof (svc as any).list === 'function') {
                    rows = await (svc as any).list();
                } else if (typeof (svc as any).getAll === 'function') {
                    rows = await (svc as any).getAll();
                }

                // Normalize rows to an array if your service returns { items, total }
                const data = Array.isArray(rows) ? rows : ((rows as any)?.items ?? []);

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: true, data }));
                // no `return` and no `await` needed
            }
        }





    ];
}
