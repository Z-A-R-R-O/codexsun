Perfect—here’s a tight, production-minded plan for a **multi-tenant, multi-DB ERP**, with **tenant\_id in session**, **client-aware isolation**, and **App-Key / App-Secret** headers. I’ll keep `chttpx` slim and push auth/session/db routing into middleware so it stays readable.

# Architecture overview (what we’ll build)

1. **Tenant identification & isolation**

* **Headers** (client-aware):

* `X-App-Key` (public key)
* `X-App-Secret` (shared secret)
* *(Optional harden)*: `X-App-Signature` (HMAC SHA256 of canonical request, using App-Secret) — keeps the secret off the wire.
* **Resolution order** (first match wins):

1. `session.tenant_id` → load tenant context
2. `X-App-Key` + `X-App-Secret` → verify → set session.tenant\_id
3. *(Optional)* Subdomain `tenant.example.com` mapping
4. *(Dev only)* `?tenant=code`
* **Session**: signed cookie `sid`, **HttpOnly**, **SameSite=Lax**, **Secure** when HTTPS/`FORCE_SECURE_COOKIES=1`, **2h TTL**. Store `tenant_id` and minimal user scope (if applicable).
* **Per-tenant DB**: a `connection_manager` picks/creates a pool using the tenant’s DB config (from your `tenants` table). Pool cached with LRU + idle TTL.

2. **Data model (tenants)**

* Columns (additions):
  `app_key (unique)`, `app_secret_hash` (argon2/bcrypt), `db_driver`, `db_host`, `db_port`, `db_name`, `db_user`, `db_pass_enc`, `db_options_json`, `status`.
* `db_pass_enc` encrypted with `APP_KEY` (AES-256-GCM via your `cryptox.ts`) and only decrypted in memory for pool creation.

3. **Request context**

* `ctx.tenant?: { id, code, name }`
* `ctx.db?: TenantDb` (a thin query facade bound to the tenant pool)
* `ctx.session`: `{ id, get, set, all, destroy, regenerate }`

4. **Logging**

* Pretty console + append file **`storage/framework/log.txt`**, JSON logs opt-in (`LOG_JSON=1`).
* Every access/error log includes `tenant_id` (and `tenant_code` if available). **Never** log App-Secret; mask auth headers.

5. **Uploads/Downloads (any size)**

* Streaming upload endpoint (raw `application/octet-stream`) → `storage/uploads/<tenant_id>/yyyy/mm/dd/<hash or uuid>`.
* Streaming download with **Range** support (resume/partial).
* Optional multipart support (Busboy) can be added later—raw stream keeps deps minimal.

6. **Redis (optional, auto)**

* If `REDIS_URL` present → use Redis for **sessions** and **cache**. Else in-memory stores.
* Same interface so routes don’t care.

7. **Backups**

* `backup:uploads` packs **per-tenant** uploads to `backups/<tenant_id>/<timestamp>.tar.gz`.
* Hook point for DB dump per tenant (pg\_dump/mysqldump) if/when you provide commands.

    ---

# Files & responsibilities (where things live)

```
cortex/
  config.ts                         # env getters (host/port/debug/limits)
  main.ts                           # registers feature apps
  http/
    chttpx.ts                       # slim router (CORS + lifecycle only)
    serve_all.ts                    # boot HTTP/HTTPS/SFTP
    route_registry.ts
    logger.ts                       # pretty console, file appender, JSON option
    middleware/
      body.ts                       # JSON parser (Content-Type guard + limit)
      session.ts                    # cookie session (signed) + pluggable store
      tenant.ts                     # resolves tenant via session/headers/subdomain
      db_context.ts                 # binds ctx.db using connection_manager + tenant
      secure_headers.ts             # masks sensitive headers in logs
    routes/
      welcome.ts                    # GET /
      health.ts                     # GET /healthz
      files.ts                      # POST /files/upload, GET /files/:id (streaming)
  session/
    memory_store.ts                 # default session store
    redis_store.ts                  # redis-backed session store
  cache/
    index.ts                        # in-memory TTL cache
    redis_cache.ts                  # redis-backed cache
  storage/
    store.ts                        # abstract storage interface
    local_store.ts                  # fs streams + Range
    uploads.ts                      # id/path/metadata helpers (per-tenant)
  redis/
    client.ts                       # shared ioredis client (if REDIS_URL)
  db/
    connection_manager.ts           # per-tenant pools (LRU + TTL)
  backup/
    backup.ts                       # tar.gz uploads; hooks for DB dump
  log_store.ts                      # (optional) writes logs to DB
```

