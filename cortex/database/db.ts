// cortex/database/db.ts
// Entry point for multi-tenant, high-concurrency database access.
// - Master DB (MDB_*) holds core tables + tenant registry table `tenants`
// - Per-tenant DBs are provisioned on-demand, executed, and closed
// - Concurrency per-tenant and for shared operations is capped via a lightweight semaphore

import type { Engine } from "./Engine";
import { makeConfigKey, type DBConfig, type DBDriver } from "./types";
import * as cm from "./connection_manager";
import { getDbConfig } from "./getDbConfig";
import * as core from "./core_table"; // <-- wire core tables (features, plans, subscriptions, app_settings, activations)

// Engines for per-tenant ephemeral connections
import { SqliteEngine } from "./engines/sqlite_engine";
import { PostgresEngine } from "./engines/postgres_engine";
import { MariaDBEngine } from "./engines/mariadb_engine";
import { MysqlEngine } from "./engines/mysql_engine";

/* ------------------------------------------------------------------------------------------------
 * Types / shapes
 * ---------------------------------------------------------------------------------------------- */
export type Profile = "default" | (string & {});

/** Row in the master tenant registry */
interface TenantRow {
    tenant_id: string;            // business key for tenant
    driver: DBDriver;             // postgres/mysql/mariadb/sqlite/mongodb
    host?: string | null;
    port?: number | null;
    db_name: string;
    ssl?: number | null;          // 0/1
    params_json?: string | null;  // extra driver params e.g. { url: "postgres://..." }
    pool_min?: number | null;
    pool_max?: number | null;
    pool_idle_ms?: number | null;
    pool_acquire_timeout_ms?: number | null;
}

/** Minimal connection façade for consumers */
export interface ConnFacade {
    Engine: () => Engine;
    Query: (sql: string, params?: unknown) => Promise<any>;
    FetchOne: <T = any>(sql: string, params?: unknown) => Promise<T | null>;
    FetchAll: <T = any>(sql: string, params?: unknown) => Promise<T[]>;
    ExecuteMany: (sql: string, sets: unknown[]) => Promise<any>;
    Begin: () => Promise<void>;
    Commit: () => Promise<void>;
    Rollback: () => Promise<void>;
    Healthz: () => Promise<boolean>;
}

/* ------------------------------------------------------------------------------------------------
 * Lightweight Semaphore for concurrency capping
 * ---------------------------------------------------------------------------------------------- */
class Semaphore {
    private max: number;
    private queue: Array<() => void> = [];
    private inUse = 0;

    constructor(max: number) {
        if (!Number.isFinite(max) || max < 1) throw new Error("Semaphore requires max >= 1");
        this.max = Math.floor(max);
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.inUse < this.max) {
            this.inUse++;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.queue.push(resolve));
    }

    private release() {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.inUse = Math.max(0, this.inUse - 1);
        }
    }
}

/* ------------------------------------------------------------------------------------------------
 * Concurrency caps (env)
 * ---------------------------------------------------------------------------------------------- */
function intFromEnv(name: string, fallback?: number): number | undefined {
    const raw = process.env[name];
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}
const HARD_CAP = 60;
const DEFAULT_CAP = 30;
function clampCap(n?: number): number {
    const v = n ?? DEFAULT_CAP;
    return Math.max(1, Math.min(HARD_CAP, Math.floor(v)));
}
function getSharedCap(): number {
    const n = intFromEnv("DB_MAX_CONCURRENCY_SHARED", intFromEnv("DB_MAX_CONCURRENCY", DEFAULT_CAP));
    return clampCap(n);
}
function getTenantCap(): number {
    const n = intFromEnv("DB_MAX_CONCURRENCY_TENANT", intFromEnv("DB_MAX_CONCURRENCY", DEFAULT_CAP));
    return clampCap(n);
}
// Semaphores per key ("shared" or `tenant:<id>`)
const semaphores = new Map<string, Semaphore>();
function getSemaphore(key: string, isShared: boolean): Semaphore {
    let s = semaphores.get(key);
    if (!s) {
        s = new Semaphore(isShared ? getSharedCap() : getTenantCap());
        semaphores.set(key, s);
    }
    return s;
}

/* ------------------------------------------------------------------------------------------------
 * DEFAULT tenant helper
 * ---------------------------------------------------------------------------------------------- */
function getDefaultTenantId(): string | undefined {
    const v = process.env.DEFAULT_TENANT;
    return v && String(v).trim() ? String(v).trim() : undefined;
}
function mustTenantId(explicit?: string): string {
    const tid = explicit ?? getDefaultTenantId();
    if (!tid) {
        throw new Error("Tenant id required. Pass a tenantId or set DEFAULT_TENANT in environment.");
    }
    return tid;
}

/* ------------------------------------------------------------------------------------------------
 * Master (MDB) tenants registry helpers
 * ---------------------------------------------------------------------------------------------- */
