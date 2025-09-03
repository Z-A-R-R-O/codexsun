import { IncomingMessage, ServerResponse } from "http";

/**
 * Minimal '/' route that returns HTML (browser-friendly).
 * Assumes upstream middleware may have attached: ctx.session, ctx.tenant, ctx.db.
 */

export interface SessionAPI {
    id: string;
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    all<T = Record<string, unknown>>(): Promise<T>;
    destroy(): Promise<void>;
    regenerate(opts?: { keepData?: boolean }): Promise<void>;
}

export interface DBHandle {
    profile: string;
    driver(): Promise<string>;
    healthz(): Promise<{ ok: boolean; driver: string }>; // lightweight ping
}

export interface TenantLike { id: string | number; code?: string; name?: string }

export interface CtxLike {
    req: IncomingMessage & { [k: string]: any };
    res: ServerResponse & { [k: string]: any };
    session?: SessionAPI;
    tenant?: TenantLike | null;
    db?: DBHandle;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]!));

export async function welcome(ctx: string) {
    const { res, session, tenant, db } = ctx;
    const app = process.env.APP_NAME || "CodexSun";
    const ver = process.env.APP_VERSION || "0.0.0";

    let driver = "(none)";
    let profile = "(none)";
    try {
        if (db) {
            driver = await db.driver();
            profile = db.profile;
        }
    } catch { /* ignore */ }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(app)} — Welcome</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; margin: 0; }
    header { padding: 28px 20px; background: #0ea5e9; color: white; }
    main { padding: 20px; max-width: 860px; margin: 0 auto; }
    .card { border: 1px solid rgba(0,0,0,.08); border-radius: 12px; padding: 16px; margin: 12px 0; }
    .k { color: #6b7280; min-width: 160px; display: inline-block; }
    code { background: rgba(0,0,0,.06); padding: 2px 6px; border-radius: 6px; }
    footer { color: #6b7280; padding: 20px; text-align: center; }
  </style>
</head>
<body>
<header>
  <h1>${esc(app)}</h1>
  <p>Version ${esc(ver)}</p>
</header>
<main>
  <div class="card">
    <h2>It works 🎉</h2>
    <p>Your server is up. Use this page for a quick sanity check.</p>
  </div>
  <div class="card">
    <h3>Request context</h3>
    <p><span class="k">Session ID:</span> <code>${esc(session?.id || "(no session)")}</code></p>
    <p><span class="k">Tenant ID:</span> <code>${esc(tenant?.id ?? "(unbound)")}</code></p>
    <p><span class="k">Tenant Code:</span> <code>${esc(tenant?.code ?? "-")}</code></p>
  </div>
  <div class="card">
    <h3>Database</h3>
    <p><span class="k">Driver:</span> <code>${esc(driver)}</code></p>
    <p><span class="k">Profile:</span> <code>${esc(profile)}</code></p>
  </div>
  <div class="card">
    <h3>Endpoints</h3>
    <ul>
      <li><a href="/healthz">/healthz</a> — JSON health check</li>
    </ul>
  </div>
</main>
<footer>
  <small>© ${new Date().getFullYear()} ${esc(app)}</small>
</footer>
</body>
</html>`;

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(html);
}

export default welcome;
