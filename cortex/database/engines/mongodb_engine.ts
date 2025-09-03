// cortex/database/engines/mongodb_engine.ts
import { BaseEngine, MaybePromise } from "../Engine";
import type { NetworkDBConfig } from "../types";
import { MongoClient, Db } from "mongodb";
import { QueryAdapter, rowsAdapter } from "../queryAdapter";

export class MongodbEngine extends BaseEngine {
    protected _get_connection(): MaybePromise<unknown> {
        throw new Error("Method not implemented.");
    }

    private cfg: NetworkDBConfig;
    private client: MongoClient | null = null;
    private db: Db | null = null;

    constructor(cfg: NetworkDBConfig) {
        super({ profile: cfg.profile, driver: "mongodb", cfgKey: cfg.cfgKey });
        this.cfg = cfg;
    }

    /* ---------------------------------------------------------------------- */
    /*  CONNECTION HANDLING                                                    */
    /* ---------------------------------------------------------------------- */

    protected async _connect(): Promise<void> {
        if (this.client) return;

        const uri =
            this.cfg.uri ??
            `mongodb://${this.cfg.user}:${this.cfg.password}@${this.cfg.host}:${this.cfg.port}`;

        this.client = new MongoClient(uri, {
            connectTimeoutMS: this.cfg.pool?.acquireTimeoutMillis ?? 15000,
            maxPoolSize: this.cfg.pool?.max ?? 10,
            ssl: this.cfg.ssl === true || this.cfg.ssl === "require" ? true : false, // ✅ normalize
        });

        await this.client.connect();
        this.db = this.client.db(this.cfg.database);
    }

    protected async _close(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
        }
    }

    private _getCollectionFromSql(sql: string): string {
        const match =
            sql.match(/from\s+(\w+)/i) ||
            sql.match(/into\s+(\w+)/i) ||
            sql.match(/update\s+(\w+)/i);
        if (!match) throw new Error(`Could not extract collection from SQL: ${sql}`);
        return match[1];
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
        if (!this.db) await this._connect();

        const { sql: normSql, params: normParams } = QueryAdapter("mongodb", sql, params);
        const collectionName = this._getCollectionFromSql(normSql);
        const coll = this.db!.collection(collectionName);

        // SELECT
        if (/^\s*select/i.test(normSql)) {
            const rows = await coll.find(normParams || {}).toArray();
            const normRows = rowsAdapter("mongodb", rows);
            return { rows: normRows, rowCount: normRows.length };
        }

        // INSERT
        if (/^\s*insert/i.test(normSql)) {
            const doc = Array.isArray(normParams) ? normParams[0] : normParams;
            const res = await coll.insertOne(doc as any);
            return {
                rows: [doc],
                rowCount: 1,
                affectedRows: 1,
                insertId: res.insertedId.toString(),
                lastID: res.insertedId.toString(),
            };
        }

        // UPDATE
        if (/^\s*update/i.test(normSql)) {
            const { filter, update } = (normParams as any) ?? {};
            const res = await coll.updateMany(filter ?? {}, update ?? {});
            return {
                rows: [],
                rowCount: res.modifiedCount,
                affectedRows: res.modifiedCount,
            };
        }

        // DELETE
        if (/^\s*delete/i.test(normSql)) {
            const res = await coll.deleteMany(normParams ?? {});
            return {
                rows: [],
                rowCount: res.deletedCount ?? 0,
                affectedRows: res.deletedCount ?? 0,
            };
        }

        throw new Error(`Unsupported MongoDB SQL mimic: ${normSql}`);
    }

    protected async _executemany(sql: string, paramSets: unknown[]): Promise<any> {
        const results: any[] = [];
        for (const p of paramSets) {
            results.push(await this._execute(sql, p));
        }
        return results;
    }

    /* ---------------------------------------------------------------------- */
    /*  TRANSACTIONS                                                           */
    /* ---------------------------------------------------------------------- */

    protected async _begin(): Promise<void> {
        // MongoDB transactions require replica sets → optional
    }

    protected async _commit(): Promise<void> {}
    protected async _rollback(): Promise<void> {}

    /* ---------------------------------------------------------------------- */
    /*  HEALTH CHECK                                                           */
    /* ---------------------------------------------------------------------- */

    protected async _test_connection(): Promise<boolean> {
        if (!this.client) return false;
        try {
            await this.db?.command({ ping: 1 });
            return true;
        } catch {
            return false;
        }
    }
}
