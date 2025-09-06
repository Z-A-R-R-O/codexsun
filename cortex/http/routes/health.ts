// cortex/http/routes/health.ts
import type { RouteDef } from "../chttpx";

export function routes(): RouteDef[] {
    return [
        {
            method: "GET",
            path: "/healthz",
            handler: async (req, res) => {
                let dbHealthy: boolean | undefined = undefined;
                try {
                    const db = (req as any).db;
                    if (db && typeof db.healthz === "function") {
                        dbHealthy = await db.healthz();
                    }
                } catch {
                    dbHealthy = false;
                }

                const payload = {
                    ok: dbHealthy !== false, // overall ok unless DB explicitly failed
                    time: new Date().toISOString(),
                    uptime: process.uptime(),
                    app: process.env.APP_NAME || "CodexSun",
                    version: process.env.APP_VERSION || undefined,
                    db: dbHealthy, // true/false/undefined (if no DB bound)
                };

                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(payload));
            },
        },
    ];
}
