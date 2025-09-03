// cortex/database/queryAdapter.ts

/**
 * Supported database drivers
 */
type Driver = "postgres" | "mariadb" | "sqlite" | "mysql" | "mongodb";

/* -------------------------------------------------------------------------- */
/*  PLACEHOLDER HELPERS                                                       */

/* -------------------------------------------------------------------------- */

/**
 * Convert `?` placeholders → `$1, $2...` for Postgres
 */
export function toPgPlaceholders(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Convert `$n` placeholders → `?` (for MariaDB / SQLite safety)
 */
export function toQMarkPlaceholders(sql: string): string {
    if (/\$\d+/.test(sql)) {
        return sql.replace(/\$\d+/g, "?");
    }
    return sql;
}

/* -------------------------------------------------------------------------- */
/*  VALUE NORMALIZATION                                                       */

/* -------------------------------------------------------------------------- */

/**
 * Format values per driver
 * - Handles dates, booleans, buffers, arrays, objects, nulls
 */
export function formatValue(driver: Driver, v: any): any {
    // undefined / null / string "null"
    if (v === undefined || v === null || v === "null") return null;

    // Boolean handling
    if (typeof v === "boolean") {
        if (driver === "postgres") return v;   // native boolean
        return v ? 1 : 0;                      // others (mariadb/sqlite) expect int
    }

    // Dates
    if (v instanceof Date) {
        const iso = v.toISOString()
            .replace("T", " ")
            .replace("Z", "")
            .replace(/\.\d+$/, ""); // strip .000

        if (driver === "mariadb" || driver === "mysql" || driver === "mongodb") {
            return iso; // "YYYY-MM-DD HH:MM:SS"
        }
        return v.toISOString(); // Postgres + SQLite accept ISO
    }

    // Buffers / binary
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Uint8Array) return Buffer.from(v);

    // Arrays
    if (Array.isArray(v)) {
        if (driver === "postgres") return v; // native arrays
        try {
            return JSON.stringify(v);
        } catch {
            return String(v);
        }
    }

    // Objects
    if (typeof v === "object") {
        if (driver === "postgres") return v; // pg can handle JSON directly
        try {
            return JSON.stringify(v);
        } catch {
            return String(v);
        }
    }

    // Strings → fix datetime format for MariaDB/MySQL
    if (typeof v === "string" && (driver === "mariadb" || driver === "mysql")) {
        if (/\d{4}-\d{2}-\d{2}T/.test(v)) {
            return v.replace("T", " ").replace("Z", "").replace(/\.\d+$/, "");
        }
    }

    // Fallback: numbers & primitives
    return v;
}

/* -------------------------------------------------------------------------- */
/*  PARAM NORMALIZATION                                                       */

/* -------------------------------------------------------------------------- */

/**
 * Always return params as an array of formatted values
 */
export function normalizeParams(driver: Driver, params?: unknown): unknown[] {
    if (params === undefined) return [];
    if (params === null) return [null];

    if (Array.isArray(params)) {
        return params.map((p) => formatValue(driver, p));
    }

    return [formatValue(driver, params)];
}

/* -------------------------------------------------------------------------- */
/*  QUERY ADAPTER                                                             */

/* -------------------------------------------------------------------------- */

/**
 * Adapt SQL + params to the target driver
 */
export function QueryAdapter(
    driver: Driver,
    sql: string,
    params?: unknown
): { sql: string; params: unknown[] } {
    let outSql = sql;

    if (driver === "postgres") {
        if (/\?/.test(sql)) outSql = toPgPlaceholders(sql);
    } else {
        // MariaDB + MySQL + SQLite + Mongo prefer "?"
        outSql = toQMarkPlaceholders(sql);
    }

    const outParams = normalizeParams(driver, params);
    return {sql: outSql, params: outParams};
}

/* -------------------------------------------------------------------------- */
/*  ROW ADAPTER                                                               */

/* -------------------------------------------------------------------------- */

/**
 * Normalize rows across drivers
 * Always return an array of plain objects
 */
export function rowsAdapter(driver: Driver, rows: any): any[] {
    if (!rows) return [];

    const Driver = driver.toLowerCase();
    if (!["postgres", "mariadb", "sqlite", "mysql", "mongodb"].includes(Driver)) {
        throw new Error(`Unsupported driver for rowsAdapter(): ${driver}`);
    }

    // Standard array of rows
    if (Array.isArray(rows)) return rows;

    // Some drivers (SQLite, Mongo) may return `{ rows: [...] }`
    if (rows.rows && Array.isArray(rows.rows)) {
        return rows.rows;
    }

    // MariaDB sometimes returns objects with metadata
    if (typeof rows === "object" && rows.constructor === Object) {
        return Object.values(rows).filter((v) => typeof v === "object");
    }

    return [];
}
