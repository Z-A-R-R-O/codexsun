// cortex/database/db.ts
// Entry point for multi-tenant, high-concurrency database access.
// - Master DB (MDB_*) holds core tables
// - Per-tenant DBs are provisioned on-demand, executed, and closed
// - Concurrency per-tenant and for shared operations is capped via a lightweight semaphore

import type { Engine } from "./Engine";
import { makeConfigKey, type DBConfig, type DBDriver } from "./types";
import * as cm from "./connection_manager";
import { getDbConfig } from "./getDbConfig";
import * as core from "./core_table";

// Engines for per-tenant ephemeral connections
import { SqliteEngine } from "./engines/sqlite_engine";
import { PostgresEngine } from "./engines/postgres_engine";
import { MariaDBEngine } from "./engines/mariadb_engine";
import { MysqlEngine } from "./engines/mysql_engine";

/* ------------------------------------------------------------------------------------------------
 * Types / shapes
 * ---------------------------------------------------------------------------------------------- */
export type Profile = "default" | (string & {});

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
 * Env-based tenant config
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
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { MongoDBEngine } = require("./engines/mongodb_engine");
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
    await core.run(); // ensure core tables

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

/* ------------------------------------------------------------------------------------------------
 * Public API – Tenant helpers (uses env or DEFAULT_TENANT)
 * ---------------------------------------------------------------------------------------------- */
export async function withTenant<T>(tenantId: string, fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenant<T>(fn: (conn: ConnFacade) => Promise<T>): Promise<T>;
export async function withTenant<T>(a: any, b?: any): Promise<T> {
    const tenantId = typeof a === "string" ? a : mustTenantId(undefined);
    const fn: (conn: ConnFacade) => Promise<T> = typeof a === "string" ? b : a;

    const sem = getSemaphore(`tenant:${tenantId}`, false);
    return sem.run(async () => {
        const cfg = buildEnvTenantConfig(tenantId);
        if (!cfg) {
            throw new Error(
                `Unknown tenant '${tenantId}'. Set TENANT_${tenantId}_DB_URL (or DB_URL/DB_* envs).`
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
