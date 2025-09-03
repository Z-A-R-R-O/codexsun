// cortex/database/core_table.ts
// Master (shared) DB core tables & APIs with uniform `id` primary keys.
// Creation order: features -> plans -> subscriptions -> app_settings -> activations
//
// - features:       id PK, feature_id UNIQUE
// - plans:          id PK, plan_id UNIQUE, features_id -> features.id
// - subscriptions:  id PK, tenant_id UNIQUE, plan_id -> plans.id, (optional legacy `plan` label)
// - app_settings:   id PK, key UNIQUE, value_json | value_text
// - activations:    id PK, activation_key UNIQUE with "+<15 digits>" validation
//
// Idempotent: call run() at boot or on-demand.
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
 * Row types
 * ---------------------------------------------------------------------------------------------- */

export type FeatureRow = {
    id: string;
    feature_id?: string | null;  // business id (unique)
    name: string;
    description?: string | null;
    updated_at: string;
};

export type PlanRow = {
    id: string;
    plan_id?: string | null;     // business id (unique)
    name: string;
    description?: string | null;
    features_id?: string | null; // FK -> features.id
    active: number;              // 1/0
    updated_at: string;
};

export type SubscriptionRow = {
    id: string;
    tenant_id: string;           // business id (unique)
    plan_id: string | null;      // FK -> plans.id
    plan?: string | null;        // optional legacy label/slug
    status: string;              // active/paused/canceled/trialing
    trial_end?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    meta_json?: string | null;
    updated_at: string;
};

export type AppSettingRow = {
    id: string;
    key: string;                 // unique business key
    value_json?: string | null;
    value_text?: string | null;
    updated_at: string;
};

export type ActivationRow = {
    id: string;
    activation_key: string;      // "+<15 digits>"
    tenant_id?: string | null;
    status: string;              // issued/activated/revoked/expired
    issued_at: string;
    activated_at?: string | null;
    expires_at?: string | null;
    meta_json?: string | null;
};

/* ------------------------------------------------------------------------------------------------
 * Ensure DDL (in required order)
 * ---------------------------------------------------------------------------------------------- */

let ensured = false;

async function ensureFeatures(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS features (
                                                id          TEXT PRIMARY KEY,
                                                feature_id  TEXT UNIQUE,
                                                name        TEXT NOT NULL,
                                                description TEXT,
                                                updated_at  TEXT DEFAULT (datetime('now'))
            );
    `);
    await ensureColumn(db, "features", "id", "TEXT");
    await ensureUnique(db, "features", "ux_features_feature_id", "feature_id");
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
                                             features_id TEXT,                       -- FK -> features.id (nullable)
                                             active      INTEGER DEFAULT 1,
                                             updated_at  TEXT DEFAULT (datetime('now'))
            );
    `);
    await ensureColumn(db, "plans", "id", "TEXT");
    await ensureColumn(db, "plans", "plan_id", "TEXT");
    await ensureColumn(db, "plans", "features_id", "TEXT");
    await ensureIndex(db,  "plans", "ix_plans_active", "active");
    await ensureIndex(db,  "plans", "ix_plans_features_id", "features_id");
    await ensureUnique(db, "plans", "ux_plans_plan_id", "plan_id");
    await backfillIds(db, "plans", "id");
}

