// model.ts — Base ActiveRecord
import { queryAdapter } from "./queryAdapter";
import { Column } from "./decorators";

export abstract class Model {
    static table: string;

    @Column({ primary: true, type: "string" })
    id?: string;

    constructor(data: any) {
        Object.assign(this, data);
    }

    static async find<T extends Model>(
        this: { new (data: any): T; table: string },
        id: string
    ): Promise<T | null> {
        const row = await queryAdapter.findOne(this.table, { id });
        return row ? new this(row) : null;
    }

    static async all<T extends Model>(
        this: { new (data: any): T; table: string }
    ): Promise<T[]> {
        const rows = await queryAdapter.findAll(this.table);
        return rows.map((r) => new this(r));
    }

    static async create<T extends Model>(
        this: { new (data: any): T; table: string },
        data: any
    ): Promise<T> {
        const row = await queryAdapter.insert(this.table, data);
        return new this(row);
    }

    async save(): Promise<void> {
        const ctor = this.constructor as typeof Model;
        if (this.id) {
            await queryAdapter.update(ctor.table, { id: this.id }, this);
        } else {
            const row = await queryAdapter.insert(ctor.table, this);
            Object.assign(this, row);
        }
    }

    async delete(): Promise<void> {
        const ctor = this.constructor as typeof Model;
        if (!this.id) throw new Error("Cannot delete without id");
        await queryAdapter.delete(ctor.table, { id: this.id });
    }
}
