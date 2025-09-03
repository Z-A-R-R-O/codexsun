// cortex/database/engines/mysql_engine.ts

import { BaseEngine } from "../Engine";
import type { NetworkDBConfig } from "../types";
import mysql, { Pool, PoolConnection } from "mysql2/promise";
import { QueryAdapter, rowsAdapter } from "../queryAdapter";

export class MysqlEngine extends BaseEngine {
    private cfg: NetworkDBConfig;
    private pool: Pool | null = null;

    constructor(cfg: NetworkDBConfig) {
        super({ profile: cfg.profile, driver: "mysql", cfgKey: cfg.cfgKey });
        this.cfg = cfg;
    }

    /* ---------------------------------------------------------------------- */
    /*  CONNECTION HANDLING                                                    */
    /* ---------------------------------------------------------------------- */

    protected async _connect(): Promise<void> {
        if (this.pool) return;
        this.pool = mysql.createPool({
            host: this.cfg.host,
            port: this.cfg.port,
            user: this.cfg.user,
            password: this.cfg.password,
            database: this.cfg.database,
            waitForConnections: true,
            connectionLimit: this.cfg.pool?.max ?? 10,
            connectTimeout: this.cfg.pool?.acquireTimeoutMillis ?? 15000,
            ssl: this.cfg.ssl ? {} : undefined,
            socketPath: this.cfg.socketPath,
        });
        const conn = await this.pool.getConnection();
        await conn.ping();
        conn.release();
    }

    protected async _close(): Promise<void> {
        if (!this.pool) return;
        await this.pool.end();
        this.pool = null;
    }

    protected async _get_connection(): Promise<PoolConnection> {
        if (!this.pool) await this._connect();
        return this.pool!.getConnection();
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
        const { sql: normSql, params: normParams } = QueryAdapter("mysql", sql, params);
        const conn = await this._get_connection();
        try {
            const [rows] = await conn.query(normSql, normParams as any);

            // SELECT → array of rows
            if (/^\s*select/i.test(normSql)) {
                const normRows = rowsAdapter("mysql", rows);
                return { rows: normRows, rowCount: normRows.length };
            }

            // Non-SELECT → OkPacket
            const result: any = rows;
            const insertId = result?.insertId !== undefined ? Number(result.insertId) : undefined;

            return {
                rows: [],
                rowCount: result?.affectedRows ?? 0,
                affectedRows: result?.affectedRows ?? 0,
                insertId,
                lastID: insertId,
            };
        } finally {
            conn.release();
        }
    }

    protected async _executemany(sql: string, paramSets: unknown[]): Promise<any> {
        const { sql: normSql } = QueryAdapter("mysql", sql);
        const conn = await this._get_connection();
        try {
            // SELECT batch
            if (/^\s*select/i.test(normSql)) {
                const allRows: any[] = [];
                for (const p of paramSets) {
                    const { params: normParams } = QueryAdapter("mysql", sql, p);
                    const [rows] = await conn.query(normSql, normParams as any);
                    if (Array.isArray(rows)) allRows.push(...rows);
                }
                const normRows = rowsAdapter("mysql", allRows);
                return { rows: normRows, rowCount: normRows.length };
            }

            // Non-SELECT batch
            let total = 0;
            const insertIds: number[] = [];
            for (const p of paramSets) {
                const { params: normParams } = QueryAdapter("mysql", sql, p);
                const [res]: any = await conn.query(normSql, normParams as any);
                total += res?.affectedRows ?? 0;
                if (res?.insertId !== undefined) {
                    insertIds.push(Number(res.insertId));
                }
            }

            return {
                rows: [],
                rowCount: total,
                affectedRows: total,
                insertIds,
                lastID: insertIds[insertIds.length - 1],
            };
        } finally {
            conn.release();
        }
    }

    /* ---------------------------------------------------------------------- */
    /*  TRANSACTIONS                                                           */
    /* ---------------------------------------------------------------------- */

    protected async _begin(): Promise<void> {
        const conn = await this._get_connection();
        await conn.beginTransaction();
        conn.release();
    }

    protected async _commit(): Promise<void> {
        const conn = await this._get_connection();
        await conn.commit();
        conn.release();
    }

    protected async _rollback(): Promise<void> {
        const conn = await this._get_connection();
        await conn.rollback();
        conn.release();
    }

    /* ---------------------------------------------------------------------- */
    /*  HEALTH CHECK                                                           */
    /* ---------------------------------------------------------------------- */

    protected async _test_connection(): Promise<boolean> {
        const row = await this._fetchone<{ ok: number }>("SELECT 1 AS ok");
        return !!row && row.ok === 1;
    }
}