async function ensureSubscriptions(): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(`
        CREATE TABLE IF NOT EXISTS subscriptions (
                                                     id            TEXT PRIMARY KEY,
                                                     tenant_id     TEXT UNIQUE,              -- business key (unique)
                                                     plan_id       TEXT,                     -- FK -> plans.id
                                                     plan          TEXT,                     -- optional legacy label
                                                     status        TEXT NOT NULL,
                                                     trial_end     TEXT,
                                                     period_start  TEXT,
                                                     period_end    TEXT,
                                                     meta_json     TEXT,
                                                     updated_at    TEXT DEFAULT (datetime('now'))
            );
    `);
    await ensureColumn(db, "subscriptions", "id", "TEXT");
    await ensureColumn(db, "subscriptions", "tenant_id", "TEXT");
    await ensureColumn(db, "subscriptions", "plan_id", "TEXT");
    await ensureIndex(db,  "subscriptions", "ix_subs_status", "status");
    await ensureIndex(db,  "subscriptions", "ix_subs_plan_id", "plan_id");
    await ensureUnique(db, "subscriptions", "ux_subs_tenant", "tenant_id");
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
                                                    updated_at  TEXT DEFAULT (datetime('now'))
            );
    `);
    await ensureColumn(db, "app_settings", "id", "TEXT");
    await ensureColumn(db, "app_settings", "key", "TEXT");
    await ensureColumn(db, "app_settings", "value_text", "TEXT");
    await ensureUnique(db, "app_settings", "ux_app_settings_key", "key");
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
            meta_json      TEXT
            );
    `);
    await ensureColumn(db, "activations", "id", "TEXT");
    await ensureIndex(db,  "activations", "ix_act_status", "status");
    await ensureIndex(db,  "activations", "ix_act_tenant", "tenant_id");
    await backfillIds(db, "activations", "id");
}

/** Public: ensure everything (safe to call many times) */
export async function run(): Promise<void> {
    if (ensured) return;
    await ensureFeatures();
    await ensurePlans();
    await ensureSubscriptions();
    await ensureAppSettings();
    await ensureActivations();
    ensured = true;
}

/** Alias if you prefer runOnce() naming */
export const runOnce = run;

/* ------------------------------------------------------------------------------------------------
 * Features API (prefer `id`; `feature_id` remains a unique business key)
 * ---------------------------------------------------------------------------------------------- */

export async function upsertFeature(feature: {
    id?: string | null;
    feature_id?: string | null;
    name: string;
    description?: string | null;
}): Promise<string> {
    const db = await cm.prepareEngine("default");
    const id = feature.id ?? genId();
    await db.execute(
        `INSERT INTO features (id, feature_id, name, description, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
            feature_id  = excluded.feature_id,
                                    name        = excluded.name,
                                    description = excluded.description,
                                    updated_at  = datetime('now')`,
        [id, feature.feature_id ?? null, feature.name, feature.description ?? null]
    );
    return id;
}

export async function getFeatureById(id: string): Promise<FeatureRow | null> {
    const db = await cm.prepareEngine("default");
    return db.fetchOne<FeatureRow>(
        `SELECT id, feature_id, name, description, updated_at FROM features WHERE id = ?`,
        [id]
    );
}

export async function getFeatureByKey(feature_id: string): Promise<FeatureRow | null> {
    const db = await cm.prepareEngine("default");
    return db.fetchOne<FeatureRow>(
        `SELECT id, feature_id, name, description, updated_at FROM features WHERE feature_id = ?`,
        [feature_id]
    );
}

export async function listFeatures(): Promise<FeatureRow[]> {
    const db = await cm.prepareEngine("default");
    return db.fetchAll<FeatureRow>(`SELECT id, feature_id, name, description, updated_at FROM features ORDER BY name ASC`);
}

/* ------------------------------------------------------------------------------------------------
 * Plans API (plans.features_id -> features.id)
 * ---------------------------------------------------------------------------------------------- */

export async function upsertPlan(plan: {
    id?: string | null;
    plan_id?: string | null;
    name: string;
    description?: string | null;
    features_id?: string | null;   // -> features.id
    active?: boolean;
}): Promise<string> {
    const db = await cm.prepareEngine("default");
    const id = plan.id ?? genId();
    await db.execute(
        `INSERT INTO plans (id, plan_id, name, description, features_id, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
            plan_id     = excluded.plan_id,
                                    name        = excluded.name,
                                    description = excluded.description,
                                    features_id = excluded.features_id,
                                    active      = excluded.active,
                                    updated_at  = datetime('now')`,
        [id, plan.plan_id ?? null, plan.name, plan.description ?? null, plan.features_id ?? null, plan.active === false ? 0 : 1]
    );
    return id;
}

export async function getPlanById(id: string): Promise<PlanRow | null> {
    const db = await cm.prepareEngine("default");
    return db.fetchOne<PlanRow>(
        `SELECT id, plan_id, name, description, features_id, active, updated_at FROM plans WHERE id = ?`,
        [id]
    );
}

