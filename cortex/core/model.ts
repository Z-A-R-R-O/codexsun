import { GetSchema } from "./decorators";
import { Schema } from "./schema";
import { QueryBuilder } from "./query-builder";

export abstract class Model {
    public static table: string;
    protected _data: Record<string, any> = {};

    constructor(initial?: Record<string, any>) {
        if (initial) this._data = { ...initial };
    }

    get<K extends keyof this>(key: K): this[K] {
        return (this._data as any)[key];
    }

    set<K extends keyof this>(key: K, value: this[K]): void {
        (this._data as any)[key] = value;
    }

    toJSON(): Record<string, any> {
        return { ...this._data };
    }

    validate(): string[] {
        const schema: Schema = GetSchema(this.constructor);
        return schema.validate(this._data);
    }

    /** Insert or update */
    async save(): Promise<this> {
        const errors = this.validate();
        if (errors.length > 0) {
            throw new Error(
                `Validation failed for ${this.constructor.name}: \n- ${errors.join("\n- ")}`
            );
        }

        const schema = (this.constructor as any).schema as Schema;
        const table = (this.constructor as any).table;
        const columns = schema.getColumns();

        const pkCol = columns.find((c) => c.type === "primary");
        if (!pkCol) throw new Error(`No primary key defined for ${this.constructor.name}`);

        const pk = pkCol.name;
        const pkValue = this._data[pk];

        let sql: string;
        if (!pkValue) {
            sql = QueryBuilder.insert(table, this._data);
        } else {
            sql = QueryBuilder.update(table, this._data, pk, pkValue);
        }

        console.log("Generated SQL:", sql);
        return this;
    }

    /** Delete (soft if deleted_at exists) */
    async delete(): Promise<void> {
        const schema = (this.constructor as any).schema as Schema;
        const table = (this.constructor as any).table;
        const columns = schema.getColumns();

        const pkCol = columns.find((c) => c.type === "primary");
        if (!pkCol) throw new Error(`No primary key defined for ${this.constructor.name}`);

        const pk = pkCol.name;
        const pkValue = this._data[pk];
        if (!pkValue) throw new Error(`Cannot delete ${this.constructor.name} without primary key`);

        const softDeleteCol = columns.find((c) => c.type === "softdelete");
        let sql: string;
        if (softDeleteCol) {
            this._data[softDeleteCol.name] = new Date();
            sql = QueryBuilder.update(table, { [softDeleteCol.name]: this._data[softDeleteCol.name] }, pk, pkValue);
        } else {
            sql = QueryBuilder.delete(table, { [pk]: pkValue });
        }

        console.log("Generated SQL:", sql);
    }

    /** Restore soft-deleted row */
    async restore(): Promise<void> {
        const schema = (this.constructor as any).schema as Schema;
        const table = (this.constructor as any).table;
        const columns = schema.getColumns();

        const pkCol = columns.find((c) => c.type === "primary");
        if (!pkCol) throw new Error(`No primary key defined for ${this.constructor.name}`);

        const pk = pkCol.name;
        const pkValue = this._data[pk];
        if (!pkValue) throw new Error(`Cannot restore ${this.constructor.name} without primary key`);

        const softDeleteCol = columns.find((c) => c.type === "softdelete");
        if (!softDeleteCol) throw new Error(`${this.constructor.name} has no soft delete column`);

        this._data[softDeleteCol.name] = null;
        const sql = QueryBuilder.update(table, { [softDeleteCol.name]: null }, pk, pkValue);

        console.log("Generated SQL:", sql);
    }

    // -------------------------
    // 🔹 STATIC METHODS
    // -------------------------

    static get schema(): Schema {
        return GetSchema(this);
    }

    static async find<T extends Model>(
        this: { new (data: any): T; table: string },
        where?: Record<string, any>,
        options?: { includeDeleted?: boolean; orderBy?: string; limit?: number; offset?: number }
    ): Promise<T[]> {
        const schema = (this as any).schema;
        const softDeleteCol = schema.getColumns().find((c: any) => c.type === "softdelete")?.name;

        const sql = QueryBuilder.find(this.table, where, softDeleteCol, options);
        console.log("Generated SQL:", sql);

        const fakeRows: Record<string, any>[] = []; // placeholder
        return fakeRows.map((row) => new this(row));
    }

    static async findOne<T extends Model>(
        this: { new (data: any): T; table: string },
        where?: Record<string, any>,
        options?: { includeDeleted?: boolean; orderBy?: string }
    ): Promise<T | null> {
        const schema = (this as any).schema;
        const softDeleteCol = schema.getColumns().find((c: any) => c.type === "softdelete")?.name;

        const sql = QueryBuilder.findOne(this.table, where, softDeleteCol, options);
        console.log("Generated SQL:", sql);

        const fakeRow: Record<string, any> | null = null;
        return fakeRow ? new this(fakeRow) : null;
    }

    static async delete<T extends Model>(
        this: { new (data: any): T; table: string },
        where: Record<string, any>
    ): Promise<void> {
        const schema = (this as any).schema as Schema;
        const columns = schema.getColumns();
        const softDeleteCol = columns.find((c) => c.type === "softdelete");

        let sql: string;
        if (softDeleteCol) {
            sql = `UPDATE ${(this as any).table} SET ${softDeleteCol.name} = '${new Date().toISOString()}' 
             WHERE ${Object.entries(where)
                .map(([k, v]) => `${k} = '${v}'`)
                .join(" AND ")};`;
        } else {
            sql = QueryBuilder.delete((this as any).table, where);
        }

        console.log("Generated SQL:", sql);
    }

    static async restore<T extends Model>(
        this: { new (data: any): T; table: string },
        where: Record<string, any>
    ): Promise<void> {
        const schema = (this as any).schema as Schema;
        const columns = schema.getColumns();
        const softDeleteCol = columns.find((c) => c.type === "softdelete");
        if (!softDeleteCol) throw new Error(`${this.name} has no soft delete column`);

        const sql = `UPDATE ${(this as any).table} SET ${softDeleteCol.name} = NULL 
                 WHERE ${Object.entries(where)
            .map(([k, v]) => `${k} = '${v}'`)
            .join(" AND ")};`;

        console.log("Generated SQL:", sql);
    }

    static async exists<T extends Model>(
        this: { new (data: any): T; table: string },
        where: Record<string, any>
    ): Promise<boolean> {
        const sql = QueryBuilder.exists(this.table, where);
        console.log("Generated SQL:", sql);
        return false; // mock
    }

    static async count<T extends Model>(
        this: { new (data: any): T; table: string },
        where?: Record<string, any>
    ): Promise<number> {
        const sql = QueryBuilder.count(this.table, where);
        console.log("Generated SQL:", sql);
        return 0; // mock
    }

    static async all<T extends Model>(
        this: { new (data: any): T; table: string },
        options?: { orderBy?: string; limit?: number; offset?: number }
    ): Promise<T[]> {
        return this.find({}, options);
    }
}
