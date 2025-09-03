// apps/cxsun/app.ts
import type { RouteRegistry } from '../../cortex/http/route_registry';
import { tenantRouteProvider } from './src/tenant/code/tenant.api';

export async function registerApp(registry: RouteRegistry) {
    // mount tenant API via route provider
    registry.addProvider(tenantRouteProvider);
    // You can add more providers here per app feature
}
