// cortex/http/routes/welcome.ts

import type { RouteDef } from "../chttpx";

export function routes(): RouteDef[] {
    return [
        {
            method: "GET",
            path: "/",
            handler: async (req, res) => {
                const app = process.env.APP_NAME || "Codexsun";
                const ver = process.env.APP_VERSION || "";
                const sid = (req as any).session?.id || "—";
                const tenantId = (req as any).tenant?.id || "—";

                const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${app} — Welcome</title>
<style>
  :root { --fg:#1a1a1a; --muted:#677; --bg:#fff; --card:#f7f7f8; --accent:#4f46e5; }
  * { box-sizing:border-box }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:var(--fg); background:var(--bg); }
  .wrap { max-width: 880px; margin: 5vh auto; padding: 24px; }
  .card { background:var(--card); border-radius:16px; padding:24px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { margin:0 0 8px; font-size: clamp(24px, 4vw, 34px); }
  p { margin: 8px 0 0; color: var(--muted); }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:16px; }
  .kpi { background:#fff; padding:14px 16px; border-radius:12px; border:1px solid #eee; }
  .kpi b { display:block; font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; }
  .kpi span { display:block; font-size:14px; margin-top:4px; color:#111827; word-break:break-all; }
  code { background:#111827; color:#e5e7eb; padding:2px 6px; border-radius:6px; }
  a { color:var(--accent); text-decoration:none; }
  .links { margin-top:18px; display:flex; gap:12px; flex-wrap:wrap; }
  .pill { display:inline-block; padding:8px 12px; background:#fff; border:1px solid #eee; border-radius:999px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Welcome to Codexsun 👋</h1>
      <p>${app}${ver ? ` v${ver}` : ""} is running.</p>

      <div class="grid">
        <div class="kpi"><b>Health</b><span>GET <code>/healthz</code></span></div>
        <div class="kpi"><b>Session</b><span>${sid}</span></div>
        <div class="kpi"><b>Tenant</b><span>${tenantId}</span></div>
      </div>

      <div class="links">
        <span class="pill">Send <code>X-App-Key</code> / <code>X-App-Secret</code> headers to set tenant</span>
        <span class="pill">Cookie <code>sid</code> is HttpOnly; SameSite=Lax</span>
        <a class="pill" href="/healthz">Open /healthz</a>
      </div>
    </div>
  </div>
</body>
</html>`;

                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(html);
            },
        },
    ];
}
