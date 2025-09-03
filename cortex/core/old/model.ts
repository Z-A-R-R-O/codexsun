// cortex/core/Model.ts
import "reflect-metadata";

export abstract class Model {
    public static table: string;
    public static _schema: any;

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
}

// merge namespace with types
export namespace Model {
    export type pkType = number;
    export type strType = string;
    export type emailType = string & { __emailBrand: true };
    export type hashedType = string & { __hashedBrand: true };
    export type boolType = boolean;
    export type tzType = Date;
}
