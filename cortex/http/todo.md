Perfect. Here’s how we’ll kick off, so the very next message can just be a code drop that boots cleanly on your env.

# What we’ll build first (Milestone 1)

**Goal:** running server with tenant-aware sessions, neat logs to file, and visible `/` + `/healthz`.

**Artifacts I’ll drop next:**

1. `cortex/http/logger.ts` ✅

     * Pretty console lines + append to `storage/framework/log.txt` (auto-creates dir)
    * `LOG_JSON=1` optional JSON mirror

2. `cortex/http/middleware/session.ts`  ✅

    * Signed cookie `sid` (HMAC with `APP_KEY`), `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS/`FORCE_SECURE_COOKIES=1`, **2h TTL**
    * Store: **auto** → Redis if `REDIS_URL`, else in-memory
    * `ctx.session = { id, get, set, all, destroy, regenerate }`

3. `cortex/http/middleware/tenant.ts`  ✅

    * Resolve tenant in this order: `session.tenant_id` → `X-App-Key` + `X-App-Secret` (Mode A) → `?tenant=code` (dev)
    * Sets `ctx.tenant` and persists `session.tenant_id`
    * (Skeleton for HMAC Mode B; we’ll wire signature verification in Milestone 2)

4. `cortex/http/middleware/db_context.ts`  ✅

    * Binds `ctx.db` using your `connection_manager` per `tenant_id` (LRU + idle TTL hooks ready)

5. `cortex/http/routes/welcome.ts` and `health.ts`   ✅

    * `/` HTML (works in browser), `/healthz` JSON

6. **Small edits** to:  ✅

    * `cortex/http/chttpx.ts` → keep slim (CORS + lifecycle), call middleware chain
    * `server.ts` / `serve_all.ts` → use `APP_HOST`/`APP_PORT`, mount welcome/health, pass logger & logStore

**What you’ll see work immediately**

* Visit `http://localhost:3006/` → HTML welcome
* `GET /healthz` → `{ ok: true }`
* `curl -H "X-App-Key: …" -H "X-App-Secret: …" /api/...` → resolves tenant, sets session cookie
* Logs appear in `storage/framework/log.txt` and console (clean, readable)

# Milestone 2 (next after that)

* **HMAC signature auth (Mode B)**: `X-App-Signature` with `X-Date`, `X-Content-Sha256`
* **Uploads/Downloads (streaming, any size)**: `POST /files/upload`, `GET /files/:id` with Range support
* Optional: Redis cache, backups CLI

# Defaults I’ll use (you can tweak later)

* Cookie name: `sid`, TTL: **2h**, SameSite=Lax, Secure auto
* Logs: `storage/framework/log.txt`, pretty + console; JSON with `LOG_JSON=1`
* CORS: on (can disable via `CORS=off` or `CORS_DISABLE=1`)
* Redis: auto-detect via `REDIS_URL` (optional)

If that looks good, I’ll start with **Milestone 1** in the next message and drop all the code ready to run with your current `.env`.