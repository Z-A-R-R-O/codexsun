// cortex/database/db.ts
// Entry point for multi-tenant, high-concurrency database access.

import type { Engine } from "./Engine";
import { makeConfigKey, type DBConfig, type DBDriver } from "./types";
import * as cm from "./connection_manager";
import { getDbConfig } from "./getDbConfig";
import * as core from "./core_table";

import { SqliteEngine } from "./engines/sqlite_engine";
import { PostgresEngine } from "./engines/postgres_engine";
import { MariaDBEngine } from "./engines/mariadb_engine";
import { MysqlEngine } from "./engines/mysql_engine";

/* ------------------------------------------------------------------------------------------------
 * Types / shapes
 * ---------------------------------------------------------------------------------------------- */
export type Profile = "default" | (string & {});

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
 * Semaphore
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
        if (next) next();
        else this.inUse = Math.max(0, this.inUse - 1);
    }
}

/* ------------------------------------------------------------------------------------------------
 * Concurrency caps
 * ---------------------------------------------------------------------------------------------- */
const HARD_CAP = 60;
const DEFAULT_CAP = 30;
function clampCap(n?: number): number {
    const v = n ?? DEFAULT_CAP;
    return Math.max(1, Math.min(HARD_CAP, Math.floor(v)));
}
function getSharedCap(): number {
    const raw = process.env.DB_MAX_CONCURRENCY_SHARED ?? process.env.DB_MAX_CONCURRENCY;
    return clampCap(raw ? Number(raw) : DEFAULT_CAP);
}
function getTenantCap(): number {
    const raw = process.env.DB_MAX_CONCURRENCY_TENANT ?? process.env.DB_MAX_CONCURRENCY;
    return clampCap(raw ? Number(raw) : DEFAULT_CAP);
}
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
 * Tenant helpers
 * ---------------------------------------------------------------------------------------------- */
function getDefaultTenantId(): string | undefined {
    const v = process.env.DEFAULT_TENANT;
    return v && String(v).trim() ? String(v).trim() : undefined;
}
function mustTenantId(explicit?: string): string {
    const tid = explicit ?? getDefaultTenantId();
    if (!tid) throw new Error("Tenant id required. Pass a tenantId or set DEFAULT_TENANT in environment.");
    return tid;
}

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
            else if (scheme.startsWith("mongodb")) driver = "mongodb";
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
    if (!driver && (file || (database && (!host && !user)))) driver = "sqlite";

    const base: any = { profile: `tenant:${tenantId}:env`, driver, database };
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

function buildEngine(cfg: DBConfig): Engine {
    switch (cfg.driver) {
        case "sqlite": return new SqliteEngine(cfg as any);
        case "postgres": return new PostgresEngine(cfg as any);
        case "mariadb": return new MariaDBEngine(cfg as any);
        case "mysql": return new MysqlEngine(cfg as any);
        case "mongodb": {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { MongoDBEngine } = require("./engines/mongodb_engine");
            return new MongoDBEngine(cfg as any);
        }
        default: {
            const _exhaustive: never = cfg.driver as never;
            throw new Error(`Unsupported driver: ${String(_exhaustive)}`);
        }
    }
}

/* ------------------------------------------------------------------------------------------------
 * Shared facade
 * ---------------------------------------------------------------------------------------------- */
export async function withShared<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T> {
    await core.run();
    const sem = getSemaphore("shared", true);
    return sem.run(async () => {
        const engine = await cm.prepareEngine("default");
        const conn: ConnFacade = {
            Engine: () => engine,
            Query: (sql, params) => Promise.resolve(engine.execute(sql, params)),
            FetchOne: (sql, params) => Promise.resolve(engine.fetchOne(sql, params)),
            FetchAll: (sql, params) => Promise.resolve(engine.fetchAll(sql, params)),
            ExecuteMany: (sql, sets) => Promise.resolve(engine.executeMany(sql, sets)),
            Begin: () => Promise.resolve(engine.begin()),
            Commit: () => Promise.resolve(engine.commit()),
            Rollback: () => Promise.resolve(engine.rollback()),
            Healthz: () => Promise.resolve(engine.testConnection()),
        };
        return fn(conn);
    });
}