let ensuredTenantsTable = false;

async function ensureTenantTable(): Promise<void> {
    if (ensuredTenantsTable) return;
    const ddl = `CREATE TABLE IF NOT EXISTS tenants (
                                                        tenant_id TEXT PRIMARY KEY,
                                                        driver TEXT NOT NULL CHECK (driver IN ('postgres','mysql','mariadb','sqlite','mongodb')),
        host TEXT,
        port INTEGER,
        db_name TEXT NOT NULL,
        ssl INTEGER DEFAULT 0,
        params_json TEXT,
        pool_min INTEGER,
        pool_max INTEGER,
        pool_idle_ms INTEGER,
        pool_acquire_timeout_ms INTEGER,
        updated_at TEXT DEFAULT (datetime('now'))
        );`;
    await withShared((conn) => conn.Query(ddl));
    ensuredTenantsTable = true;
}

async function getTenantRow(tenantId: string): Promise<TenantRow | null> {
    await ensureTenantTable();
    const row = await fetchOneShared<TenantRow>(
        `SELECT tenant_id, driver, host, port, db_name, ssl,
                params_json, pool_min, pool_max, pool_idle_ms, pool_acquire_timeout_ms
         FROM tenants WHERE tenant_id = ?`,
        [tenantId]
    );
    return row ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Env-based tenant fallback
 * ---------------------------------------------------------------------------------------------- */
function parseBool(v: string | undefined): boolean | undefined {
    if (v == null) return undefined;
    const s = String(v).toLowerCase().trim();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return undefined;
}

function buildEnvTenantConfig(tenantId: string): DBConfig | null {
    const p = (name: string) => process.env[`TENANT_${tenantId}_DB_${name}`];
    const g = (name: string) => process.env[`DB_${name}`];

    const url = p("URL") ?? g("URL");
    let driver = (p("DRIVER") ?? g("DRIVER")) as DBDriver | undefined;

    if (!driver && url) {
        const m = url.match(/^([a-z0-9+]+):/i);
        if (m) {
            const scheme = m[1].toLowerCase();
            if (scheme.startsWith("postgres")) driver = "postgres";
            else if (scheme.startsWith("mysql")) driver = "mysql";
            else if (scheme.startsWith("mariadb")) driver = "mariadb";
            else if (scheme.startsWith("mongodb") || scheme.startsWith("mongo")) driver = "mongodb";
            else if (scheme.startsWith("sqlite")) driver = "sqlite";
        }
    }

    const file = p("FILE") ?? g("FILE") ?? g("NAME");
    const host = p("HOST") ?? g("HOST");
    const portStr = p("PORT") ?? g("PORT");
    const user = p("USER") ?? g("USER");
    const password = p("PASS") ?? g("PASS") ?? p("PASSWORD") ?? g("PASSWORD");
    const database = p("NAME") ?? g("NAME");
    const ssl = parseBool(p("SSL") ?? g("SSL"));

    if (!url && !driver && !host && !file && !database) return null;

    if (!driver && (file || (database && (!host && !user)))) {
        driver = "sqlite";
    }

    const base: any = {
        profile: `tenant:${tenantId}:env`,
        driver,
        database,
    };

    if (url) base.url = url;
    if (file && (!database || driver === "sqlite")) base.database = file;
    if (host) base.host = host;
    if (portStr) {
        const port = Number(portStr);
        if (Number.isFinite(port)) base.port = port;
    }
    if (user) base.user = user;
    if (password) base.password = password;
    if (ssl !== undefined) base.ssl = ssl;

    base.cfgKey = makeConfigKey(base);
    return base as DBConfig;
}

/* ------------------------------------------------------------------------------------------------
 * Engine factory (per-tenant ephemeral)
 * ---------------------------------------------------------------------------------------------- */
function makeTenantConfig(tenant: TenantRow): DBConfig {
    const profile = `tenant:${tenant.tenant_id}`;
    const base: any = {
        profile,
        driver: tenant.driver,
        host: tenant.host ?? undefined,
        port: tenant.port ?? undefined,
        database: tenant.db_name,
        ssl: tenant.ssl ? true : undefined,
        pool: {
            min: tenant.pool_min ?? undefined,
            max: tenant.pool_max ?? undefined,
            idleMillis: tenant.pool_idle_ms ?? undefined,
            acquireTimeoutMillis: tenant.pool_acquire_timeout_ms ?? undefined,
        },
    };

    if (tenant.params_json) {
        try {
            const extra = JSON.parse(tenant.params_json);
            Object.assign(base, extra);
            if (extra.pool && typeof extra.pool === "object") {
                Object.assign(base.pool, extra.pool);
            }
        } catch {
            // ignore malformed JSON
        }
    }

    base.cfgKey = makeConfigKey(base);
    return base as DBConfig;
}

function buildEngine(cfg: DBConfig): Engine {
    switch (cfg.driver) {
        case "sqlite":
            return new SqliteEngine(cfg as any);
        case "postgres":
            return new PostgresEngine(cfg as any);
        case "mariadb":
            return new MariaDBEngine(cfg as any);
        case "mysql":
            return new MysqlEngine(cfg as any);
        case "mongodb": {
            // Optional/dynamic load to avoid build-time dependency if not present yet
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const modPath = "./engines/mongodb_engine";
            try {
                // @ts-ignore - optional dependency
                const { MongoDBEngine } = require(modPath);
                return new MongoDBEngine(cfg as any);
            } catch {
                throw new Error(
                    "MongoDB driver selected but MongoDB engine not found. Please add cortex/database/engines/mongodb_engine.ts exporting MongoDBEngine."
                );
            }
        }
        default: {
            const _exhaustive: never = cfg.driver as never;
            throw new Error(`Unsupported driver: ${String(_exhaustive)}`);
        }
    }
}

/* ------------------------------------------------------------------------------------------------
 * Public API – Shared (master) helpers
 * ---------------------------------------------------------------------------------------------- */
export async function withShared<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T> {
    // Ensure core master tables exist before any shared operation
    await core.run();

    const sem = getSemaphore("shared", true);
    return sem.run(async () => {
        const engine = await cm.prepareEngine("default");
        const conn: ConnFacade = {
            Engine: () => engine,
            Query: async (sql, params) => engine.execute(sql, params),
            FetchOne: async <T = any>(sql: string, params?: unknown) => engine.fetchOne<T>(sql, params),
            FetchAll: async <T = any>(sql: string, params?: unknown) => engine.fetchAll<T>(sql, params),
            ExecuteMany: async (sql, sets) => engine.executeMany(sql, sets),
            Begin: async () => { await engine.begin(); },
            Commit: async () => { await engine.commit(); },
            Rollback: async () => { await engine.rollback(); },
            Healthz: async () => engine.testConnection(),
        };
        return fn(conn);
    });
}

export async function withSharedTx<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T> {
    return withShared(async (conn) => {
        await conn.Begin();
        try {
            const result = await fn(conn);
            await conn.Commit();
            return result;
        } catch (err) {
            try { await conn.Rollback(); } catch {}
            throw err;
        }
    });
}

export async function queryShared(sql: string, params?: unknown): Promise<any> {
    return withShared((c) => c.Query(sql, params));
}
export async function fetchOneShared<T = any>(sql: string, params?: unknown): Promise<T | null> {
    return withShared((c) => c.FetchOne<T>(sql, params));
}
export async function fetchAllShared<T = any>(sql: string, params?: unknown): Promise<T[]> {
    return withShared((c) => c.FetchAll<T>(sql, params));
}
export async function healthzShared(): Promise<boolean> {
    return withShared((c) => c.Healthz());
}

/* ------------------------------------------------------------------------------------------------
 * Public API – Tenant helpers (supports DEFAULT_TENANT)
 * ---------------------------------------------------------------------------------------------- */
// Overloads allow omitting tenantId when DEFAULT_TENANT is set
export async function withTenant<T>(tenantId: string, fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenant<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenant<T>(a: any, b?: any): Promise<T> {
    const tenantId = typeof a === "string" ? a : mustTenantId(undefined);
    const fn: (conn: ConnFacade) => Promise<T> = typeof a === "string" ? b : a;

    const sem = getSemaphore(`tenant:${tenantId}`, false);
    return sem.run(async () => {
        const row = await getTenantRow(tenantId);
        const cfg = row ? makeTenantConfig(row) : buildEnvTenantConfig(tenantId);
        if (!cfg) {
            throw new Error(
                `Unknown tenant '${tenantId}'. Add a row in 'tenants' table or set TENANT_${tenantId}_DB_URL (or DB_URL/DB_* envs).`
            );
        }

        const engine = buildEngine(cfg);
        await engine.connect();
        try {
            const conn: ConnFacade = {
                Engine: () => engine,
                Query: async (sql, params) => engine.execute(sql, params),
                FetchOne: async <T = any>(sql: string, params?: unknown) => engine.fetchOne<T>(sql, params),
                FetchAll: async <T = any>(sql: string, params?: unknown) => engine.fetchAll<T>(sql, params),
                ExecuteMany: async (sql, sets) => engine.executeMany(sql, sets),
                Begin: async () => { await engine.begin(); },
                Commit: async () => { await engine.commit(); },
                Rollback: async () => { await engine.rollback(); },
                Healthz: async () => engine.testConnection(),
            };
            return await fn(conn);
        } finally {
            await engine.close();
        }
    });
}

export async function withTenantTx<T>(tenantId: string, fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenantTx<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenantTx<T>(a: any, b?: any): Promise<T> {
    const tenantId = typeof a === "string" ? a : undefined;
    const fn: (conn: ConnFacade) => Promise<T> = typeof a === "string" ? b : a;

    return withTenant<T>(tenantId ?? mustTenantId(undefined), async (conn) => {
        await conn.Begin();
        try {
            const result = await fn(conn);
            await conn.Commit();
            return result;
        } catch (err) {
            try { await conn.Rollback(); } catch {}
            throw err;
        }
    });
}

export async function queryTenant(tenantId: string, sql: string, params?: unknown): Promise<any>;
export async function queryTenant(sql: string, params?: unknown): Promise<any>;
export async function queryTenant(a: any, b?: any, c?: any): Promise<any> {
    const hasTenant = typeof a === "string" && typeof b === "string";
    const tenantId = hasTenant ? a : mustTenantId(undefined);
    const sql = hasTenant ? b : a;
    const params = hasTenant ? c : b;
    return withTenant(tenantId, (cconn) => cconn.Query(sql, params));
}

export async function fetchOneTenant<T = any>(tenantId: string, sql: string, params?: unknown): Promise<T | null>;
export async function fetchOneTenant<T = any>(sql: string, params?: unknown): Promise<T | null>;
export async function fetchOneTenant<T = any>(a: any, b?: any, c?: any): Promise<T | null> {
    const hasTenant = typeof a === "string" && typeof b === "string";
    const tenantId = hasTenant ? a : mustTenantId(undefined);
    const sql = hasTenant ? b : a;
    const params = hasTenant ? c : b;
    return withTenant(tenantId, (cconn) => cconn.FetchOne<T>(sql, params));
}

export async function fetchAllTenant<T = any>(tenantId: string, sql: string, params?: unknown): Promise<T[]>;
export async function fetchAllTenant<T = any>(sql: string, params?: unknown): Promise<T[]>;
export async function fetchAllTenant<T = any>(a: any, b?: any, c?: any): Promise<T[]> {
    const hasTenant = typeof a === "string" && typeof b === "string";
    const tenantId = hasTenant ? a : mustTenantId(undefined);
    const sql = hasTenant ? b : a;
    const params = hasTenant ? c : b;
    return withTenant(tenantId, (cconn) => cconn.FetchAll<T>(sql, params));
}

export async function execManyTenant(tenantId: string, sql: string, paramSets: unknown[]): Promise<any>;
export async function execManyTenant(sql: string, paramSets: unknown[]): Promise<any>;
export async function execManyTenant(a: any, b: any, c?: any): Promise<any> {
    const hasTenant = typeof a === "string" && typeof b === "string";
    const tenantId = hasTenant ? a : mustTenantId(undefined);
    const sql = hasTenant ? b : a;
    const sets = hasTenant ? c : b;
    return withTenant(tenantId, (cconn) => cconn.ExecuteMany(sql, sets));
}

export async function healthzTenant(tenantId?: string): Promise<boolean> {
    const tid = mustTenantId(tenantId);
    return withTenant(tid, (cconn) => cconn.Healthz());
}

/* ------------------------------------------------------------------------------------------------
 * Facade namespaces: mdb (master/shared) and db (tenant)
 * ---------------------------------------------------------------------------------------------- */
const mdb = {
    with: withShared,
    withTx: withSharedTx,
    query: queryShared,
    fetchOne: fetchOneShared,
    fetchAll: fetchAllShared,
    healthz: healthzShared,
};

const db = {
    with: withTenant,
    withTx: withTenantTx,
    query: queryTenant,
    fetchOne: fetchOneTenant,
    fetchAll: fetchAllTenant,
    execMany: execManyTenant,
    healthz: healthzTenant,
};

/* ------------------------------------------------------------------------------------------------
 * Teardown helpers
 * ---------------------------------------------------------------------------------------------- */
export async function teardownAll(): Promise<void> {
    await cm.teardownAll();
    semaphores.clear();
    ensuredTenantsTable = false;
}
export async function teardown(): Promise<void> {
    return teardownAll();
}

/* ------------------------------------------------------------------------------------------------
 * Boot-time assertion: prefer MDB_* for master, else warn
 * ---------------------------------------------------------------------------------------------- */
(function assertSharedDriver() {
    try {
        const shared = getDbConfig("default"); // strictly MDB_*
        if (shared.driver !== "sqlite") {
            // Only a warning: you can point master at Postgres/MySQL if you prefer.
            console.warn(
                `[db.ts] Master DB driver is '${shared.driver}'. For quick-start dev, MDB_DRIVER=sqlite with MDB_FILE=./data/dev.sqlite is recommended.`
            );
        }
    } catch {
        // Ignore at import-time if envs not ready.
    }
})();

// Final explicit export for API consumption
export { mdb, db };
