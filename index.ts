// index.ts (server.ts)

import "dotenv/config";
import path from "node:path";

import { fileURLToPath, pathToFileURL } from "url";
import { dirname } from "path";

// ---- 1) Define & globalize __filename / __dirname BEFORE loading anything else
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
Object.assign(globalThis as any, { __filename, __dirname });

import { createLogger } from "./cortex/log/logger";
import { bootAll } from "./cortex/http/serve_all";
import { registerApps } from "./cortex/main";
import { RouteRegistry, RouteConfig } from "./cortex/framework/route-registry";
import { Container } from "./cortex/framework/container";
import { createSessionMiddleware } from "./cortex/http/middleware/session";
import { tenantMiddleware } from "./cortex/http/middleware/tenant";
import { dbContextMiddleware } from "./cortex/http/middleware/db_context";
import * as welcome from "./cortex/http/routes/welcome";
import * as health from "./cortex/http/routes/health";
import { initDb } from "./cortex/database/db";
import type { RouteDef, Handler, Middleware, RequestExtras } from "./cortex/http/chttpx";
import type { RequestContext } from "./cortex/framework/types";
import { IncomingMessage, ServerResponse } from "http";

// Utility to convert RouteConfig to RouteDef
function toRouteDefs(configs: RouteConfig[], container: Container): RouteDef[] {
    const routeDefs: RouteDef[] = [];

    function processConfig(config: RouteConfig, prefix: string = "") {
        const basePath = prefix + (config.prefix ? config.prefix + config.path : config.path);

        // Convert RouteConfig routes to RouteDef
        for (const route of config.routes) {
            const fullPath = route.path ? basePath + route.path : basePath;
            const routeDef: RouteDef = {
                method: route.method,
                path: fullPath,
                name: route.name,
                handler: async (req: IncomingMessage & Partial<RequestExtras>, res: ServerResponse) => {
                    // Adapt RequestContext to IncomingMessage & RequestExtras
                    const ctx: RequestContext = {
                        di: container,
                        params: req.params || {},
                        model: route.model ? await route.model.resolver(req.params?.[route.model.param] || "") : undefined,
                        user: req.session?.user,
                        session: req.session, // Ensure session is passed
                        tenant: req.tenant,   // Ensure tenant is passed
                    };
                    const response = await route.handler!(ctx);
                    res.statusCode = response.status;
                    for (const [key, value] of Object.entries(response.headers || {})) {
                        res.setHeader(key, value);
                    }
                    res.end(await response.text());
                },
                middlewares: [
                    ...(config.middleware || []).map((mw) => async (req: IncomingMessage & Partial<RequestExtras>, res: ServerResponse, next: () => void) => {
                        const ctx: RequestContext = {
                            di: container,
                            params: req.params || {},
                            model: route.model ? await route.model.resolver(req.params?.[route.model.param] || "") : undefined,
                            user: req.session?.user,
                            session: req.session, // Ensure session is passed
                            tenant: req.tenant,   // Ensure tenant is passed
                        };
                        await mw(ctx, next);
                    }),
                    ...(route.middleware || []).map((mw) => async (req: IncomingMessage & Partial<RequestExtras>, res: ServerResponse, next: () => void) => {
                        const ctx: RequestContext = {
                            di: container,
                            params: req.params || {},
                            model: route.model ? await route.model.resolver(req.params?.[route.model.param] || "") : undefined,
                            user: req.session?.user,
                            session: req.session, // Ensure session is passed
                            tenant: req.tenant,   // Ensure tenant is passed
                        };
                        await mw(ctx, next);
                    }),
                ],
            };
            routeDefs.push(routeDef);
        }

        // Process subConfigs
        if (config.subConfigs) {
            for (const subConfig of config.subConfigs) {
                processConfig(subConfig, basePath);
            }
        }
    }

    for (const config of configs) {
        processConfig(config);
    }
    return routeDefs;
}

const logger = createLogger({
    file: {
        path: process.env.LOG_FILE_PATH || path.resolve(process.cwd(), "storage", "framework", "log.txt"),
        append: true,
        format: process.env.LOG_FILE_FORMAT === "json" ? "json" : "text",
    },
});

async function main() {
    try {
        // Initialize master DB
        await initDb();
        logger.info("✅ Master DB initialized and core schema ready");

        // Initialize container and register logger
        const container = new Container();
        container.register("logger", { type: "singleton", value: logger });

        // Load apps and get App instance
        const app = await registerApps(container);

        // Register welcome and health routes via App
        const welcomeConfig = (await import("./cortex/http/routes/welcome")).default(app);
        const healthConfig = (await import("./cortex/http/routes/health")).default(app);
        await app.registerRouteModule(welcomeConfig);
        // await app.registerRouteModule(health);

        // Boot servers
        await bootAll({
            providers: [() => toRouteDefs(app.getRegistry().collect({ di: container }), container)],
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