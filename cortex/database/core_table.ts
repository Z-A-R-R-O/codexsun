// cortex/database/core_table.ts

import * as cm from "./connection_manager";
import type { Engine } from "./Engine";
import crypto from "node:crypto";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

function genId(): string {
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 10);
    return `${ts}${rnd}`;
}
export { genId };

function sha1(input: string): string {
    return crypto.createHash("sha1").update(input).digest("hex");
}

async function backfillIds(engine: Engine, table: string, idCol = "id"): Promise<void> {
    const rows = await engine.fetchAll<{ rowid: number }>(
        `SELECT rowid FROM ${table} WHERE ${idCol} IS NULL OR ${idCol} = ''`
    );
    for (const r of rows) {
        const id = genId();
        await engine.execute(`UPDATE ${table} SET ${idCol} = ? WHERE rowid = ?`, [id, r.rowid]);
    }
}

async function recordMeta(
    engine: Engine,
    name: string,
    ddl: string,
    protectedCore = true
): Promise<void> {
    const hash = sha1(ddl);
    await engine.execute(
        `INSERT INTO __core_meta (id, name, version, hash, status, protected, installed_at)
         VALUES (?, ?, '1.0', ?, 'applied', ?, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
            version = '1.0',
            hash = excluded.hash,
            status = 'applied',
            protected = excluded.protected,
            installed_at = datetime('now')`,
        [genId(), name, hash, protectedCore ? 1 : 0]
    );
}

/* ------------------------------------------------------------------------------------------------
 * Logging wrapper
 * ---------------------------------------------------------------------------------------------- */

function withLogging(engine: Engine): Engine {
    return {
        ...engine, // keep all original properties
        execute: async (sql: string, params?: any[]) => {
            console.log("[SQL EXECUTE]", sql.trim(), params ?? []);
            return engine.execute(sql, params);
        },
        fetchOne: async <T>(sql: string, params?: any[]) => {
            console.log("[SQL FETCH ONE]", sql.trim(), params ?? []);
            return engine.fetchOne<T>(sql, params);
        },
        fetchAll: async <T>(sql: string, params?: any[]) => {
            console.log("[SQL FETCH ALL]", sql.trim(), params ?? []);
            return engine.fetchAll<T>(sql, params);
        },
    };
}

/* ------------------------------------------------------------------------------------------------
 * Ensure DDL
 * ---------------------------------------------------------------------------------------------- */

let ensured = false;

/* ------------------------------ __core_meta ------------------------------ */
async function ensureCoreMeta(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS __core_meta (
                                                   id             TEXT PRIMARY KEY,
                                                   name           TEXT UNIQUE NOT NULL,
                                                   version        TEXT,
                                                   hash           TEXT,
                                                   status         TEXT,
                                                   protected      INTEGER DEFAULT 1,
                                                   installed_at   TEXT DEFAULT (datetime('now')),
            rolled_back_at TEXT
            );
    `;
    await db.execute(ddl);
    await recordMeta(db, "__core_meta", ddl, true);
}

/* ------------------------------ tenants ------------------------------ */
async function ensureTenants(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS tenants (
                                               id TEXT PRIMARY KEY,
                                               name TEXT UNIQUE NOT NULL,
                                               reference TEXT,
                                               mobile TEXT,
                                               email TEXT,
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
            is_active INTEGER DEFAULT 1,
            updated_at TEXT DEFAULT (datetime('now'))
            );
    `;
    await db.execute(ddl);

    const driver =
        process.env.DB_DRIVER && process.env.DB_DRIVER.trim() !== ""
            ? process.env.DB_DRIVER
            : "sqlite";
    const host = process.env.DB_HOST && process.env.DB_HOST.trim() !== "" ? process.env.DB_HOST : null;
    const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : null;
    const dbName =
        process.env.DB_NAME && process.env.DB_NAME.trim() !== ""
            ? process.env.DB_NAME
            : "codexsun_db";
    const ssl = process.env.DB_SSL === "true" ? 1 : 0;
    const user = process.env.DB_USER ?? null;
    const pass = process.env.DB_PASS ?? null;
    const params = JSON.stringify({ user, pass });

    console.log("[TENANTS ENV]", { driver, host, port, dbName, ssl, user, pass });

    const id = "tenant_default"; // fixed ID for default tenant
    await db.execute(
        `INSERT INTO tenants (id, name, driver, host, port, db_name, ssl, params_json, is_active, updated_at)
         VALUES (?, 'Default Tenant', ?, ?, ?, ?, ?, ?, 1, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
                                    driver = excluded.driver,
                                    host = excluded.host,
                                    port = excluded.port,
                                    db_name = excluded.db_name,
                                    ssl = excluded.ssl,
                                    params_json = excluded.params_json,
                                    is_active = 1,
                                    updated_at = datetime('now')`,
        [id, driver, host, port, dbName, ssl, params]
    );

    await recordMeta(db, "tenants", ddl, true);
}

