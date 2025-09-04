// queryAdapter.ts — Simple DB adapter on top of mdb
import { mdb } from "../database/db";

export const queryAdapter = {
    async findOne(table: string, where: Record<string, any>): Promise<any | null> {
        const keys = Object.keys(where);
        const values = Object.values(where);

        const sql = `SELECT * FROM ${table} WHERE ${keys.map(k => `${k} = ?`).join(" AND ")} LIMIT 1`;
        return await mdb.fetchOne(sql, values);
    },

    async findAll(table: string): Promise<any[]> {
        const sql = `SELECT * FROM ${table}`;
        return await mdb.fetchAll(sql);
    },

    async findWhere(table: string, where: Record<string, any>): Promise<any[]> {
        const keys = Object.keys(where);
        const values = Object.values(where);

        const sql = `SELECT * FROM ${table} WHERE ${keys.map(k => `${k} = ?`).join(" AND ")}`;
        return await mdb.fetchAll(sql, values);
    },

    async insert(table: string, data: any): Promise<any> {
        const keys = Object.keys(data);
        const values = Object.values(data);

        const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
        await mdb.query(sql, values);

        // return row with inserted id if available
        const row = await mdb.fetchOne("SELECT LAST_INSERT_ID() AS id");
        const id = data.id || row?.id;
        return { ...data, id };
    },

    async update(table: string, where: Record<string, any>, data: any): Promise<void> {
        const keys = Object.keys(data);
        const values = Object.values(data);

        const whereKeys = Object.keys(where);
        const whereValues = Object.values(where);

        const sql = `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(", ")} WHERE ${whereKeys.map(k => `${k} = ?`).join(" AND ")}`;
        await mdb.query(sql, [...values, ...whereValues]);
    },

    async delete(table: string, where: Record<string, any>): Promise<void> {
        const keys = Object.keys(where);
        const values = Object.values(where);

        const sql = `DELETE FROM ${table} WHERE ${keys.map(k => `${k} = ?`).join(" AND ")}`;
        await mdb.query(sql, values);
    }
};
