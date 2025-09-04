awesome—sticking to “no new code yet.” I read everything you uploaded (deduped where you sent a file twice) and lined it up for a **simple, session-based auth** first, plus what we’ll reuse vs. defer.

# Files I read (deduped) & what they give us

1. `/mnt/data/tenant.ts` (24 lines)

* **Purpose:** middleware to attach `tenant.id` to `req` via headers (`x-tenant-id`, or derived from app key/secret).
* **Exports:** `tenantMiddleware()`
* **Use for auth?** ✅ Yes — tenant scoping context available from day one.

2. `/mnt/data/session.ts` (162 lines)

* **Purpose:** HMAC-signed **cookie session** middleware (2h TTL default), attaches `req.session` with `get/set`.
* **Exports:** `createSessionMiddleware` (+ types)
* **Use for auth?** ✅ Yes — this is our v0 “auth provider” (login = set user in session).

3. `/mnt/data/require_auth.ts` (33 lines)

* **Purpose:** **route guard**; checks `req.session.get("user_id")`; optional roles.
* **Exports:** `requireAuth(opts?)`
* **Use for auth?** ✅ Yes — protect endpoints, with or without role checks.

4. `/mnt/data/db_context.ts` (78 lines)

* **Purpose:** injects DB connection as `req.db` by profile.
* **Exports:** `dbContextMiddleware()`
* **Use for auth?** ➖ Later — when we fetch users/roles from DB.

5. `/mnt/data/protected.ts` (34 lines)

* **Purpose:** sample protected routes using `requireAuth()` (e.g., `/admin/panel`).
* **Exports:** `routes()`
* **Use for auth?** ✅ As a smoke test to confirm the chain works.

6. `/mnt/data/cache.ts` (303 lines)

* **Purpose:** TTL cache (memory/Redis abstraction).
* **Exports:** cache interface/factory.
* **Use for auth?** ➖ Later — rate limiting, token blacklists, etc.

7. `/mnt/data/chttpx.ts` (195 lines)

* **Purpose:** native HTTP server + route registry + global/route middlewares + CORS.
* **Exports:** core types (RouteDef, etc.).
* **Use for auth?** ✅ Backbone to host `session`, `tenant`, `requireAuth`.

8. `/mnt/data/config.ts` (113 lines)

* **Purpose:** env helpers (`strEnv`, `intEnv`, `boolEnv`, `listEnv`, `requireEnv`).
* **Use for auth?** ✅ Load `APP_KEY`, cookie TTL/name, CORS, etc.

9. `/mnt/data/cors.ts` (93 lines)

* **Purpose:** normalize/check CORS origins & headers.
* **Use for auth?** ✅ Pair with `chttpx` so browsers can send cookies/headers cleanly.

10. `/mnt/data/cryptox.ts` (273 lines) — (uploaded earlier, same hash)

* **Purpose:** crypto utils: HMAC, AES-GCM, scrypt/pbkdf2, **HS256 JWT sign/verify**, timing-safe compare.
* **Use for auth?** ➕ Optional later — enables API keys or HS256 JWTs without new deps.

11. `/mnt/data/session_data.ts` (61 lines) — **uploaded twice, same content**

* **Purpose:** cookie names/options, TTL defaults, (de)serialization helpers for sessions.
* **Use for auth?** ✅ Required by `session.ts`.

12. `/mnt/data/route_registery.ts` (50 lines)

* **Purpose:** route registration abstraction.
* **Use for auth?** ✅ It’s how we plug protected/public routes in.

13. `/mnt/data/serve_all.ts` (161 lines)

* **Purpose:** bootstraps HTTP server(s), loads route providers.
* **Use for auth?** ✅ Where we order middlewares: CORS → session → tenant → routes.

14. `/mnt/data/sftpx.ts` (388 lines)

* **Purpose:** SFTP server helper.
* **Use for auth?** ➖ Unrelated to HTTP auth; keep as-is.

**Duplicates handled:** `session_data.ts` was uploaded **twice** (identical SHA1), so I treated it once. Everything else unique.

---

# Simple Auth: what we already have vs. what we need

## We already have (reuse)

* **Sessions**: `createSessionMiddleware` (+ `session_data.ts`) to persist logged-in user.
* **Route Guard**: `requireAuth()` with optional role checks.
* **Tenant context**: `tenantMiddleware()` to set `req.tenant.id`.
* **Server wiring**: `serve_all.ts`, `chttpx.ts`, `route_registery.ts`.
* **CORS & Config**: `cors.ts`, `config.ts`.
* **Example routes**: `protected.ts` for smoke tests.

## We do **not** need to write new code for v0

* No new libraries or frameworks (native HTTP fine).
* No JWT/OAuth providers yet (keep it simple).
* No DB lookups required if we start with in-memory/constant user during login.

## Minimal glue we’ll add (when you say “code”)

1. **Middleware order in `serve_all`**
   CORS → `createSessionMiddleware` → `tenantMiddleware` → routes.
2. **Two tiny endpoints** (thin glue, no new infra):

   * `POST /auth/login` → validate credentials (hardcoded/dev or simple DB) → `req.session.set('user_id', ...)`, `req.session.set('roles', [...])`.
   * `POST /auth/logout` → `req.session.clear()` (or set expired cookie).
3. **Protect routes** using `requireAuth()`; role-gate admin routes.
4. **Tenant guard (optional now):** in routes with `:tenantId`, assert it matches `req.tenant.id` (or user’s allowed list), but we can defer.

---

# Env & settings to confirm (for v0)

* **`APP_KEY`**: required (HMAC for session cookies).
* **Cookie params** (from `session_data.ts` or env): name, TTL (e.g., 2h), `Secure`, `HttpOnly`, `SameSite`.
* **CORS**: allowed origins, `credentials: true`, and headers: `Authorization`, `X-Requested-With`, `Content-Type`.
* **(Optional) Login source**: either a small in-memory user map, or use `db_context` to fetch a user and roles.

---

# Test plan (no new code yet, just what we’ll verify)

1. **Unauthenticated path:**

   * `GET /protected` → **401** (blocked by `requireAuth()`).
2. **Login flow:**

   * `POST /auth/login` → **200**, sets session cookie.
   * `GET /protected` → **200**, reads `req.session`.
3. **Role restriction:**

   * `GET /admin/panel` with non-admin → **403**.
   * Add `roles: ["admin"]` in session → **200**.
4. **Tenant context:**

   * Hit a tenant route with header `x-tenant-id: t1` → `req.tenant.id === 't1'` available in handler.
5. **Logout:**

   * `POST /auth/logout` → clears session; subsequent protected call → **401**.

---

# Roadmap after v0 (all supported by current codebase)

* **API keys** (HMAC verify using `cryptox`): header `x-api-key` → map to a principal/role.
* **JWT (HS256)** using `cryptox`’s `jwtSignHS256`/`jwtVerifyHS256` for stateless auth.
* **DB-backed users/roles** via `db_context.ts`.
* **Rate limiting** & **blacklists** via `cache.ts`.
* **Audit logs** using whatever logger `serve_all.ts` expects.

---

If you want, I can next produce a **precise wiring checklist** (files + exact spots to touch) without adding new functions—just where to register the existing middlewares and guards.
