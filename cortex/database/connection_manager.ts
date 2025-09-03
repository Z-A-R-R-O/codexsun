// cortex/database/connection_manager.ts

import type { Engine } from "./Engine";
import type { DBConfig } from "./types";
import { getDbConfig } from "./getDbConfig";

import { SqliteEngine } from "./engines/sqlite_engine";
import { PostgresEngine } from "./engines/postgres_engine";
import { MariaDBEngine } from "./engines/mariadb_engine";
import { MysqlEngine } from "./engines/mysql_engine";

// Record stored in the in-memory registry
type EngineRecord = {
    profile: string;
    cfgKey: string;
    engine: Engine;
};

const enginesByProfile = new Map<string, EngineRecord>();

/* ------------------------------------------------------------------------------------------------
 * Engine factory
 * ---------------------------------------------------------------------------------------------- */
function createEngineFromConfig(cfg: DBConfig): Engine {
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
            // Optional dependency – load only if present
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const modPath = "./engines/mongodb_engine";
            try {
                // @ts-ignore optional module
                const { MongoDBEngine } = require(modPath);
                return new MongoDBEngine(cfg as any);
            } catch {
                throw new Error(
                    "MongoDB driver selected but MongoDB engine not found. Add cortex/database/engines/mongodb_engine.ts exporting MongoDBEngine."
                );
            }
        }
        default: {
            const neverDriver: never = cfg.driver as never;
            throw new Error(`Unsupported DB driver: ${String(neverDriver)}`);
        }
    }
}

/* ------------------------------------------------------------------------------------------------
 * Core lifecycle
 * ---------------------------------------------------------------------------------------------- */

/**
 * Ensure an engine for a profile exists, is connected, and matches current config.
 * - For profile 'default': getDbConfig strictly reads MDB_* (master only)
 * - For other profiles: getDbConfig reads <PROFILE>_DB_* with fallback to DB_*
 */
export async function prepareEngine(profile: string = "default"): Promise<Engine> {
    const cfg = getDbConfig(profile);

    const existing = enginesByProfile.get(profile);
    if (existing && existing.cfgKey === cfg.cfgKey) {
        // Already prepared with same configuration
        return existing.engine;
    }

    // If exists but config changed, close old engine
    if (existing && existing.cfgKey !== cfg.cfgKey) {
        try {
            await existing.engine.close();
        } catch {
            // ignore close errors
        } finally {
            enginesByProfile.delete(profile);
        }
    }

    // Create new engine and connect
    const engine = createEngineFromConfig(cfg);
    await engine.connect();

    const rec: EngineRecord = { profile, cfgKey: cfg.cfgKey, engine };
    enginesByProfile.set(profile, rec);

    return engine;
}

/**
 * Get an already-prepared engine (or undefined if not prepared).
 * Usually you want `prepareEngine` instead.
 */
export function getEngine(profile: string = "default"): Engine | undefined {
    return enginesByProfile.get(profile)?.engine;
}

/* ------------------------------------------------------------------------------------------------
 * Convenience query API (profile-scoped)
 * ---------------------------------------------------------------------------------------------- */

export async function execute(profile: string, sql: string, params?: unknown): Promise<any> {
    const engine = await prepareEngine(profile);
    return engine.execute(sql, params);
}

export async function fetchOne<T = any>(
    profile: string,
    sql: string,
    params?: unknown
): Promise<T | null> {
    const engine = await prepareEngine(profile);
    return engine.fetchOne<T>(sql, params);
}

export async function fetchAll<T = any>(
    profile: string,
    sql: string,
    params?: unknown
): Promise<T[]> {
    const engine = await prepareEngine(profile);
    return engine.fetchAll<T>(sql, params);
}

export async function executeMany(
    profile: string,
    sql: string,
    paramSets: unknown[]
): Promise<any> {
    const engine = await prepareEngine(profile);
    return engine.executeMany(sql, paramSets);
}

export async function begin(profile: string): Promise<void> {
    const engine = await prepareEngine(profile);
    await engine.begin();
}

export async function commit(profile: string): Promise<void> {
    const engine = await prepareEngine(profile);
    await engine.commit();
}

export async function rollback(profile: string): Promise<void> {
    const engine = await prepareEngine(profile);
    await engine.rollback();
}

export async function testConnection(profile: string = "default"): Promise<boolean> {
    const engine = await prepareEngine(profile);
    if (!engine) throw new Error(`No engine for profile ${profile}`);
    return engine.testConnection();
}

export async function getConnection(profile: string): Promise<any> {
    const engine: Engine = await prepareEngine(profile);
    if (!engine) throw new Error(`No engine for profile ${profile}`);
    return engine.getConnection();
}

export async function closeEngine(profile: string): Promise<void> {
    const engine: Engine = await prepareEngine(profile);
    if (!engine) throw new Error(`No engine for profile ${profile}`);
    if (engine) await engine.close();
}

export async function healthz(profile: string): Promise<boolean> {
    try {
        const conn = await getConnection(profile);
        await conn.query("SELECT 1"); // or engine-specific ping
        return true;
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------------------------------------
 * Teardown
 * ---------------------------------------------------------------------------------------------- */

/**
 * Close and remove a single profile engine.
 */
export async function teardown(profile: string): Promise<void> {
    const rec = enginesByProfile.get(profile);
    if (!rec) return;
    try {
        await rec.engine.close();
    } catch {
        // ignore
    } finally {
        enginesByProfile.delete(profile);
    }
}

/**
 * Close all engines and clear the registry.
 */
export async function teardownAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [profile, rec] of enginesByProfile.entries()) {
        tasks.push(
            (async () => {
                try {
                    await rec.engine.close();
                } catch {
                    // ignore close errors
                } finally {
                    enginesByProfile.delete(profile);
                }
            })()
        );
    }
    await Promise.allSettled(tasks);
    enginesByProfile.clear();
}
