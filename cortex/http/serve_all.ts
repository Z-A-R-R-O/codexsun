// cortex/framework/http/serve_all.ts — boot HTTP/HTTPS (+ optional SFTP), with CORS + middleware + logging

import fs from "fs";
import path from "path";
import "dotenv/config";
import {
    createNodeServer,
    createHttpsServer,
    type RouteDef,
    type CORSOptions,
    type Middleware,
} from "./chttpx";
import type { Logger } from "../log/logger";

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
    logger?: Logger;                 // pretty console + file sink created outside and passed in
    middlewares?: Middleware[];      // e.g. session, tenant, db_context
    sftp?: {
        enable?: boolean;
        port?: number;
        hostKeyPath?: string;
        rootDir?: string;
        users?: { username: string; password?: string; authorizedKeys?: string[] }[];
    };
}

function envFlag(name: string, def: boolean): boolean {
    const v = process.env[name];
    if (v == null) return def;
    return /^(1|true|yes|on)$/i.test(v);
}

function envInt(name: string, def: number): number {
    const v = process.env[name];
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : def;
}

export async function bootAll(opts: BootOptions) {
    const host = opts.host || process.env.APP_HOST || process.env.HOST || "0.0.0.0";
    const httpPort = opts.httpPort ?? parseInt(process.env.APP_PORT || process.env.PORT || "3006", 10);
    const httpsPort = opts.httpsPort ?? parseInt(process.env.HTTPS_PORT || "3443", 10);
    const logger = opts.logger;

    // collect routes from all providers
    let routes: RouteDef[] = [];
    for (const p of opts.providers) {
        const chunk = await p();
        if (Array.isArray(chunk)) routes = routes.concat(chunk);
    }

    // add built-ins only if missing (keep your own / and /healthz as-is)
    const haveHealth = routes.some(
        (r) => (Array.isArray(r.method) ? r.method : [r.method]).includes("GET") && r.path === "/healthz",
    );
    const haveRoot = routes.some(
        (r) => (Array.isArray(r.method) ? r.method : [r.method]).includes("GET") && r.path === "/",
    );

    if (!haveHealth) {
        routes.push({
            method: "GET",
            path: "/healthz",
            handler: async (_req, res) => {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true }));
            },
        });
    }

    if (!haveRoot) {
        routes.push({
            method: "GET",
            path: "/",
            handler: async (_req, res) => {
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end("Welcome");
            },
        });
    }

    // HTTP
    const httpServer = createNodeServer(routes, {
        cors: opts.cors ?? true,
        logger,
        middlewares: opts.middlewares || [],
        onError: (e) =>
            logger?.error?.("[HTTP] error", { error: (e as any)?.message || String(e) }),
    });

    httpServer.listen(httpPort, host, () => {
        (logger?.success?.(`[HTTP] listening on http://${host}:${httpPort}`) as any) ??
        console.log(`[HTTP] http://${host}:${httpPort}`);
    });

    // HTTPS (optional if TLS files exist)
    const tlsKeyPath = opts.tlsKeyPath || process.env.TLS_KEY_PATH;
    const tlsCertPath = opts.tlsCertPath || process.env.TLS_CERT_PATH;
    const tlsCaPath = opts.tlsCaPath || process.env.TLS_CA_PATH;

    if (tlsKeyPath && tlsCertPath && fs.existsSync(tlsKeyPath) && fs.existsSync(tlsCertPath)) {
        try {
            const key = fs.readFileSync(tlsKeyPath);
            const cert = fs.readFileSync(tlsCertPath);
            const ca = tlsCaPath && fs.existsSync(tlsCaPath) ? fs.readFileSync(tlsCaPath) : undefined;

            const httpsServer = createHttpsServer(routes, { key, cert, ca }, {
                cors: opts.cors ?? true,
                logger,
                middlewares: opts.middlewares || [],
                onError: (e) =>
                    logger?.error?.("[HTTPS] error", { error: (e as any)?.message || String(e) }),
            });

            httpsServer.listen(httpsPort, host, () => {
                (logger?.success?.(`[HTTPS] listening on https://${host}:${httpsPort}`) as any) ??
                console.log(`[HTTPS] https://${host}:${httpsPort}`);
            });
        } catch (e) {
            logger?.warn?.("[HTTPS] failed to start", { error: (e as any)?.message || String(e) });
        }
    } else {
        logger?.info?.("[HTTPS] skipped (TLS files not found)");
    }

    // Optional SFTP boot (module must exist at cortex/framework/sftpx.ts or be re-exported there)
    if (opts.sftp?.enable || envFlag("SFTP_ENABLE", false)) {
        try {
            const mod = await import("./sftpx");
            const createSftpServer = (mod as any).createSftpServer as Function;
            const sftpPort = opts.sftp?.port ?? envInt("SFTP_PORT", 2222);
            const sftpRoot = opts.sftp?.rootDir || process.env.SFTP_ROOT || path.resolve(process.cwd(), "storage", "sftp");
            const hostKeyPath = opts.sftp?.hostKeyPath || process.env.SFTP_HOST_KEY;
            const users = opts.sftp?.users || [];

            const sftp = createSftpServer({ rootDir: sftpRoot, hostKeyPath, users });
            sftp.listen(sftpPort, "0.0.0.0", () => {
                (logger?.success?.(`[SFTP] listening on sftp://0.0.0.0:${sftpPort}`) as any) ??
                console.log(`[SFTP] sftp://0.0.0.0:${sftpPort}`);
            });
        } catch (e) {
            logger?.warn?.("[SFTP] failed to start (module missing or error)", {
                error: (e as any)?.message || String(e),
            });
        }
    }

    logger?.success?.("Boot complete");
}