---

# Header & security spec

* **Headers accepted**

* `X-App-Key`: tenant’s public key
* `X-App-Secret`: shared secret *(supported but discouraged for long term)*
* `X-App-Signature`: **recommended** HMAC SHA256 over a canonical string
  `method\npath\nx-date\ncontent-sha256` using App-Secret
* `X-Date`: RFC 1123 timestamp (±5 minutes skew)
* `X-Content-Sha256`: hex SHA256 of request body (empty string => hash of empty payload)

* **Verification modes**

* **Mode A (transitional)**: `X-App-Key` + `X-App-Secret` → direct verify secret hash.
* **Mode B (preferred)**: `X-App-Key` + `X-App-Signature` (+ `X-Date`, `X-Content-Sha256`) → verify HMAC; **don’t require sending the secret**.
* If either passes → set `session.tenant_id` (and optionally `session.auth_mode`).

* **Rate limiting / abuse control (future-proof)**: additive hook to rate-limit failed auth per key/IP via Redis.

---

# Session behavior (cookie)

* Cookie: `sid.signature`
* Flags: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (HTTPS/forced)
* TTL: 2h (`SESSION_TTL_MS`), sliding window (touch on write)
* Store: auto-select Redis if `REDIS_URL`, else memory
* API:

* `ctx.session.get('tenant_id')`
* `ctx.session.set('tenant_id', <uuid>)`
* `ctx.session.regenerate()` on privilege change
* `ctx.session.destroy()` on logout/rotate

---

# Per-tenant DB routing

* `tenant.ts` middleware resolves `{ id, code, app_key, db_config }` → attaches to `ctx.tenant`.
* `db_context.ts` asks `connection_manager` for a pool keyed by `tenant_id`.

* Pools LRU capped (e.g., 100) with idle TTL (e.g., 10m).
* Uses your `Engine`/`Default` adapters; decrypts `db_pass_enc` with `APP_KEY`.
* Exposes `ctx.db.Query/FetchOne/FetchAll` bound to tenant pool.

---

# Logging details

* **Access line (pretty):**
  `2025-09-03T12:34:56.789Z 200 GET /api/tenants 12.3ms 1.2KB tenant=acme id=... ip=1.2.3.4 ua="Chrome" ref="/"`
  (UA/referrer trimmed to 120 chars)
* **File**: `storage/framework/log.txt` (append; create dirs if missing)
    * **JSON opt-in**: `LOG_JSON=1` emits JSON objects too
* **Masking**: `secure_headers.ts` removes/masks `Authorization`, `X-App-Secret`, `X-App-Signature` (hash-only), `Set-Cookie` values in error logs.

---

# Streaming uploads/downloads (per tenant)

* `POST /files/upload` (raw octet-stream)
  Headers: `Content-Type: application/octet-stream`, `X-Filename: original.ext`
  → stored at `storage/uploads/<tenant_id>/yyyy/mm/dd/<uuid>` + metadata
* `GET /files/:id`
  → stream file; support `Range` header; `Content-Disposition: attachment`
* Limits:

* `MAX_UPLOAD_SIZE=0` (unlimited; disk limits apply)
* Large files handled with back-pressure; no buffering in memory

---

# Redis (optional, automatic)

* If `REDIS_URL` present:

    * `session/redis_store.ts` for sessions
      * `cache/redis_cache.ts` for generic TTL cache
* else: in-memory fallbacks

---

# Backups

* Command: `pnpm run backup:uploads`
  → tar.gz per tenant to `backups/<tenant_id>/<timestamp>.tar.gz`
* DB dump hook: ready to call `pg_dump`/`mysqldump` per tenant when you provide commands/creds policy.

---

# ✅ Strong TODO (numbered checklist to build + verify)

## Build

