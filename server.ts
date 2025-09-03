// server.ts — bare Node entry (replaces Fastify), with env, CLI, logger, and serve_all wiring
import "dotenv/config";
import { RouteRegistry } from "./cortex/http/route_registry";
import { bootAllFromRegistry, type BootOptions } from "./cortex/http/serve_all";
import { registerApps } from "./cortex/main";

// ---- helpers ----
const envBool = (v?: string, def = false) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v));
const envInt  = (v?: string, def = 0) => { const n = v ? parseInt(v, 10) : NaN; return Number.isFinite(n) ? n : def; };

async function resolveHostPort() {
    // Prefer project settings if available; fallback to env
    try {
        const { getAppHost, getAppPort } = await import("./cortex/settings/get_settings");
        return { host: getAppHost(), port: getAppPort() };
    } catch {
        return { host: process.env.HOST || "0.0.0.0", port: envInt(process.env.PORT, 3000) };
    }
}

async function getLogger() {
    try {
        const mod: any = await import("./cortex/utils/server-logger");
        const Logger = mod.ServerLogger ?? class { info=console.log; warn=console.warn; error=console.error; debug=console.debug; };
        const inst = new Logger();
        return { log: inst, format: mod.formatServerLog as ((...a:any[])=>string)|undefined };
    } catch {
        return { log: console, format: undefined };
    }
}

async function startCli(registry: RouteRegistry) {
    try {
        const { runCli } = await import("./cortex/cli/index");
        process.stdin.setEncoding("utf8");
        console.log("💻 CLI ready. Type `help`.");
        process.stdin.on("data", async (chunk: string) => {
            const input = String(chunk).trim();
            if (!input) return;
            const args = input.split(/\s+/);
            try { await runCli(args, registry); } catch (err) { console.error("CLI error:", err); }
        });
    } catch {
        // CLI is optional; ignore if not present
    }
}

async function main() {
    const { host, port } = await resolveHostPort();
    const { log } = await getLogger();

    // HTTP/HTTPS/SFTP ports & TLS from env
    const httpPort   = envInt(process.env.HTTP_PORT || String(port), port);
    const httpsPort  = envInt(process.env.HTTPS_PORT, 3443);
    const enableSftp = envBool(process.env.SFTP_ENABLE, true);

    const opts: Omit<BootOptions, "providers"> = {
        httpPort,
        httpsPort,
        tlsKeyPath: process.env.TLS_KEY  || "server.key",
        tlsCertPath: process.env.TLS_CERT || "server.crt",
        tlsCaPath:   process.env.TLS_CA,
        sftp: {
            enable: enableSftp,
            port: envInt(process.env.SFTP_PORT, 2022),
            hostKeyPath: process.env.SSH_HOST_KEY || "ssh_host_ed25519_key",
            rootDir: process.env.SFTP_ROOT || "sftp-root",
            users: [{ username: process.env.SFTP_USER || "demo", password: process.env.SFTP_PASS || "demo" }],
        },
    };

    // Collect routes via registry -> apps -> tenant.api providers
    const registry = new RouteRegistry();

    // Prefer local ./main; fallback to legacy ./cortex/main if needed
    try {
        await registerApps(registry);
    } catch {
        const legacy = await import("./cortex/main");
        if (typeof (legacy as any).registerApps === "function") {
            await (legacy as any).registerApps(registry);
        } else {
            throw new Error("registerApps not found in ./main or ./cortex/main");
        }
    }

    log.info?.(
        `[boot] host:${host} HTTP:${httpPort} HTTPS:${httpsPort} SFTP:${enableSftp ? (process.env.SFTP_PORT || 2022) : "off"}`
    );

    await bootAllFromRegistry(registry, opts); // starts HTTP, HTTPS (if certs), and SFTP

    await startCli(registry);
}

main().catch((err) => {
    console.error("Fatal startup error", err);
    process.exit(1);
});
