// apps/cxsun/tenant/src/tenant/code/tenant.routes.ts
import { App, RouteConfig } from "../../../../../cortex/framework/application";
import type { RequestContext } from "../../../../../cortex/framework/types";

export default function tenantRoutes(app: App): RouteConfig {
    const logger = app.getLogger();
    return {
        path: "/tenants",
        prefix: "/api",
        // Removed subdomain: "tenants" to allow localhost:3006 requests
        cors: { origin: "*", methods: ["GET", "POST"], headers: ["Content-Type"] },
        middleware: [
            async (ctx: RequestContext, next: () => void) => {
                if (!ctx.user) {
                    logger.error("Unauthorized access attempt", { context: "tenant-routes" });
                    throw new Error("Unauthorized");
                }
                await next();
            },
        ],
        routes: [
            {
                method: "GET",
                path: "/hz",
                name: "tenant.healthz",
                handler: async (ctx: RequestContext) => {
                    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
                },
            },
            {
                method: "GET",
                path: "/:id",
                name: "tenant.show",
                model: { param: "id", resolver: async (id) => ({ id, name: `Tenant ${id}` }) },
                rateLimit: { windowMs: 60000, max: 100 },
                handler: async (ctx: RequestContext) => {
                    return new Response(JSON.stringify(ctx.model), { status: 200, headers: { "Content-Type": "application/json" } });
                },
            },
        ],
        subConfigs: [
            {
                path: "/admin",
                routes: [
                    {
                        method: "GET",
                        path: "/users",
                        name: "tenant.admin.users",
                        handler: async () => {
                            return new Response(JSON.stringify({ users: [] }), {
                                status: 200,
                                headers: { "Content-Type": "application/json" },
                            });
                        },
                    },
                ],
            },
        ],
    };
}