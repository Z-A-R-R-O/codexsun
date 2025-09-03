// cortex/http/serve_all.ts — starts HTTP/HTTPS/SFTP with logger + cors passthrough
import fs from "fs";
import path from "path";
import "dotenv/config";
import { createNodeServer, createHttpsServer } from "./chttpx";
import { createSftpServer } from "./sftpx";
import type { RouteDef } from "./chttpx";
import type { LoggerOptions, LogStore } from "./logger";
import type { CORSOptions } from "./cors";
import { RouteRegistry } from "./route_registry";

export type RouteProvider = () => Promise<RouteDef[]> | RouteDef[];

export interface BootOptions {
    providers: RouteProvider[];
    host?: string;
    httpPort?: number;
    httpsPort?: number;
    tlsKeyPath?: string;
    tlsCertPath?: string;
    tlsCaPath?: string;
    cors?: CORSOptions | boolean;
    sftp?: {
        enable?: boolean;
        port?: number;
        hostKeyPath?: string;
        rootDir?: string;
        users?: { username: string; password?: string; authorizedKeys?: string[] }[];
    };
    logger?: LoggerOptions;
    logStore?: LogStore;
}

export async function bootAll(opts: BootOptions) {
    const host = opts.host || process.env.APP_HOST || process.env.HOST || "localhost";
    const httpPort = opts.httpPort ?? parseInt(process.env.APP_PORT || process.env.PORT || "3006", 10);
    const httpsPort = opts.httpsPort ?? parseInt(process.env.HTTPS_PORT || "3443", 10);

    // gather routes
    let routes: RouteDef[] = [];
    for (const p of opts.providers) routes = routes.concat(await p());

    // HTTP
    const httpServer = createNodeServer(routes, {
        cors: opts.cors ?? true,
        logger: opts.logger,
        logStore: opts.logStore,
        onError: (e) => opts.logger?.error?.(e, { ts: new Date().toISOString() }),
    } as any);

    httpServer.listen(httpPort, host, () => {
        console.log(`[HTTP] listening on http://${host}:${httpPort}`);
    });

    // HTTPS optional
    const keyPath = opts.tlsKeyPath ?? process.env.TLS_KEY ?? path.resolve(process.cwd(), "server.key");
    const certPath = opts.tlsCertPath ?? process.env.TLS_CERT ?? path.resolve(process.cwd(), "server.crt");
    const caPath = opts.tlsCaPath ?? process.env.TLS_CA;
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const tls = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
            ...(caPath && fs.existsSync(caPath) ? { ca: fs.readFileSync(caPath) } : {}),
        };
        const httpsServer = createHttpsServer(routes, tls, {
            cors: opts.cors ?? true,
            logger: opts.logger,
            logStore: opts.logStore,
            onError: (e) => opts.logger?.error?.(e, { ts: new Date().toISOString() }),
        } as any);
        httpsServer.listen(httpsPort, host, () => {
            console.log(`[HTTPS] listening on https://${host}:${httpsPort}`);
        });
    } else {
        console.warn(`[HTTPS] skipped (key/cert not found at ${keyPath} / ${certPath})`);
    }

    // SFTP optional
    const sftpCfg = opts.sftp ?? {};
    if (sftpCfg.enable ?? true) {
        const sftpPort = sftpCfg.port ?? parseInt(process.env.SFTP_PORT || "2022", 10);
        const sshKeyPath = sftpCfg.hostKeyPath ?? process.env.SSH_HOST_KEY ?? path.resolve(process.cwd(), "ssh_host_ed25519_key");
        const sftpRoot = sftpCfg.rootDir ?? process.env.SFTP_ROOT ?? path.resolve(process.cwd(), "sftp-root");
        if (!fs.existsSync(sftpRoot)) fs.mkdirSync(sftpRoot, { recursive: true });
        if (!fs.existsSync(sshKeyPath)) {
            console.warn(`[SFTP] skipped (missing SSH host key at ${sshKeyPath})`);
        } else {
            const sftp = createSftpServer({
                hostKeys: [fs.readFileSync(sshKeyPath)],
                users: sftpCfg.users ?? [{ username: process.env.SFTP_USER || "demo", password: process.env.SFTP_PASS || "demo" }],
                rootDir: sftpRoot,
                banner: "Welcome to codexsun sftp server",
                debug: true,
                onError: (e) => console.error("[SFTP] error:", e),
            });
            sftp.listen(sftpPort, "0.0.0.0", () => {
                console.log(`[SFTP] listening on sftp://${host}:${sftpPort} (SSH)`);
            });
        }
    }
}

export async function bootAllFromRegistry(registry: RouteRegistry, opts?: Omit<BootOptions, "providers">) {
    const providers = [async () => await registry.collect()];
    return bootAll({ providers, ...(opts || {}) });
}