/* ------------------------------------------------------------------------------------------------
 * Tenant facade
 * ---------------------------------------------------------------------------------------------- */
export async function withTenant<T>(tenantId: string, fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenant<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenant<T>(a: any, b?: any): Promise<T> {
    const tenantId = typeof a === "string" ? a : mustTenantId(undefined);
    const fn: (conn: ConnFacade) => Promise<T> = typeof a === "string" ? b : a;
    const sem = getSemaphore(`tenant:${tenantId}`, false);
    return sem.run(async () => {
        const cfg = buildEnvTenantConfig(tenantId);
        if (!cfg) throw new Error(`Unknown tenant '${tenantId}'. Set TENANT_${tenantId}_DB_URL (or DB_URL/DB_* envs).`);
        const engine = buildEngine(cfg);
        await engine.connect();
        try {
            const conn: ConnFacade = {
                Engine: () => engine,
                Query: (sql, params) => Promise.resolve(engine.execute(sql, params)),
                FetchOne: (sql, params) => Promise.resolve(engine.fetchOne(sql, params)),
                FetchAll: (sql, params) => Promise.resolve(engine.fetchAll(sql, params)),
                ExecuteMany: (sql, sets) => Promise.resolve(engine.executeMany(sql, sets)),
                Begin: () => Promise.resolve(engine.begin()),
                Commit: () => Promise.resolve(engine.commit()),
                Rollback: () => Promise.resolve(engine.rollback()),
                Healthz: () => Promise.resolve(engine.testConnection()),
            };
            return await fn(conn);
        } finally {
            await engine.close();
        }
    });
}

/* ------------------------------------------------------------------------------------------------
 * Facade namespaces
 * ---------------------------------------------------------------------------------------------- */
const mdb = {
    with: withShared,
    query: (sql: string, params?: unknown) => withShared((c) => c.Query(sql, params)),
    fetchOne: (sql: string, params?: unknown) => withShared((c) => c.FetchOne(sql, params)),
    fetchAll: (sql: string, params?: unknown) => withShared((c) => c.FetchAll(sql, params)),
    healthz: () => withShared((c) => c.Healthz()),
};

const db = {
    with: withTenant,
    query: (tenantId: string, sql: string, params?: unknown) =>
        withTenant(tenantId, (c) => c.Query(sql, params)),
    fetchOne: (tenantId: string, sql: string, params?: unknown) =>
        withTenant(tenantId, (c) => c.FetchOne(sql, params)),
    fetchAll: (tenantId: string, sql: string, params?: unknown) =>
        withTenant(tenantId, (c) => c.FetchAll(sql, params)),
    execMany: (tenantId: string, sql: string, sets: unknown[]) =>
        withTenant(tenantId, (c) => c.ExecuteMany(sql, sets)),
    healthz: (tenantId?: string) => withTenant(tenantId ?? mustTenantId(), (c) => c.Healthz()),
};

/* ------------------------------------------------------------------------------------------------
 * Init helper
 * ---------------------------------------------------------------------------------------------- */
export async function initDb() {
    const engine = await cm.prepareEngine("default");
    await core.run(); // seeds app_settings too
    return engine;
}

/* ------------------------------------------------------------------------------------------------
 * Boot-time assertion
 * ---------------------------------------------------------------------------------------------- */
(function assertSharedDriver() {
    try {
        const shared = getDbConfig("default");
        if (shared.driver !== "sqlite") {
            console.warn(`[db.ts] Master DB driver is '${shared.driver}'. For dev, use MDB_DRIVER=sqlite with MDB_FILE=./data/dev.sqlite`);
        }
    } catch {}
})();

/* ------------------------------------------------------------------------------------------------
 * Export API
 * ---------------------------------------------------------------------------------------------- */
export { mdb, db };