/* ------------------------------ features ------------------------------ */
async function ensureFeatures(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS features (
                                                id          TEXT PRIMARY KEY,
                                                name        TEXT NOT NULL,
                                                description TEXT,
                                                meta_json   TEXT,
                                                is_active   INTEGER DEFAULT 1,
                                                updated_at  TEXT DEFAULT (datetime('now'))
            );
    `;
    await db.execute(ddl);
    await backfillIds(db, "features", "id");

    const count = await db.fetchOne<{ count: number }>("SELECT COUNT(*) as count FROM features");
    if (count?.count === 0) {
        await db.execute(
            `INSERT INTO features (id, name, description, meta_json, is_active, updated_at)
             VALUES (?, 'Core Feature', 'Default core feature', '{}', 1, datetime('now'))`,
            [genId()]
        );
    }

    await recordMeta(db, "features", ddl, true);
}

/* ------------------------------ plans ------------------------------ */
async function ensurePlans(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS plans (
                                             id          TEXT PRIMARY KEY,
                                             name        TEXT NOT NULL,
                                             description TEXT,
                                             features_id TEXT,
                                             meta_json   TEXT,
                                             is_active   INTEGER DEFAULT 1,
                                             updated_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (features_id) REFERENCES features(id)
            );
    `;
    await db.execute(ddl);
    await backfillIds(db, "plans", "id");

    const count = await db.fetchOne<{ count: number }>("SELECT COUNT(*) as count FROM plans");
    if (count?.count === 0) {
        await db.execute(
            `INSERT INTO plans (id, name, description, features_id, meta_json, is_active, updated_at)
             VALUES (?, 'Free Plan', 'Default starter plan',
                     (SELECT id FROM features LIMIT 1),
                 '{}', 1, datetime('now'))`,
            [genId()]
        );
    }

    await recordMeta(db, "plans", ddl, true);
}

