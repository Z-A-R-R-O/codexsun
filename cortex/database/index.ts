// cortex/database/index.ts
// Lightweight entry for database usage:
// - mdb: master (shared) DB — tenants registry, app settings, core tables (features, plans, subs, activations)
// - db:  tenant DB — per-tenant queries (supports DEFAULT_TENANT)
// - profile: direct profile-based queries via connection_manager
//
// Also provides:
// - prewarm(): ensure master engine & core tables are ready at boot
// - prewarmProfiles([...]): optional — ping named profiles
// - prewarmTenants([...]): optional — ping listed tenants (opens & closes)

import { mdb as _mdb, db as _db } from "./db";
import * as cm from "./connection_manager";
import type { Engine } from "./Engine";

/* ----------------------------------------
 * Public API objects
 * ---------------------------------------- */

// -------------------- Master (shared) DB API --------------------
export const mdb = {
    // SQL helpers
    query: _mdb.query,
    fetchOne: _mdb.fetchOne,
    fetchAll: _mdb.fetchAll,

    // Transaction helpers
    with: _mdb.with,
    tx: _mdb.withTx,

    // Health
    healthz: _mdb.healthz,
};

// -------------------- Tenant DB API (by tenantId or DEFAULT_TENANT) --------------------
export const db = {
    // SQL helpers (overloads: tenantId?, sql, params)
    query: _db.query,
    fetchOne: _db.fetchOne,
    fetchAll: _db.fetchAll,
    execMany: _db.execMany,

    // Transaction helpers (overloads support DEFAULT_TENANT)
    with: _db.with,
    tx: _db.withTx,

    // Health
    healthz: _db.healthz,
};

// -------------------- Profile-based API (via connection_manager) --------------------
export const profile = {
    // Prepare & run a single statement
    async query(profileName: string, sql: string, params?: unknown) {
        return cm.execute(profileName, sql, params);
    },
    async fetchOne<T = any>(profileName: string, sql: string, params?: unknown): Promise<T | null> {
        return cm.fetchOne<T>(profileName, sql, params);
    },
    async fetchAll<T = any>(profileName: string, sql: string, params?: unknown): Promise<T[]> {
        return cm.fetchAll<T>(profileName, sql, params);
    },
    async execMany(profileName: string, sql: string, paramSets: unknown[]) {
        return cm.executeMany(profileName, sql, paramSets);
    },

    // Transaction against a named profile using the underlying Engine
    async tx<T>(profileName: string, fn: (engine: Engine) => Promise<T>): Promise<T> {
        const engine = await cm.prepareEngine(profileName);
        await engine.begin();
        try {
            const result = await fn(engine);
            await engine.commit();
            return result;
        } catch (err) {
            try { await engine.rollback(); } catch {}
            throw err;
        }
    },

    // Health
    async healthz(profileName: string): Promise<boolean> {
        return cm.testConnection(profileName);
    },
};

/* ----------------------------------------
 * Prewarm helpers
 * ---------------------------------------- */

// Call this at app boot to ensure master engine & core tables are ready.
export async function prewarm(): Promise<void> {
    await mdb.healthz(); // triggers core table ensure via db.ts -> withShared
}

// Optional: check multiple profiles at boot
export async function prewarmProfiles(names: string[]): Promise<void> {
    const tasks = names.map((n) => profile.healthz(n).catch(() => false));
    await Promise.allSettled(tasks);
}

// Optional: check multiple tenants at boot (opens & closes one-by-one)
export async function prewarmTenants(tenantIds: string[]): Promise<void> {
    const tasks = tenantIds.map((t) => db.healthz(t).catch(() => false));
    await Promise.allSettled(tasks);
}

/* ----------------------------------------
 * Global exposure (optional)
 * ---------------------------------------- */

// Avoid TS2502 by using type aliases that don't self-reference.
export type MdbAPI = typeof _mdb;
export type DbAPI = typeof _db;
export type ProfileAPI = {
    query: (profileName: string, sql: string, params?: unknown) => Promise<any>;
    fetchOne: <T = any>(profileName: string, sql: string, params?: unknown) => Promise<T | null>;
    fetchAll: <T = any>(profileName: string, sql: string, params?: unknown) => Promise<T[]>;
    execMany: (profileName: string, sql: string, paramSets: unknown[]) => Promise<any>;
    tx: <T>(profileName: string, fn: (engine: Engine) => Promise<T>) => Promise<T>;
    healthz: (profileName: string) => Promise<boolean>;
};

// Enable by setting DB_GLOBALS=1 (default: off).
declare global {
    // eslint-disable-next-line no-var
    let mdb: MdbAPI | undefined;
    // eslint-disable-next-line no-var
    let db: DbAPI | undefined;
    // eslint-disable-next-line no-var
    let dbProfile: ProfileAPI | undefined;
}
if (process.env.DB_GLOBALS === "1") {
    (globalThis as any).mdb = mdb;
    (globalThis as any).db = db;
    (globalThis as any).dbProfile = profile as ProfileAPI;
}

/* ----------------------------------------
 * Re-exports
 * ---------------------------------------- */
export type { Engine } from "./Engine";
export { mdb as masterDb, db as tenantDb };
export default { mdb, db, profile, prewarm, prewarmProfiles, prewarmTenants };

/* ================================================================================================
 * USAGE
 * ================================================================================================
 *
 * // 0) Prewarm at application startup (recommended)
 * import { prewarm, prewarmProfiles, prewarmTenants } from "@/cortex/database";
 *
 * await prewarm();                        // ensures master engine + core tables
 * await prewarmProfiles(["BLUE"]);        // optional: prepare a named profile
 * await prewarmTenants(["acme", "5"]);    // optional: sanity-check tenant DBs
 *
 * // 1) Master / Shared DB (tenants registry + core tables)
 * import { mdb } from "@/cortex/database";
 *
 * const rows = await mdb.query("SELECT key FROM app_settings");
 * const one  = await mdb.fetchOne<{ id: string; key: string }>(
 *   "SELECT id, key FROM app_settings WHERE key = ?",
 *   ["app_version"]
 * );
 *
 * await mdb.tx(async (conn) => {
 *   await conn.Query(
 *     "INSERT INTO tenants (tenant_id, driver, db_name) VALUES (?, ?, ?)",
 *     ["acme", "sqlite", "./data/tenant-acme.sqlite"]
 *   );
 * });
 *
 * // 2) Tenant DB (supports DEFAULT_TENANT)
 * // .env: DEFAULT_TENANT=5
 * import { db } from "@/cortex/database";
 *
 * const users = await db.fetchAll("SELECT * FROM users WHERE active = 1");
 * const user  = await db.fetchOne("SELECT * FROM users WHERE id = ?", [123]);
 *
 * await db.tx(async (conn) => {
 *   await conn.Query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [123]);
 * });
 *
 * // Explicit tenant id
 * const orders = await db.fetchAll("acme", "SELECT * FROM orders WHERE status = ?", ["open"]);
 * await db.tx("acme", async (conn) => {
 *   await conn.Query("INSERT INTO orders (ref, amount) VALUES (?, ?)", ["#X1", 99.5]);
 * });
 *
 * // 3) Profile-based Access (named profiles via connection_manager)
 * import { profile } from "@/cortex/database";
 *
 * const row = await profile.fetchOne<{ now: string }>("BLUE", "SELECT NOW()");
 * const list = await profile.fetchAll("SANDBOX", "SELECT * FROM items LIMIT 10");
 *
 * await profile.tx("BLUE", async (engine) => {
 *   await engine.execute("INSERT INTO events(type) VALUES (?)", ["login"]);
 * });
 */
