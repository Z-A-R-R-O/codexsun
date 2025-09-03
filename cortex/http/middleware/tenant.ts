// cortex/http/middleware/tenant.ts — attach tenant info from headers to session
import type { IncomingMessage, ServerResponse } from "http";

export function tenantMiddleware() {
  return async function mw(req: IncomingMessage & { session?: any; tenant?: any }, _res: ServerResponse, next: () => void | Promise<void>) {
    const key = (req.headers["x-app-key"] as string) || "";
    const secret = (req.headers["x-app-secret"] as string) || "";
    let tenantId = (req.headers["x-tenant-id"] as string) || "";

    if (!tenantId && key) {
      // derive a stable pseudo-tenant id from key+secret, not for security — just scoping
      const base = key + "::" + (secret || "");
      const hash = Buffer.from(base).toString("base64url").slice(0, 15);
      tenantId = `t_${hash}`;
    }

    (req as any).tenant = { id: tenantId || null, key: key || null };
    if (req.session) {
      if (tenantId) req.session.set("tenant_id", tenantId);
      if (key) req.session.set("app_key", key);
    }
    await Promise.resolve(next());
  };
}
