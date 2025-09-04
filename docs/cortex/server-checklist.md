got it—here’s a **precise wiring checklist** that only tells you *where* to hook things up. no new functions added.

---

# Wiring checklist (files → exact spots to touch)

## 1) `serve_all.ts` — add global middlewares & CORS so cookies work

**File header already imports from `./chttpx`**. You’ll just **add imports** and **push middlewares** in the boot path before servers start.

* **Add imports near the other imports:**

    * `createSessionMiddleware` from `./session`
    * `tenantMiddleware` from `./tenant`
    * (if not already present) CORS helpers or just use `CORSOptions` from `./chttpx`
    * (optional) `requireEnv`/`strEnv` from `../config` to read `APP_KEY` and cookie options

* **In the main boot flow** (the area that builds routes and calls `createNodeServer` / `createHttpsServer`):

    * Ensure you have a **CORS** options object that includes:

        * `credentials: true`
        * `allowedHeaders` contains at least:
          `["Content-Type","Authorization","Cookie","X-App-Key","X-App-Secret","X-Tenant-Id"]`
        * `exposedHeaders` includes: `["Set-Cookie"]` (so clients can see it when needed)
    * **Before** you instantiate the node/https servers (where the `routes` array is finalized), locate where **global middlewares** are set/passed to `makeHandler`/server opts.

        * **Append, in this order:**

            1. CORS middleware (whatever the file currently uses/configures)
            2. `createSessionMiddleware({...})` (use your `APP_KEY` and cookie opts from `session_data.ts`)
            3. `tenantMiddleware()`
        * These must be **global** so that every route (including `/me` and `/admin/panel`) sees `req.session` and `req.tenant`.

> If the file builds an options object like `const serverOpts = { cors: ..., middlewares: [...] }`, **push** the above into `middlewares` there.
> If it calls a helper like `makeHandler(routes, opts)`, ensure `opts.middlewares` contains them in the listed order.

---

## 2) `route_registery.ts` — ensure protected routes are registered

* At the place where providers are collected (near the class that has `.addProvider()` and `.collect()`), there’s no wiring needed here per se, **but** you must make sure **somewhere in your boot** (usually in `serve_all.ts`) you:

    * Import your route providers (e.g., app routes + the sample protected routes)
    * Call `register.addProvider(protectedRoutes)` where `protectedRoutes` is `() => routes()` from `protected.ts`.
* If you already have a registry instance in `serve_all.ts`, just **add one more `addProvider`** for the protected routes.

---

## 3) `protected.ts` — keep as-is, just ensure it’s included

* This file already exports `routes()` that uses `requireAuth()` and `requireAuth({ roles: ["admin"] })`.
* **Action:** Make sure `routes()` from this file is **added to the registry/providers** so we can smoke-test auth:

    * `GET /me` → requires session (401 otherwise)
    * `GET /admin/panel` → requires `roles` to include `admin` (403 otherwise)

---

## 4) `require_auth.ts` — no edits; confirm it’s applied route-level

* This module is used **route-level** in `protected.ts`.
* **Action:** For **your own business routes** that should be protected:

    * Add `middlewares: [requireAuth()]` to endpoints needing any logged-in user
    * Add `middlewares: [requireAuth({ roles: ["admin"] })]` for admin-only endpoints
* You don’t change this file—**just** use it on the route defs that need protection.

---

## 5) `session.ts` & `session_data.ts` — ensure correct config in `serve_all.ts`

* No code changes inside these files.
* **Action in `serve_all.ts`:**

    * When calling `createSessionMiddleware`, pass:

        * `secret`/`appKey` (whatever your function expects; from `APP_KEY`)
        * cookie options (name, TTL, `secure` when HTTPS, `sameSite: "lax"` or as in `session_data.ts`)
* **APP\_KEY must be set** in env; read it using your existing env helpers.

---

## 6) `tenant.ts` — no edits; ensure it runs after session

* **Action:** In `serve_all.ts` global middlewares list, place `tenantMiddleware()` **after** `createSessionMiddleware(...)` (so it can store `tenant_id` in the session if needed).

---

## 7) Your app routes (e.g., tenants API) — mark what’s public vs protected

* **Health** endpoints: leave **public** (no guard).
* **Read/list** endpoints needing login: add `middlewares: [requireAuth()]`.
* **Admin**/mutating endpoints: add `middlewares: [requireAuth({ roles: ["admin"] })]`.
* **Tenant-scoped routes** (e.g. `/api/tenants/:id`):

    * (Optional now) add a small check inside the handler to compare `req.tenant.id` with `:id`, or introduce a route-level middleware later. For now, just ensure `tenantMiddleware` is installed (Step 1).

---

## 8) `chttpx.ts` — verify the handler accepts global middlewares

* No code change expected.
* **Action:** Confirm you are **passing** `middlewares` via the server options (or equivalent) from `serve_all.ts`. That’s the hookpoint that runs:

    * CORS → Session → Tenant → Route-level middlewares → Handler

---

## 9) `config.ts` and/or `cors.ts` — one-time configuration

* **Action:** In `serve_all.ts`, **normalize** your CORS using existing utilities if the pattern is already there:

    * Allowed origins as per your env
    * `credentials: true`
    * Headers: add `"Cookie"`, `"Set-Cookie"`, `"X-App-Key"`, `"X-App-Secret"`, `"X-Tenant-Id"`
* No code changes in these modules—just **use** them while creating your CORS options object.

---

## 10) `db_context.ts` — defer (not needed for v0)

* Leave this out of the global chain for now.
* You’ll add it **later** when you start fetching users/roles from DB on login.

---

## 11) `cryptox.ts` — defer (JWT/API keys later)

* Keep as-is. We’ll use it when we add HS256 JWT or HMAC API key auth.

---

## 12) `sftpx.ts` — unrelated to HTTP auth

* No changes required.

---

# Quick “done when” checklist

* [ ] `serve_all.ts`: global middlewares set in this exact order → **CORS → Session → Tenant**
* [ ] `serve_all.ts`: CORS has `credentials: true`, headers include **Cookie/Set-Cookie** and **X-App-**\* headers
* [ ] `serve_all.ts`: providers include **protected routes** (`protected.ts`)
* [ ] Business routes updated with `middlewares: [requireAuth(...)]` where needed
* [ ] `APP_KEY` present in env; session middleware reads it
* [ ] Smoke tests:

    * `GET /me` returns **401** before login; **200** after a session is set
    * `GET /admin/panel` returns **403** unless session roles include `"admin"`

---

If you want, I can mark the exact **in-file anchor comments** (e.g., “// Boot HTTP/HTTPS…”, “// collect providers…”) in `serve_all.ts` to drop the three middleware lines and the provider add—still without adding new functions.
