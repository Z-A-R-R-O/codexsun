// apps/cxsun/app.ts
import type { RouteRegistery } from '../../cortex/http/route_registery';
import { tenantRouteProvider } from './src/tenant/code/tenant.api';

export async function registerApp(registry: RouteRegistery) {
    // mount tenant API via route provider
    registry.addProvider(tenantRouteProvider);
    // You can add more providers here per app feature
}
