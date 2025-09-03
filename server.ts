// server.ts — starting point for backend server

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

// Logger: pretty console + file sink to storage/framework/log.txt

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

// Boot servers
bootAll({
    providers: [() => registry.collect()],
    host: process.env.APP_HOST || process.env.HOST || "0.0.0.0",
    httpPort: parseInt(process.env.APP_PORT || process.env.PORT || "3006", 10),
    httpsPort: process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT, 10) : undefined,
    cors: true,
    logger,
    middlewares: [
        // Signed cookie session: sid (HttpOnly, SameSite=Lax, Secure on HTTPS), 2h TTL
        createSessionMiddleware({
            signKey: process.env.APP_KEY,
            ttlSeconds: 60 * 60 * 2,
        }),
        // Attach req.tenant (from X-Tenant-Id or derived from X-App-Key/Secret) and persist into session
        tenantMiddleware(),
        // Bind per-request DB context using your Connection facade (req.db)
        dbContextMiddleware(),
    ],
    // sftp: { enable: true }, // enable if you have cortex/framework/sftpx wired + envs
});

// Hardening: surface unexpected errors in logs
process.on("unhandledRejection", (err: any) =>
    logger.error("unhandledRejection", { error: err?.message || String(err) }),
);
process.on("uncaughtException", (err: any) =>
    logger.fatal("uncaughtException", { error: err?.message || String(err) }),
);