1. **Models & migrations**
   1.1 Add columns to `tenants`: `app_key (unique)`, `app_secret_hash`, `db_driver`, `db_host`, `db_port`, `db_name`, `db_user`, `db_pass_enc`, `db_options_json`, `status`.
   1.2 Write a script to **generate** `app_key` + **hash** `app_secret` (argon2/bcrypt), **encrypt** DB pass with `APP_KEY`.

    2. **Middleware**
       2.1 `http/middleware/session.ts` — signed cookie `sid`, TTL 2h, Redis/memory store.
       2.2 `http/middleware/tenant.ts` — resolve tenant via session → headers; verify Mode A (key+secret) and Mode B (HMAC signature); set `session.tenant_id`.
       2.3 `http/middleware/db_context.ts` — look up pool from `connection_manager` by `tenant_id`; attach `ctx.db`.
       2.4 `http/middleware/body.ts` — JSON parser (Content-Type guarded + size limit).
       2.5 `http/middleware/secure_headers.ts` — mask sensitive headers in logs.

3. **Router & routes**
   3.1 Keep `chttpx.ts` slim (CORS + lifecycle + logger hooks).
   3.2 Wire middleware order in `serve_all.ts` or at route registration (per provider): `session → tenant → db_context → body (for JSON APIs)`
   3.3 Add `routes/welcome.ts` (`GET /`) and `routes/health.ts` (`GET /healthz`).
   3.4 Add `routes/files.ts`: `POST /files/upload` (raw stream), `GET /files/:id` (Range support).

4. **DB connection manager**
   4.1 Implement LRU pool cache with idle TTL; key by `tenant_id`.
   4.2 Decrypt `db_pass_enc` via `cryptox.ts` (AES-256-GCM) using `APP_KEY`.

5. **Logging**
   5.1 `http/logger.ts`: pretty console + append file; JSON opt-in.
   5.2 Include `tenant_id`/`tenant_code` in access & error logs.
   5.3 Ensure file `storage/framework/log.txt` is created automatically.

6. **Storage**
   6.1 `storage/local_store.ts`: safe fs streams + Range.
   6.2 `storage/uploads.ts`: per-tenant paths + metadata.

7. **Redis (optional)**
   7.1 `redis/client.ts` (ioredis).
   7.2 `session/redis_store.ts`, `cache/redis_cache.ts`.

8. **Backups**
   8.1 `backup/backup.ts` — tar.gz per-tenant uploads.
   8.2 CLI script `backup:uploads` → call `backupUploads()`.

## Verify (manual tests)

9. **Boot**
   9.1 Start server: `APP_HOST=localhost APP_PORT=3006 pnpm run dev:api`
   9.2 Hit `/` in browser → HTML welcome; `/healthz` → JSON `{ ok: true }`.

10. **Tenant auth (Mode A)**
    10.1 Create a tenant with `app_key=acme_pub`, `app_secret=acme_secret` (hash stored), and DB config.
    10.2 `curl -i http://localhost:3006/api/tenants -H "X-App-Key: acme_pub" -H "X-App-Secret: acme_secret"`
    → 200, logs show `tenant=acme`.
    10.3 Repeat call **without headers** (cookie should carry session) → still 200.

11. **Tenant auth (Mode B, HMAC)**
    11.1 Send request with `X-App-Key`, `X-Date`, `X-Content-Sha256`, `X-App-Signature` (HMAC SHA256).
    11.2 Expect 200 and session set; verify signature failures return 401.

12. **DB isolation**
    12.1 Create two tenants (A & B) pointing to **different DBs/schemas**.
    12.2 Hit same endpoint with A’s headers → only A’s data; B’s headers → only B’s data.

13. **Session security**
    13.1 Confirm cookie `sid` is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
    13.2 Tamper cookie → server makes **new** session (signature invalid).

14. **Logging**
    14.1 Check console & `storage/framework/log.txt` lines include `tenant=...`.
    14.2 Set `LOG_JSON=1` → see JSON lines too.
    14.3 Verify secrets/signatures **not** present in logs (masked).

15. **Uploads**
    15.1 `curl --data-binary @big.iso -H "Content-Type: application/octet-stream" -H "X-Filename: big.iso" ... /files/upload` → 200 id.
    15.2 `curl -O -J http://.../files/<id>` supports resume with `-C -`.

    16. **Backups**
        16.1 `pnpm run backup:uploads` → creates `backups/<tenant_id>/*.tar.gz`.
        16.2 Inspect archive & restore a sample file.

---

    If you’re happy with this plan, I’ll implement it exactly like this (middleware + routes + logger + per-tenant db + uploads + optional redis), starting with the **tenant/session/db middleware** and **logger to file** since those unlock everything else.




