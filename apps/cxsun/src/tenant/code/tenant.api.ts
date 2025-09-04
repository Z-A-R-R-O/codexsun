import { Router } from "../../../../../cortex/http/route";
import { TenantController } from "./tenant.controller";

export function tenantRoutes() {
    const route = new Router();
    const ctx = new TenantController();

    route.get("/api/tenants", ctx.index).named("tenants");

    return route.all();
}
