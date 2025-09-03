// cortex/database/engines/sqlite_engine.ts
import { BaseEngine } from "../Engine";
import type { NetworkDBConfig } from "../types";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { QueryAdapter, rowsAdapter } from "../queryAdapter";

export class SqliteEngine extends BaseEngine {
    private cfg: NetworkDBConfig;
    private db: Database | null = null;

    constructor(cfg: NetworkDBConfig) {
        super({ profile: cfg.profile, driver: "sqlite", cfgKey: cfg.cfgKey });
        this.cfg = cfg;
    }

    /* ---------------------------------------------------------------------- */
    /*  CONNECTION HANDLING                                                    */
    /* ---------------------------------------------------------------------- */

    protected async _connect(): Promise<void> {
        if (this.db) return;
        this.db = await open({
            filename: this.cfg.database ?? ":memory:",
            driver: sqlite3.Database,
        });
    }

    protected async _close(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }

    protected async _get_connection(): Promise<Database> {
        if (!this.db) await this._connect();
        return this.db!;
    }

    /* ---------------------------------------------------------------------- */
    /*  QUERY HELPERS                                                          */
    /* ---------------------------------------------------------------------- */

    protected async _fetchone<T = any>(sql: string, params?: unknown): Promise<T | null> {
        const result = await this._execute(sql, params);
        return (result.rows?.[0] ?? null) as T | null;
    }

    protected async _fetchall<T = any>(sql: string, params?: unknown): Promise<T[]> {
        const result = await this._execute(sql, params);
        return (result.rows ?? []) as T[];
    }

    protected async _execute(sql: string, params?: unknown): Promise<any> {
        const { sql: normSql, params: normParams } = QueryAdapter("sqlite", sql, params);
        const db = await this._get_connection();

        // Detect SELECT
        if (/^\s*select/i.test(normSql)) {
            const rows = await db.all(normSql, normParams as any[]);
            const normRows = rowsAdapter("sqlite", rows);
            return { rows: normRows, rowCount: normRows.length };
        }

        // Non-SELECT (INSERT/UPDATE/DELETE)
        const res = await db.run(normSql, normParams as any[]);
        return {
            rows: [],
            rowCount: res.changes ?? 0,
            affectedRows: res.changes ?? 0,
            insertId: res.lastID,
            lastID: res.lastID,
        };
    }

    protected async _executemany(sql: string, paramSets: unknown[]): Promise<any> {
        const { sql: normSql } = QueryAdapter("sqlite", sql);
        const db = await this._get_connection();

        if (/^\s*select/i.test(normSql)) {
            const allRows: any[] = [];
            for (const p of paramSets) {
                const { params: normParams } = QueryAdapter("sqlite", sql, p);
                const rows = await db.all(normSql, normParams as any[]);
                allRows.push(...rows);
            }
            const normRows = rowsAdapter("sqlite", allRows);
            return { rows: normRows, rowCount: normRows.length };
        }

        // Non-SELECT
        let total = 0;
        let lastID: number | undefined;
        for (const p of paramSets) {
            const { params: normParams } = QueryAdapter("sqlite", sql, p);
            const res = await db.run(normSql, normParams as any[]);
            total += res.changes ?? 0;
            lastID = res.lastID;
        }

        return {
            rows: [],
            rowCount: total,
            affectedRows: total,
            lastID,
            insertId: lastID,
        };
    }

    /* ---------------------------------------------------------------------- */
    /*  TRANSACTIONS                                                           */
    /* ---------------------------------------------------------------------- */

    protected async _begin(): Promise<void> {
        await this._execute("BEGIN");
    }

    protected async _commit(): Promise<void> {
        await this._execute("COMMIT");
    }

    protected async _rollback(): Promise<void> {
        await this._execute("ROLLBACK");
    }

    /* ---------------------------------------------------------------------- */
    /*  HEALTH CHECK                                                           */
    /* ---------------------------------------------------------------------- */

    protected async _test_connection(): Promise<boolean> {
        const row = await this._fetchone<{ ok: number }>("SELECT 1 AS ok");
        return !!row && row.ok === 1;
    }
}