export async function getPlanByKey(plan_id: string): Promise<PlanRow | null> {
    const db = await cm.prepareEngine("default");
    return db.fetchOne<PlanRow>(
        `SELECT id, plan_id, name, description, features_id, active, updated_at FROM plans WHERE plan_id = ?`,
        [plan_id]
    );
}

export async function listPlans(includeInactive = true): Promise<PlanRow[]> {
    const db = await cm.prepareEngine("default");
    if (includeInactive) {
        return db.fetchAll<PlanRow>(
            `SELECT id, plan_id, name, description, features_id, active, updated_at FROM plans ORDER BY name ASC`
        );
    }
    return db.fetchAll<PlanRow>(
        `SELECT id, plan_id, name, description, features_id, active, updated_at FROM plans WHERE active = 1 ORDER BY name ASC`
    );
}

/* ------------------------------------------------------------------------------------------------
 * Subscriptions API (subscription.id PK; tenant_id UNIQUE; plan_id -> plans.id)
 * ---------------------------------------------------------------------------------------------- */

export async function getSubscriptionByTenant(tenant_id: string): Promise<SubscriptionRow | null> {
    const db = await cm.prepareEngine("default");
    return db.fetchOne<SubscriptionRow>(
        `SELECT id, tenant_id, plan_id, plan, status, trial_end, period_start, period_end, meta_json, updated_at
         FROM subscriptions
         WHERE tenant_id = ?`,
        [tenant_id]
    );
}

export async function upsertSubscription(sub: {
    id?: string | null;
    tenant_id: string;             // required business key
    plan_id: string | null;        // -> plans.id
    plan?: string | null;          // optional label
    status: string;                // active/paused/canceled/trialing
    trial_end?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    meta_json?: string | null;
}): Promise<string> {
    const db = await cm.prepareEngine("default");
    const id = sub.id ?? genId();
    await db.execute(
        `INSERT INTO subscriptions
         (id, tenant_id, plan_id, plan, status, trial_end, period_start, period_end, meta_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
            tenant_id    = excluded.tenant_id,
                                    plan_id      = excluded.plan_id,
                                    plan         = excluded.plan,
                                    status       = excluded.status,
                                    trial_end    = excluded.trial_end,
                                    period_start = excluded.period_start,
                                    period_end   = excluded.period_end,
                                    meta_json    = excluded.meta_json,
                                    updated_at   = datetime('now')`,
        [
            id,
            sub.tenant_id,
            sub.plan_id ?? null,
            sub.plan ?? null,
            sub.status,
            sub.trial_end ?? null,
            sub.period_start ?? null,
            sub.period_end ?? null,
            sub.meta_json ?? null,
        ]
    );
    return id;
}

export async function listActiveSubscriptions(): Promise<SubscriptionRow[]> {
    const db = await cm.prepareEngine("default");
    return db.fetchAll<SubscriptionRow>(
        `SELECT id, tenant_id, plan_id, plan, status, trial_end, period_start, period_end, meta_json, updated_at
         FROM subscriptions
         WHERE status = 'active'`
    );
}

/* ------------------------------------------------------------------------------------------------
 * App Settings API (id PK; key UNIQUE) — includes app_code/app_version helpers
 * ---------------------------------------------------------------------------------------------- */

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
    const db = await cm.prepareEngine("default");
    const row = await db.fetchOne<AppSettingRow>(
        `SELECT id, key, value_json, value_text, updated_at FROM app_settings WHERE key = ?`,
        [key]
    );
    if (!row) return null;
    if (row.value_json != null) {
        try { return JSON.parse(row.value_json) as T; } catch { return row.value_json as unknown as T; }
    }
    if (row.value_text != null) return row.value_text as unknown as T;
    return null;
}

export async function setSetting(key: string, value: unknown): Promise<string> {
    const db = await cm.prepareEngine("default");
    const id = genId();
    const value_json = JSON.stringify(value ?? null);
    await db.execute(
        `INSERT INTO app_settings (id, key, value_json, value_text, updated_at)
         VALUES (?, ?, ?, NULL, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
                                     value_text = NULL,
                                     updated_at = datetime('now')`,
        [id, key, value_json]
    );
    return id;
}

