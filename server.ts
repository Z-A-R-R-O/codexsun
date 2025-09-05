// server.ts

import "dotenv/config";
import path from "node:path";
import { createLogger  } from "./cortex/log/logger";
import { bootAll } from "./cortex/http/serve_all";
import { registerApps } from "./cortex/main";
import { RouteRegistery } from "./cortex/http/route_registery";

import { createSessionMiddleware } from "./cortex/http/middleware/session";
import { tenantMiddleware } from "./cortex/http/middleware/tenant";
import { dbContextMiddleware } from "./cortex/http/middleware/db_context";

import * as welcome from "./cortex/http/routes/welcome";
import * as health from "./cortex/http/routes/health";
import { initDb } from "./cortex/database/db"; // ✅ use initDb

const logger = createLogger ({
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

async function main() {
    try {
        // ✅ Initialize master DB
        await initDb();
        logger.info("✅ Master DB initialized and core schema ready");

        // 3) load all apps discovered by cortex/main.ts
        // await registerApps(registry);

        // Boot servers
        await bootAll({
            providers: [() => registry.collect()],
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
