// server.ts — bare Node entry with env, CLI, and structured logger
import "dotenv/config";
import { RouteRegistry } from "./cortex/http/route_registry";
import { bootAllFromRegistry, type BootOptions } from "./cortex/http/serve_all";

// Prefer local main; fall back to cortex/main if needed
async function loadRegisterApps() {
    try {
        const { registerApps } = await import("./cortex/main");
        return registerApps;
    } catch {
        const legacy = await import("./cortex/main");
        if (typeof (legacy as any).registerApps === "function") {
            return (legacy as any).registerApps;
        }
        throw new Error("registerApps not found in ./main or ./cortex/main");
    }
}

const envBool = (v?: string, def = false) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v));
const envInt  = (v?: string, def = 0) => { const n = v ? parseInt(v, 10) : NaN; return Number.isFinite(n) ? n : def; };

// Optional project logger (cortex/utils/server-logger)
async function getLogger() {
    try {
        const mod: any = await import("./cortex/utils/server-logger");
        const Logger = mod.ServerLogger ?? class { info=console.log; warn=console.warn; error=console.error; debug=console.debug; };
        const inst = new Logger();
        const format = mod.formatServerLog as ((...a: any[]) => string) | undefined;
        return { log: inst, format };
    } catch {
        return { log: console as any, format: undefined };
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
        // CLI optional
    }
}

async function main() {
    const { log, format } = await getLogger();
    const registerApps = await loadRegisterApps();

    // Host/ports
    const host = process.env.HOST || "localhost";
    const port = envInt(process.env.PORT, 3000);
    const httpPort   = envInt(process.env.HTTP_PORT || String(port), port);
    const httpsPort  = envInt(process.env.HTTPS_PORT, 3443);
    const enableSftp = envBool(process.env.SFTP_ENABLE, true);

    // Build BootOptions with logger
    const opts: Omit<BootOptions, "providers"> = {
        httpPort,
        httpsPort,
        tlsKeyPath: process.env.TLS_KEY  || "server.key",
        tlsCertPath: process.env.TLS_CERT || "server.crt",
        tlsCaPath:   process.env.TLS_CA,
        cors: true, // use ENV from cors.ts by default; true = permissive fallback
        sftp: {
            enable: enableSftp,
            port: envInt(process.env.SFTP_PORT, 2022),
            hostKeyPath: process.env.SSH_HOST_KEY || "ssh_host_ed25519_key",
            rootDir: process.env.SFTP_ROOT || "sftp-root",
            users: [{ username: process.env.SFTP_USER || "demo", password: process.env.SFTP_PASS || "demo" }],
        },
        logger: {
            access: (r) => {
                const size = r.bytes < 1024 ? `${r.bytes}B` : `${(r.bytes / 1024).toFixed(1)}KB`;
                const line = `[access] ${r.status} ${r.method} ${r.path} ${r.duration_ms}ms ${size} id=${r.request_id} ip=${r.ip ?? "-"}`;
                if (format) {
                    // If your formatter expects objects, adapt here
                    log.info?.(format("access", line));
                } else {
                    log.info?.(line);
                }
            },
            error: (e, ctx) => {
                const msg = `[error]${ctx?.request_id ? ` id=${ctx.request_id}` : ""} ${e?.stack || e}`;
                if (format) {
                    log.error?.(format("error", msg));
                } else {
                    log.error?.(msg);
                }
            }
        }
    };

    // Collect routes via registry
    const registry = new RouteRegistry();
    await registerApps(registry);

    log.info?.(`[boot] host:${host} HTTP:${httpPort} HTTPS:${httpsPort} SFTP:${enableSftp ? (process.env.SFTP_PORT || 2022) : "off"}`);

    // server.ts (ensure this exists before bootAllFromRegistry)
    opts.logger = {
        access: (r) => {
            const size = r.bytes < 1024 ? `${r.bytes}B` : `${(r.bytes / 1024).toFixed(1)}KB`;
            console.log(
                `[access] ${r.status} ${r.method} ${r.path} ${r.duration_ms}ms ${size} id=${r.request_id} ip=${r.ip ?? "-"}`
            );
        },
        error: (e, ctx) => {
            console.error(`[error]${ctx?.request_id ? ` id=${ctx.request_id}` : ""} ${e?.stack || e}`);
        },
    };

    await bootAllFromRegistry(registry, opts);
    await startCli(registry);
}

main().catch((err) => {
    console.error("Fatal startup error", err);
    process.exit(1);
});