export async function getSettingText(key: string): Promise<string | null> {
    const db = await cm.prepareEngine("default");
    const row = await db.fetchOne<AppSettingRow>(
        `SELECT id, key, value_text FROM app_settings WHERE key = ?`,
        [key]
    );
    return row?.value_text ?? null;
}

export async function setSettingText(key: string, value: string): Promise<string> {
    const db = await cm.prepareEngine("default");
    const id = genId();
    await db.execute(
        `INSERT INTO app_settings (id, key, value_json, value_text, updated_at)
         VALUES (?, ?, NULL, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
            value_text = excluded.value_text,
                                     value_json = NULL,
                                     updated_at = datetime('now')`,
        [id, key, value]
    );
    return id;
}

export async function setAppCode(code: string): Promise<string> { return setSettingText("app_code", code); }
export async function setAppVersion(version: string): Promise<string> { return setSettingText("app_version", version); }
export async function getAppInfo(): Promise<{ code: string | null; version: string | null }> {
    const [code, version] = await Promise.all([getSettingText("app_code"), getSettingText("app_version")]);
    return { code, version };
}

/* ------------------------------------------------------------------------------------------------
 * Activations API (id PK; activation_key UNIQUE "+<15 digits>")
 * ---------------------------------------------------------------------------------------------- */

const ACTIVATION_RE = /^\+[0-9]{15}$/;

export function isValidActivationKey(key: string): boolean {
    return ACTIVATION_RE.test(key);
}

export async function issueActivationKey(activation_key: string, opts?: {
    tenant_id?: string | null;
    expires_at?: string | null;
    meta_json?: string | null;
}): Promise<string> {
    if (!isValidActivationKey(activation_key)) {
        throw new Error("Invalid activation_key: must be '+' followed by exactly 15 digits.");
    }
    const db = await cm.prepareEngine("default");
    const id = genId();
    await db.execute(
        `INSERT INTO activations (id, activation_key, tenant_id, status, issued_at, activated_at, expires_at, meta_json)
         VALUES (?, ?, ?, 'issued', datetime('now'), NULL, ?, ?)`,
        [id, activation_key, opts?.tenant_id ?? null, opts?.expires_at ?? null, opts?.meta_json ?? null]
    );
    return id;
}

export async function getActivationByKey(activation_key: string): Promise<ActivationRow | null> {
    const db = await cm.prepareEngine("default");
    return db.fetchOne<ActivationRow>(
        `SELECT id, activation_key, tenant_id, status, issued_at, activated_at, expires_at, meta_json
         FROM activations WHERE activation_key = ?`,
        [activation_key]
    );
}

export async function activateKey(activation_key: string, tenant_id: string): Promise<void> {
    if (!isValidActivationKey(activation_key)) {
        throw new Error("Invalid activation_key: must be '+' followed by exactly 15 digits.");
    }
    const db = await cm.prepareEngine("default");
    await db.execute(
        `UPDATE activations
         SET status = 'activated',
             tenant_id = ?,
             activated_at = datetime('now')
         WHERE activation_key = ? AND status = 'issued'`,
        [tenant_id, activation_key]
    );
}

export async function revokeActivation(activation_key: string): Promise<void> {
    const db = await cm.prepareEngine("default");
    await db.execute(
        `UPDATE activations SET status = 'revoked' WHERE activation_key = ?`,
        [activation_key]
    );
}

export async function listActivations(status?: string): Promise<ActivationRow[]> {
    const db = await cm.prepareEngine("default");
    if (status) {
        return db.fetchAll<ActivationRow>(
            `SELECT id, activation_key, tenant_id, status, issued_at, activated_at, expires_at, meta_json
             FROM activations WHERE status = ? ORDER BY issued_at DESC`,
            [status]
        );
    }
    return db.fetchAll<ActivationRow>(
        `SELECT id, activation_key, tenant_id, status, issued_at, activated_at, expires_at, meta_json
         FROM activations ORDER BY issued_at DESC`
    );
}
