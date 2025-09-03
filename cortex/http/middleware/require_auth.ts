// Require a logged-in session (and optional roles)
import type { IncomingMessage, ServerResponse } from "http";

type Req = IncomingMessage & { session?: { get: (k: string) => any } };

export interface RequireAuthOptions {
    roles?: string[]; // e.g., ["admin"]
}

export function requireAuth(opts: RequireAuthOptions = {}) {
    const wantRoles = new Set((opts.roles || []).map(String));
    return async function mw(req: Req, res: ServerResponse, next: () => void | Promise<void>) {
        const uid = req.session?.get("user_id");
        if (!uid) {
            res.statusCode = 401;
            res.setHeader("WWW-Authenticate", 'Session realm="app"');
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
        }
        if (wantRoles.size) {
            const roles: string[] = Array.isArray(req.session?.get("roles")) ? req.session!.get("roles") : [];
            const has = roles.some((r) => wantRoles.has(String(r)));
            if (!has) {
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Forbidden" }));
                return;
            }
        }
        await Promise.resolve(next());
    };
}
