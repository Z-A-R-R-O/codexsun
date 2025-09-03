// serve_all.ts
/**
 * serve_all — boots HTTP, HTTPS, and SFTP using our bare Node stacks.
 * - Accepts route providers so any app (tenant or others) can plug routes in.
 */

import fs from 'fs';
import path from 'path';
import "dotenv/config";
import { createNodeServer, createHttpsServer } from './chttpx';
import { createSftpServer } from './sftpx';
import type { RouteDef } from './chttpx';

export type RouteProvider = () => Promise<RouteDef[]> | RouteDef[];

export interface BootOptions {
  providers: RouteProvider[];
  httpPort?: number;
  httpsPort?: number;
  tlsKeyPath?: string;
  tlsCertPath?: string;
  tlsCaPath?: string;
  sftp?: {
    enable?: boolean;
    port?: number;
    hostKeyPath?: string;
    rootDir?: string;
    users?: { username: string; password?: string; authorizedKeys?: string[] }[];
  };
}

export async function bootAll(opts: BootOptions) {
  const httpPort = opts.httpPort ?? parseInt(process.env.HTTP_PORT || '3000', 10);
  const httpsPort = opts.httpsPort ?? parseInt(process.env.HTTPS_PORT || '3443', 10);

  // Aggregate routes from providers
  let routes: RouteDef[] = [];
  for (const p of opts.providers) {
    const out = await p();
    routes = routes.concat(out);
  }

  // HTTP
  const httpServer = createNodeServer(routes);
  httpServer.listen(httpPort, () => {
    console.log(`[HTTP] listening on http://localhost:${httpPort}`);
  });

  // HTTPS (optional if certs exist)
  const keyPath = opts.tlsKeyPath ?? process.env.TLS_KEY ?? path.resolve(process.cwd(), 'server.key');
  const certPath = opts.tlsCertPath ?? process.env.TLS_CERT ?? path.resolve(process.cwd(), 'server.crt');
  const caPath = opts.tlsCaPath ?? process.env.TLS_CA; // optional
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const tls = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ...(caPath && fs.existsSync(caPath) ? { ca: fs.readFileSync(caPath) } : {})
    };
    const httpsServer = createHttpsServer(routes, tls);
    httpsServer.listen(httpsPort, () => {
      console.log(`[HTTPS] listening on https://localhost:${httpsPort}`);
    });
  } else {
    console.warn(`[HTTPS] skipped (key/cert not found at ${keyPath} / ${certPath})`);
  }

  // SFTP (optional)
  const sftpCfg = opts.sftp ?? {};
  if (sftpCfg.enable ?? true) {
    const sftpPort = sftpCfg.port ?? parseInt(process.env.SFTP_PORT || '2022', 10);
    const sshKeyPath = sftpCfg.hostKeyPath ?? process.env.SSH_HOST_KEY ?? path.resolve(process.cwd(), 'ssh_host_ed25519_key');
    const sftpRoot = sftpCfg.rootDir ?? process.env.SFTP_ROOT ?? path.resolve(process.cwd(), 'sftp-root');
    if (!fs.existsSync(sftpRoot)) fs.mkdirSync(sftpRoot, { recursive: true });
    if (!fs.existsSync(sshKeyPath)) {
      console.warn(`[SFTP] skipped (missing SSH host key at ${sshKeyPath})`);
    } else {
      const sftp = createSftpServer({
        hostKeys: [fs.readFileSync(sshKeyPath)],
        users: sftpCfg.users ?? [
          { username: process.env.SFTP_USER || 'demo', password: process.env.SFTP_PASS || 'demo' }
        ],
        rootDir: sftpRoot,
        banner: 'Welcome to codexsun sftp server',
        debug: true,
        onError: (e) => console.error('[SFTP] error:', e)
      });
      sftp.listen(sftpPort, '0.0.0.0', () => {
        console.log(`[SFTP] listening on sftp://localhost:${sftpPort} (SSH)`);
      });
    }
  }
}


import { RouteRegistry } from './route_registry';

export async function bootAllFromRegistry(registry: RouteRegistry, opts?: Omit<BootOptions, 'providers'>) {
  const providers = [async () => await registry.collect()];
  return bootAll({ providers, ...(opts || {}) });
}
