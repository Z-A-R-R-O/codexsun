import "dotenv/config";
import path from "node:path";
import { createServerLogger } from "./cortex/log/logger";
import { bootAll } from "./cortex/http/serve_all";
import { RouteRegistery } from "./cortex/http/route_registery";

import { createSessionMiddleware } from "./cortex/http/middleware/session";
import { tenantMiddleware } from "./cortex/http/middleware/tenant";
import { dbContextMiddleware } from "./cortex/http/middleware/db_context";

import * as welcome from "./cortex/http/routes/welcome";
import * as health from "./cortex/http/routes/health";
import { initDb } from "./cortex/database/db";
import tenantRouteProvider from "./apps/cxsun/src/tenant/code/tenant.api"; // ✅ use initDb

const logger = createServerLogger({
file: {
path: process.env.LOG_FILE_PATH || path.resolve(process.cwd(), "storage", "framework", "log.txt"),
append: true,
format: process.env.LOG_FILE_FORMAT === "json" ? "json" : "text",
},
});

// Register routes
const registry = new RouteRegistery();
registry.addProvider(welcome.routes);
registry.addProvider(health.routes);
registry.addProvider(tenantRouteProvider);

async function main() {
try {
// ✅ Initialize master DB
await initDb();
logger.info("✅ Master DB initialized and core schema ready");




        // Wrapper: call tenantRouteProvider and inject a debug route alongside
        const wrappedTenantProvider = async () => {
            const routes = await tenantRouteProvider();  // ← if this throws or returns empty we’ll know
            return [
                // Debug route to prove this provider is active:
                {
                    method: "GET",
                    path: "/api/tenants/_wrap",
                    handler: async (_req, res) => {
                        res.statusCode = 200;
                        res.setHeader("Content-Type", "application/json; charset=utf-8");
                        res.end(JSON.stringify({ ok: true, from: "wrappedTenantProvider" }));
                    },
                },
                ...routes,
            ];
        };



        // Boot servers
        await bootAll({
            // providers: [() => registry.collect()],


            providers: [
                // 🔧 Inline test route: bypasses registry & app loader
                () => [{
                    method: 'GET',
                    path: '/api/_app_ping',
                    handler: async (_req, res) => {
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify({ ok: true, from: 'index.ts/providers[]' }));
                    },
                }],

                // your tenant provider (keep this)
                tenantRouteProvider,


                // ✅ use the wrapped tenant provider
                wrappedTenantProvider,

                // anything collected via RouteRegistery (welcome, health, app.ts, etc.)
                () => registry.collect(),
            ],




            host: process.env.APP_HOST || process.env.HOST || "0.0.0.0",
            httpPort: parseInt(process.env.APP_PORT || process.env.PORT || "3006", 10),
            httpsPort: process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT, 10) : undefined,
            cors: true,
            logger,
            middlewares: [
                createSessionMiddleware({
                    signKey: process.env.APP_KEY,
                    ttlSeconds: 60 * 60 * 2,
                }),
                tenantMiddleware(),
                dbContextMiddleware(),
            ],
        });
    } catch (err: any) {
        logger.fatal("❌ Server startup failed", { error: err.message || String(err) });
        process.exit(1);
    }
}

// Hardening
process.on("unhandledRejection", (err: any) =>
logger.error("unhandledRejection", { error: err?.message || String(err) }),
);
process.on("uncaughtException", (err: any) =>
logger.fatal("uncaughtException", { error: err?.message || String(err) }),
);

main();
