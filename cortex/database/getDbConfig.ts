// cortex/database/getDbConfig.ts
import { makeConfigKey, type DBConfig, type DBDriver } from "./types";
import { getPrefixedEnv, getPoolSettings } from "../settings/get_settings";

/* ------------------------------ helpers ------------------------------ */
function num(v: string | undefined): number | undefined {
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function bool(v: string | undefined): boolean | undefined {
    if (v == null || v === "") return undefined;
    const s = v.toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return undefined;
}
function inferDriverFromUrl(url?: string): DBDriver | undefined {
    if (!url) return undefined;
    const m = url.match(/^([a-z0-9+]+):/i);
    if (!m) return undefined;
    const scheme = m[1].toLowerCase();
    if (scheme.startsWith("postgres")) return "postgres";
    if (scheme.startsWith("mysql")) return "mysql";
    if (scheme.startsWith("mariadb")) return "mariadb";
    if (scheme.startsWith("mongodb") || scheme.startsWith("mongo")) return "mongodb";
    if (scheme.startsWith("sqlite")) return "sqlite";
    return undefined;
}
function prune<T extends Record<string, any>>(o: T): T {
    Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
    return o;
}
/** Ensure PROFILE is uppercased and safe for env prefixing */
function up(s: string): string {
    return String(s).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

/* ------------------------------ core readers ------------------------------ */

/**
 * Read a DB config from a single prefix (e.g., "MDB", "DB", "BLUE_DB").
 * Supports both PASS and PASSWORD.
 */
function readFromPrefix(profile: string, prefix: string): Partial<DBConfig> {
    const url = getPrefixedEnv(prefix, "URL");
    let driver = (getPrefixedEnv(prefix, "DRIVER") as DBDriver | undefined) ?? inferDriverFromUrl(url);

    // sqlite file convenience
    const file = getPrefixedEnv(prefix, "FILE") ?? getPrefixedEnv(prefix, "NAME");
    const host = getPrefixedEnv(prefix, "HOST");
    const port = num(getPrefixedEnv(prefix, "PORT"));
    const user = getPrefixedEnv(prefix, "USER");
    const password = getPrefixedEnv(prefix, "PASSWORD") ?? getPrefixedEnv(prefix, "PASS");
    const database = getPrefixedEnv(prefix, "NAME") ?? file;
    const ssl = bool(getPrefixedEnv(prefix, "SSL"));

    const cfg: any = prune({
        profile,
        driver,
        url,
        host,
        port,
        user,
        password,
        database,
        ssl,
    });

    return cfg;
}

/**
 * Merge pool settings. If `preferPrefix` is supplied, any missing pool fields
 * will fall back to the `fallbackPrefix` (e.g., fallback to generic DB_*).
 */
function mergedPoolSettings(preferPrefix: string, fallbackPrefix?: string) {
    const a = getPoolSettings(preferPrefix);
    if (!fallbackPrefix) return a;
    const b = getPoolSettings(fallbackPrefix);
    return prune({
        min: a.min ?? b.min,
        max: a.max ?? b.max,
        idleMillis: a.idleMillis ?? b.idleMillis,
        acquireTimeoutMillis: a.acquireTimeoutMillis ?? b.acquireTimeoutMillis,
    });
}

/**
 * Build final DBConfig for master (MDB_* only). No DB_* fallback.
 * If nothing is set, we default to sqlite ./data/dev.sqlite for convenience.
 */
function buildMasterConfig(): DBConfig {
    const profile = "default";
    const prefix = "MDB";

    const cfg: any = readFromPrefix(profile, prefix);

    // If nothing was provided, default to sqlite
    if (!cfg.driver && !cfg.url && !cfg.host && !cfg.database) {
        cfg.driver = "sqlite";
        cfg.database = "./data/dev.sqlite";
    }

    // If sqlite and no database set, apply default dev file
    if ((cfg.driver ?? "").toLowerCase() === "sqlite" && !cfg.database) {
        cfg.database = "./data/dev.sqlite";
    }

    cfg.pool = mergedPoolSettings(prefix);
    cfg.cfgKey = makeConfigKey(cfg);
    return cfg as DBConfig;
}

/**
 * Build final DBConfig for a non-default profile.
 * Read <PROFILE>_DB_* first, then fall back to generic DB_* for any missing fields.
 */
function buildProfileConfig(profile: string): DBConfig {
    const PROFILE_DB = `${up(profile)}_DB`;

    // Prefer <PROFILE>_DB_*
    const a: any = readFromPrefix(profile, PROFILE_DB);

    // Fallback to generic DB_* for any missing fields
    const b: any = readFromPrefix(profile, "DB");

    const cfg: any = prune({
        profile,
        driver: a.driver ?? b.driver,
        url: a.url ?? b.url,
        host: a.host ?? b.host,
        port: a.port ?? b.port,
        user: a.user ?? b.user,
        password: a.password ?? b.password,
        database: a.database ?? b.database,
        ssl: a.ssl ?? b.ssl,
    });

    // Pool: prefer <PROFILE>_DB_*, then fallback to DB_*
    cfg.pool = mergedPoolSettings(PROFILE_DB, "DB");

    cfg.cfgKey = makeConfigKey(cfg);
    return cfg as DBConfig;
}

/* ------------------------------ Public API ------------------------------ */

/**
 * Master/shared (tenants registry) config:
 * - Default profile ALWAYS uses MDB_* (NO DB_* fallback).
 * - If MDB_* is missing entirely, defaults to sqlite ./data/dev.sqlite.
 */
export function getDbConfig(profile: string = "default"): DBConfig {
    if (profile === "default" || up(profile) === "MDB") {
        return buildMasterConfig();
    }
    // Any other profile uses <PROFILE>_DB_* with fallback to DB_*
    return buildProfileConfig(profile);
}

/** Explicit master getter if you want to be clear in call sites. */
export function getMasterDbConfig(): DBConfig {
    return buildMasterConfig();
}
