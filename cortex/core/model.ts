import { GetSchema } from "./decorators";
import { Schema } from "./schema";

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

    async save(): Promise<this> {
        const errors = this.validate();
        if (errors.length > 0) {
            throw new Error(
                `Validation failed for ${this.constructor.name}: \n- ${errors.join("\n- ")}`
            );
        }

        // 🚀 later: insert/update with query builder
        console.log(`Saving ${this.constructor.name} to table "${(this.constructor as any).table}"`);
        console.log(this.toJSON());

        return this;
    }

    static get schema(): Schema {
        return GetSchema(this);
    }
}