/* ------------------------------ subscriptions ------------------------------ */
async function ensureSubscriptions(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS subscriptions (
                                                     id            TEXT PRIMARY KEY,
                                                     tenant_id     TEXT NOT NULL,
                                                     plan_id       TEXT,
                                                     status        TEXT NOT NULL,
                                                     trial_end     TEXT,
                                                     period_start  TEXT,
                                                     period_end    TEXT,
                                                     meta_json     TEXT,
                                                     is_active     INTEGER DEFAULT 1,
                                                     updated_at    TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (plan_id)   REFERENCES plans(id)
            );
    `;
    await db.execute(ddl);
    await backfillIds(db, "subscriptions", "id");

    const count = await db.fetchOne<{ count: number }>("SELECT COUNT(*) as count FROM subscriptions");
    if (count?.count === 0) {
        await db.execute(
            `INSERT INTO subscriptions (id, tenant_id, plan_id, status, is_active, updated_at)
             VALUES (?, 'tenant_default',
                     (SELECT id FROM plans LIMIT 1),
                 'active', 1, datetime('now'))`,
            [genId()]
        );
    }

    await recordMeta(db, "subscriptions", ddl, true);
}

/* ------------------------------ app_settings ------------------------------ */
async function ensureAppSettings(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS app_settings (
                                                    id          TEXT PRIMARY KEY,
                                                    key         TEXT UNIQUE,
                                                    value_json  TEXT,
                                                    value_text  TEXT,
                                                    is_active   INTEGER DEFAULT 1,
                                                    updated_at  TEXT DEFAULT (datetime('now'))
            );
    `;
    await db.execute(ddl);
    await backfillIds(db, "app_settings", "id");

    const count = await db.fetchOne<{ count: number }>("SELECT COUNT(*) as count FROM app_settings");
    if (count?.count === 0) {
        await db.execute(
            `INSERT INTO app_settings (id, key, value_text, is_active, updated_at)
             VALUES (?, 'app_code', ?, 1, datetime('now'))`,
            [genId(), process.env.APP_NAME ?? "CodexSun"]
        );
        await db.execute(
            `INSERT INTO app_settings (id, key, value_text, is_active, updated_at)
             VALUES (?, 'app_version', ?, 1, datetime('now'))`,
            [genId(), process.env.APP_VERSION ?? "0.0.0"]
        );
    }

    await recordMeta(db, "app_settings", ddl, true);
}

/* ------------------------------ activations ------------------------------ */
async function ensureActivations(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS activations (
                                                   id             TEXT PRIMARY KEY,
                                                   activation_key TEXT UNIQUE
                                                   CHECK (
                                                   substr(activation_key, 1, 1) = '+'
            AND length(activation_key) = 16
            AND replace(activation_key, '+', '') GLOB '[0-9]*'
            ),
            tenant_id      TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT 'issued',
            issued_at      TEXT DEFAULT (datetime('now')),
            activated_at   TEXT,
            expires_at     TEXT,
            meta_json      TEXT,
            is_active      INTEGER DEFAULT 1,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            );
    `;
    await db.execute(ddl);
    await backfillIds(db, "activations", "id");

    await recordMeta(db, "activations", ddl, true);
}

/* ------------------------------ audit_logs ------------------------------ */
async function ensureAuditLogs(): Promise<void> {
    const db = withLogging(await cm.prepareEngine("default"));
    const ddl = `
        CREATE TABLE IF NOT EXISTS audit_logs  (
                                                   id             TEXT PRIMARY KEY,
                                                   table_name     TEXT NOT NULL,
                                                   action         TEXT NOT NULL,
                                                   record_id      TEXT NOT NULL,
                                                   tenant_id      TEXT,
                                                   user_id        TEXT,
                                                   old_data       TEXT,
                                                   new_data       TEXT,
                                                   created_at     TEXT NOT NULL
        );
    `;
    await db.execute(ddl);
    await backfillIds(db, "audit_logs", "id");

    await recordMeta(db, "audit_logs", ddl, true);
}

/* ------------------------------------------------------------------------------------------------
 * Public: ensure everything
 * ---------------------------------------------------------------------------------------------- */

export async function run(): Promise<void> {
    if (ensured) return;
    const db = withLogging(await cm.prepareEngine("default"));

    try {
        await db.execute("PRAGMA foreign_keys = ON");
    } catch {
        // ignore for non-SQLite
    }

    await ensureCoreMeta();
    await ensureTenants();
    await ensureFeatures();
    await ensurePlans();
    await ensureSubscriptions();
    await ensureAppSettings();
    await ensureActivations();
    await ensureAuditLogs();

    try {
        const fkErrors = await db.fetchAll<any>("PRAGMA foreign_key_check");
        if (fkErrors.length > 0) {
            throw new Error("Foreign key violations detected:\n" + JSON.stringify(fkErrors, null, 2));
        }
    } catch {
        // ignore on non-SQLite
    }

    ensured = true;
}

export const runOnce = run;
