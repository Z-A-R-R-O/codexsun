// cortex/database/core_table.ts
// Master (shared) DB core tables & APIs with uniform `id` primary keys.
// Creation order: tenants -> features -> plans -> subscriptions -> app_settings -> activations
//
// Adds is_active to all tables
// Enforces FK constraints + FK check at boot
// Uses the master profile ("default") via connection_manager.

import * as cm from "./connection_manager";
import type { Engine } from "./Engine";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

function genId(): string {
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 10);
    return `${ts}${rnd}`;
}

async function ensureColumn(engine: Engine, table: string, column: string, typeSql: string): Promise<void> {
    const cols = await engine.fetchAll<{ name: string }>(`PRAGMA table_info(${table})`);
    const has = cols.some((c: { name: string }) => c.name === column);
    if (!has) {
        await engine.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql};`);
    }
}

async function ensureUnique(engine: Engine, table: string, idxName: string, expr: string): Promise<void> {
    await engine.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${idxName} ON ${table}(${expr});`);
}

async function ensureIndex(engine: Engine, table: string, idxName: string, expr: string): Promise<void> {
    await engine.execute(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${table}(${expr});`);
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

/* ------------------------------------------------------------------------------------------------
 * Ensure DDL (in required order)
 * ---------------------------------------------------------------------------------------------- */

let ensured = false;

async function ensureTenants(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS tenants (
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
            meta_json TEXT,
            is_active INTEGER DEFAULT 1,
            updated_at TEXT DEFAULT (datetime('now'))
        );
    `);
    await ensureIndex(db, "tenants", "ix_tenants_active", "is_active");
}

async function ensureFeatures(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS features (
            id          TEXT PRIMARY KEY,
            feature_id  TEXT UNIQUE,
            name        TEXT NOT NULL,
            description TEXT,
            meta_json   TEXT,
            is_active   INTEGER DEFAULT 1,
            updated_at  TEXT DEFAULT (datetime('now'))
        );
    `);
    await ensureUnique(db, "features", "ux_features_feature_id", "feature_id");
    await ensureIndex(db, "features", "ix_features_active", "is_active");
    await backfillIds(db, "features", "id");
}

async function ensurePlans(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS plans (
            id          TEXT PRIMARY KEY,
            plan_id     TEXT UNIQUE,
            name        TEXT NOT NULL,
            description TEXT,
            features_id TEXT,
            meta_json   TEXT,
            is_active   INTEGER DEFAULT 1,
            updated_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (features_id) REFERENCES features(id)
        );
    `);
    await ensureUnique(db, "plans", "ux_plans_plan_id", "plan_id");
    await ensureIndex(db, "plans", "ix_plans_active", "is_active");
    await ensureIndex(db, "plans", "ix_plans_features_id", "features_id");
    await backfillIds(db, "plans", "id");
}

async function ensureSubscriptions(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id            TEXT PRIMARY KEY,
            tenant_id     TEXT UNIQUE,
            plan_id       TEXT,
            plan          TEXT,
            status        TEXT NOT NULL,
            trial_end     TEXT,
            period_start  TEXT,
            period_end    TEXT,
            meta_json     TEXT,
            is_active     INTEGER DEFAULT 1,
            updated_at    TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
            FOREIGN KEY (plan_id)   REFERENCES plans(id)
        );
    `);
    await ensureUnique(db, "subscriptions", "ux_subs_tenant", "tenant_id");
    await ensureIndex(db, "subscriptions", "ix_subs_status", "status");
    await ensureIndex(db, "subscriptions", "ix_subs_plan_id", "plan_id");
    await ensureIndex(db, "subscriptions", "ix_subs_active", "is_active");
    await backfillIds(db, "subscriptions", "id");
}

async function ensureAppSettings(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS app_settings (
            id          TEXT PRIMARY KEY,
            key         TEXT UNIQUE,
            value_json  TEXT,
            value_text  TEXT,
            is_active   INTEGER DEFAULT 1,
            updated_at  TEXT DEFAULT (datetime('now'))
        );
    `);
    await ensureUnique(db, "app_settings", "ux_app_settings_key", "key");
    await ensureIndex(db, "app_settings", "ix_app_settings_active", "is_active");
    await backfillIds(db, "app_settings", "id");
}

async function ensureActivations(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS activations (
            id             TEXT PRIMARY KEY,
            activation_key TEXT UNIQUE
                           CHECK (
                               substr(activation_key, 1, 1) = '+'
                               AND length(activation_key) = 16
                               AND replace(activation_key, '+', '') GLOB '[0-9]*'
                           ),
            tenant_id      TEXT,
            status         TEXT NOT NULL DEFAULT 'issued',
            issued_at      TEXT DEFAULT (datetime('now')),
            activated_at   TEXT,
            expires_at     TEXT,
            meta_json      TEXT,
            is_active      INTEGER DEFAULT 1,
            FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
        );
    `);
    await ensureIndex(db, "activations", "ix_act_status", "status");
    await ensureIndex(db, "activations", "ix_act_tenant", "tenant_id");
    await ensureIndex(db, "activations", "ix_act_active", "is_active");
    await backfillIds(db, "activations", "id");
}

/* ------------------------------------------------------------------------------------------------
 * Public: ensure everything (safe to call many times)
 * ---------------------------------------------------------------------------------------------- */

export async function run(): Promise<void> {
    if (ensured) return;
    const db = await cm.prepareEngine("default");

    // Enforce foreign key constraints
    try {
        await db.execute("PRAGMA foreign_keys = ON");
    } catch {
        // no-op for non-SQLite drivers
    }

    await ensureTenants();
    await ensureFeatures();
    await ensurePlans();
    await ensureSubscriptions();
    await ensureAppSettings();
    await ensureActivations();

    // Run foreign key check (SQLite only; others throw if inconsistent)
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
