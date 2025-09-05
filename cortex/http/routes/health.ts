// health.ts
// Default export: (app) => RouteConfig

const health = (_app: any) => {
    return {
        path: "/", // you can also use "/health" as the base; keeping "/" keeps URLs short
        routes: [
            {
                method: "GET",
                path: "/health",
                name: "health",
                handler: async (_req: Request) =>
                    new Response(
                        JSON.stringify({ ok: true, service: "CodexSun", ts: new Date().toISOString() }),
                        { status: 200, headers: { "content-type": "application/json" } }
                    ),
            },
            // (optional) a quick liveness alias
            {
                method: "GET",
                path: "/livez",
                name: "livez",
                handler: async () => new Response("ok", { status: 200 }),
            },
        ],
    };
};

export default health;
