// Protected sample routes using route-level middlewares
import type { RouteDef } from "../chttpx";
import { requireAuth } from "../middleware/require_auth";

export function routes(): RouteDef[] {
    return [
        {
            method: "GET",
            path: "/me",
            middlewares: [requireAuth()], // must be logged in (session.user_id)
            handler: async (req, res) => {
                const sess = (req as any).session;
                const payload = {
                    user_id: sess.get("user_id"),
                    roles: sess.get("roles") || [],
                    tenant: (req as any).tenant?.id || null,
                };
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(payload));
            },
        },
        {
            method: "GET",
            path: "/admin/panel",
            middlewares: [requireAuth({ roles: ["admin"] })], // must be admin
            handler: async (_req, res) => {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true, area: "admin" }));
            },
        },
    ];
}
