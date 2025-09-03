// server.ts — entrypoint: env config ▸ route registry ▸ base routes ▸ boot servers with unified logger (file or JSON)

import "dotenv/config";
import fs from "fs";
import path from "path";

import { RouteRegistry } from "./cortex/http/route_registry";
import { bootAllFromRegistry } from "./cortex/http/serve_all";
import { registerApps } from "./cortex/main";
import { welcome } from "./cortex/http/routes/welcome";
import { healthz } from "./cortex/http/routes/health";

// ✅ Unified logger — no DB store, file/JSON switch via env or options
import { createServerLogger } from "./cortex/log/logger";

function int(v: string | undefined, def: number) {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : def;
}
function bool(v: string | undefined, def = false) {
    if (v == null) return def;
    return /^(1|true|yes|on)$/i.test(v);
}

async function main() {
    const HOST = process.env.APP_HOST || process.env.HOST || "localhost";
    const PORT = int(process.env.APP_PORT || process.env.PORT, 3006);

    // Ensure log dir exists per requirement: storage/framework/log.txt
    const LOG_DIR = path.resolve("storage/framework");
    const LOG_PATH = path.join(LOG_DIR, "log.txt");
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const registry = new RouteRegistry();

    // Base routes so backend is visible without a frontend
    registry.addRoutes([
        welcome(process.env.APP_NAME || "CodexSun"),
        healthz("/healthz"),
    ]);

    // App routes
    await registerApps(registry);

    // Logger switches
    const LOG_LEVEL = (process.env.LOG_LEVEL || (bool(process.env.APP_DEBUG, false) ? "debug" : "info")) as
        | "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    const LOG_EMOJI = bool(process.env.LOG_EMOJI, true);
    const LOG_FORMAT = (process.env.LOG_FORMAT === "json" ? "json" : "text"); // console layout
    const LOG_FILE_FORMAT = (process.env.LOG_FILE_FORMAT === "json" ? "json" : "text"); // file layout

    const logger = createServerLogger({
        level: LOG_LEVEL,
        layout: LOG_FORMAT,
        emoji: LOG_EMOJI,
        console: true,
        file: { path: LOG_PATH, format: LOG_FILE_FORMAT },
        context: {
            app: process.env.APP_NAME || "CodexSun",
            version: process.env.APP_VERSION || "1.0.0",
        },
    });

    await bootAllFromRegistry(registry, {
        host: HOST,
        httpPort: PORT,
        httpsPort: int(process.env.HTTPS_PORT, 3443),
        tlsKeyPath: process.env.TLS_KEY || "server.key",
        tlsCertPath: process.env.TLS_CERT || "server.crt",
        tlsCaPath: process.env.TLS_CA,
        // CORS: off if CORS=off or CORS_DISABLE=1; otherwise enabled with defaults
        cors: !(process.env.CORS?.toLowerCase() === "off" || process.env.CORS_DISABLE === "1"),
        // SFTP support
        sftp: {
            enable: bool(process.env.SFTP_ENABLE, true),
            port: int(process.env.SFTP_PORT, 2022),
            hostKeyPath: process.env.SSH_HOST_KEY || "ssh_host_ed25519_key",
            rootDir: process.env.SFTP_ROOT || "sftp-root",
            users: [
                {
                    username: process.env.SFTP_USER || "demo",
                    password: process.env.SFTP_PASS || "demo",
                },
            ],
        },
        logger,
    });

    // Emit a first access-style line in the new bracketed layout
    logger.access({
        ts: new Date().toISOString(),
        method: "BOOT",
        url: "",
        path: "/",
        status: 200,
        duration_ms: 0,
        bytes: 0,
        ip: undefined,
        request_id: "boot",
        user_agent: "",
        referer: "",
    });

    logger.success(`Server up at http://${HOST}:${PORT}`);
}

main().catch((err) => {
    // Hard print as ultimate fallback
    // eslint-disable-next-line no-console
    console.error("Fatal startup error", err);
    process.exit(1);
});
