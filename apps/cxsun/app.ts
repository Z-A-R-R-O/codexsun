import type { RouteRegistery, RouteProvider } from '../../cortex/http/route_registery';
import { tenantRoutes} from './src/tenant/code/tenant.routes';

export async function registerApp(registry: RouteRegistery) {
    registry.addProvider(tenantRoutes);
}









// import type { RouteRegistery, RouteProvider } from '../../cortex/http/route_registery';
// import { tenantRoutes} from './src/tenant/code/tenant.api';
// // import { json } from '../../cortex/http/chttpx';
//
// // Simple test provider to verify this app is mounted correctly
// // const testRouteProvider: RouteProvider = () => [
// //     {
// //         method: 'GET',
// //         path: '/api/_app_ping', // exact match (chttpx matches strings or RegExp only)
// //         handler: async (_req, res) => {
// //             json(res, { ok: true, app: 'cxsun', from: 'apps/cxsun/app.ts' }, 200);
// //         },
// //     },
// // ];
//
// export async function registerApp(registry: RouteRegistery) {
//     // 1) Add a test route to confirm this app is being loaded
//     // registry.addProvider(testRouteProvider);
//
//     // 2) Mount the tenant API route provider (/api/tenants, /api/tenants/healthz, etc.)
//     registry.addProvider(tenantRoutes);
// }