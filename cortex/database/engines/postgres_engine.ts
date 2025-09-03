// cortex/database/engines/postgres_engine.ts
import { BaseEngine } from "../Engine";
import type { NetworkDBConfig } from "../types";
import { Pool, PoolClient } from "pg";
import { QueryAdapter, rowsAdapter } from "../queryAdapter"; // shared helpers

export class PostgresEngine extends BaseEngine {
    private cfg: NetworkDBConfig;
    private pool: Pool | null = null;

    constructor(cfg: NetworkDBConfig) {
        super({ profile: cfg.profile, driver: "postgres", cfgKey: cfg.cfgKey });
        this.cfg = cfg;
    }

    /* ---------------------------------------------------------------------- */
    /*  CONNECTION HANDLING                                                    */
    /* ---------------------------------------------------------------------- */

    protected async _connect(): Promise<void> {
        if (this.pool) return;
        this.pool = new Pool({
            host: this.cfg.host,
            port: this.cfg.port,
            user: this.cfg.user,
            password: this.cfg.password,
            database: this.cfg.database,
            ssl:
                this.cfg.ssl === true || this.cfg.ssl === "require"
                    ? { rejectUnauthorized: false }
                    : undefined,
            max: this.cfg.pool?.max ?? 10,
            idleTimeoutMillis: this.cfg.pool?.idleMillis ?? 10000,
            connectionTimeoutMillis: this.cfg.pool?.acquireTimeoutMillis ?? 15000,
        });

        const c = await this.pool.connect();
        await c.query("SELECT 1");
        c.release();
    }

    protected async _close(): Promise<void> {
        if (!this.pool) return;
        await this.pool.end();
        this.pool = null;
    }

    protected async _get_connection(): Promise<PoolClient> {
        if (!this.pool) await this._connect();
        return this.pool!.connect();
    }

    /* ---------------------------------------------------------------------- */
    /*  QUERY HELPERS                                                          */
    /* ---------------------------------------------------------------------- */

    protected async _fetchone<T = any>(
        sql: string,
        params?: unknown
    ): Promise<T | null> {
        const { sql: normSql, params: normParams } = QueryAdapter("postgres", sql, params);
        const c = await this._get_connection();
        try {
            const res = await c.query(normSql, normParams as any[]);
            const rows = rowsAdapter("postgres", res.rows ?? []);
            return (rows[0] ?? null) as T | null;
        } finally {
            c.release();
        }
    }

    protected async _fetchall<T = any>(
        sql: string,
        params?: unknown
    ): Promise<T[]> {
        const { sql: normSql, params: normParams } = QueryAdapter("postgres", sql, params);
        const c = await this._get_connection();
        try {
            const res = await c.query(normSql, normParams as any[]);
            return rowsAdapter("postgres", res.rows ?? []) as T[];
        } finally {
            c.release();
        }
    }

    protected async _execute(sql: string, params?: unknown): Promise<any> {
        let { sql: normSql, params: normParams } = QueryAdapter("postgres", sql, params);

        // Auto-append RETURNING id for inserts without RETURNING
        if (/^\s*insert/i.test(normSql) && !/returning\s+/i.test(normSql)) {
            normSql = normSql.trim().replace(/;?$/, " RETURNING id;");
        }

        const c = await this._get_connection();
        try {
            const res = await c.query(normSql, normParams as any[]);
            const rows = rowsAdapter("postgres", res.rows ?? []);

            let insertId: number | undefined;
            if (/insert/i.test(res.command) && rows?.length && rows[0].id !== undefined) {
                insertId = Number(rows[0].id);
            }

            return {
                rows,
                rowCount: res.rowCount ?? rows.length,
                command: res.command,
                insertId,
                lastID: insertId,
            };
        } finally {
            c.release();
        }
    }

    protected async _executemany(sql: string, paramSets: unknown[]): Promise<any> {
        let { sql: normSql } = QueryAdapter("postgres", sql);

        // Ensure inserts always return IDs
        if (/^\s*insert/i.test(normSql) && !/returning\s+/i.test(normSql)) {
            normSql = normSql.trim().replace(/;?$/, " RETURNING id;");
        }

        const c = await this._get_connection();
        try {
            // SELECT batch
            if (/^\s*select/i.test(normSql)) {
                const allRows: any[] = [];
                for (const p of paramSets) {
                    const { params: normParams } = QueryAdapter("postgres", sql, p);
                    const res = await c.query(normSql, normParams as any[]);
                    allRows.push(...(res.rows ?? []));
                }
                const rows = rowsAdapter("postgres", allRows);
                return { rows, rowCount: rows.length };
            }

            // Non-SELECT batch
            let total = 0;
            const insertIds: number[] = [];
            for (const p of paramSets) {
                const { params: normParams } = QueryAdapter("postgres", sql, p);
                const res = await c.query(normSql, normParams as any[]);
                const rows = rowsAdapter("postgres", res.rows ?? []);
                total += res.rowCount ?? 0;
                if (/insert/i.test(res.command) && rows?.length && rows[0].id !== undefined) {
                    insertIds.push(Number(rows[0].id));
                }
            }

            return {
                rows: [],
                rowCount: total,
                insertIds,
                lastID: insertIds[insertIds.length - 1],
            };
        } finally {
            c.release();
        }
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
