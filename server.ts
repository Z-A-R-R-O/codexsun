// server.ts — minimal entry: env config, registry, base routes, boot with logger
import "dotenv/config";
import { RouteRegistry } from "./cortex/http/route_registry";
import { bootAllFromRegistry } from "./cortex/http/serve_all";
import { registerApps } from "./cortex/main";
import { makeWelcomeRoute, makeHealthRoute } from "./cortex/http/chttpx";
import { createConsoleJsonLogger } from "./cortex/http/logger";
// Optional DB log sink (keep if you already have it)
import { createDbLogStore } from "./cortex/http/log_store"; // or comment out if not using

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

    const registry = new RouteRegistry();

    // base routes so backend is visible without a frontend
    registry.addRoutes([
        makeWelcomeRoute(process.env.APP_NAME || "CodexSun"),
        makeHealthRoute("/healthz"),
    ]);

    // app routes
    await registerApps(registry);

    // logger (console JSON) + optional DB log store
    const logger = createConsoleJsonLogger();
    const logStore = createDbLogStore?.(); // if you have it; else remove

    await bootAllFromRegistry(registry, {
        host: HOST,
        httpPort: PORT,
        httpsPort: int(process.env.HTTPS_PORT, 3443),
        tlsKeyPath: process.env.TLS_KEY || "server.key",
        tlsCertPath: process.env.TLS_CERT || "server.crt",
        tlsCaPath: process.env.TLS_CA,
        cors: process.env.CORS?.toLowerCase() === "off" || process.env.CORS_DISABLE === "1" ? false : true,
        sftp: {
            enable: bool(process.env.SFTP_ENABLE, true),
            port: int(process.env.SFTP_PORT, 2022),
            hostKeyPath: process.env.SSH_HOST_KEY || "ssh_host_ed25519_key",
            rootDir: process.env.SFTP_ROOT || "sftp-root",
            users: [{ username: process.env.SFTP_USER || "demo", password: process.env.SFTP_PASS || "demo" }],
        },
        logger,
        logStore,
    });

    logger.access?.({
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
    console.log(`✅ Server up at http://${HOST}:${PORT}`);
}

main().catch((err) => {
    console.error("Fatal startup error", err);
    process.exit(1);
});
