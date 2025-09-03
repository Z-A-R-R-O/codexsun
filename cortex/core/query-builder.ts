import { Schema } from "./schema";

export class QueryBuilder {
    static insert(table: string, data: Record<string, any>): string {
        const cols = Object.keys(data).join(", ");
        const vals = Object.values(data)
            .map((v) => QueryBuilder.formatValue(v))
            .join(", ");

        return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
    }

    static update(table: string, data: Record<string, any>, pk: string, pkValue: any): string {
        const sets = Object.entries(data)
            .filter(([key]) => key !== pk)
            .map(([key, value]) => `${key} = ${QueryBuilder.formatValue(value)}`)
            .join(", ");

        return `UPDATE ${table} SET ${sets} WHERE ${pk} = ${QueryBuilder.formatValue(pkValue)};`;
    }

    static find(table: string, where?: Record<string, any>, softDeleteCol?: string, options?: { includeDeleted?: boolean; orderBy?: string; limit?: number; offset?: number }): string {
        let sql = `SELECT * FROM ${table}`;
        const conditions: string[] = [];

        if (where && Object.keys(where).length > 0) {
            conditions.push(...Object.entries(where).map(([k, v]) => `${k} = ${QueryBuilder.formatValue(v)}`));
        }

        if (softDeleteCol && !options?.includeDeleted) {
            conditions.push(`${softDeleteCol} IS NULL`);
        }

        if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
        if (options?.orderBy) sql += ` ORDER BY ${options.orderBy}`;
        if (options?.limit) sql += ` LIMIT ${options.limit}`;
        if (options?.offset) sql += ` OFFSET ${options.offset}`;

        sql += ";";
        return sql;
    }

    static findOne(table: string, where?: Record<string, any>, softDeleteCol?: string, options?: { includeDeleted?: boolean; orderBy?: string }): string {
        let sql = QueryBuilder.find(table, where, softDeleteCol, { ...options, limit: 1 });
        return sql;
    }

    static count(table: string, where?: Record<string, any>): string {
        let sql = `SELECT COUNT(*) as count FROM ${table}`;
        if (where && Object.keys(where).length > 0) {
            const conditions = Object.entries(where)
                .map(([k, v]) => `${k} = ${QueryBuilder.formatValue(v)}`)
                .join(" AND ");
            sql += " WHERE " + conditions;
        }
        sql += ";";
        return sql;
    }


    static delete(table: string, where?: Record<string, any>): string {
        let sql = `DELETE FROM ${table}`;
        if (where && Object.keys(where).length > 0) {
            const conditions = Object.entries(where)
                .map(([key, value]) => `${key} = ${QueryBuilder.formatValue(value)}`)
                .join(" AND ");
            sql += ` WHERE ${conditions}`;
        }
        sql += ";";
        return sql;
    }

    private static formatValue(value: any): string {
        if (value === null || value === undefined) return "NULL";
        if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
        if (value instanceof Date) return `'${value.toISOString()}'`;
        if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
        return value.toString();
    }



    static exists(table: string, where: Record<string, any>): string {
        let sql = `SELECT 1 FROM ${table}`;
        if (Object.keys(where).length > 0) {
            const conditions = Object.entries(where)
                .map(([k, v]) => `${k} = ${QueryBuilder.formatValue(v)}`)
                .join(" AND ");
            sql += " WHERE " + conditions;
        }
        sql += " LIMIT 1;";
        return sql;
    }


}
