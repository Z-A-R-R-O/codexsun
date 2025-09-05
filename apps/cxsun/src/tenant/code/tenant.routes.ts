// apps/cxsun/tenant/src/tenant/code/tenant.routes.ts
import { App } from "../../../../../cortex/framework/application";

export default function tenantRoutes(app: App) {
    const logger = app.getLogger();
    return {
        path: "/tenants",
        prefix: "/api",
        subdomain: "tenants",
        cors: { origin: "*", methods: ["GET", "POST"], headers: ["Content-Type"] },
        middleware: [
            async (req, res, next) => { if (!req.user) throw new Error("Unauthorized"); next(); },
            async (req, res, next) => { res.headers = { ...res.headers, "Access-Control-Allow-Origin": "*" }; next(); },
        ],
        routes: [
            {
                method: "GET",
                path: "/:id",
                name: "tenant.show",
                model: { param: "id", resolver: async (id) => ({ id, name: `Tenant ${id}` }) },
                rateLimit: { windowMs: 60000, max: 100 },
                handler: async (req) => ({ status: 200, body: req.model }),
            },
        ],
        subConfigs: [
            {
                path: "/admin",
                routes: [{ method: "GET", path: "/users", name: "tenant.admin.users", handler: async () => ({ status: 200, body: { users: [] } }) }],
            },
        ],
    };
}