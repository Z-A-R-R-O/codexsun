// decorators.ts — Legacy (experimentalDecorators) decorators
import "reflect-metadata";

const META_KEY = {
    table: Symbol("table"),
    columns: Symbol("columns"),
};

export interface ColumnOptions {
    primary?: boolean;
    type?: string;
    nullable?: boolean;
    default?: any;
    unique?: boolean;
}

/* ───────────────
 * @Table(name)
 * ─────────────── */
export function Table(name: string): ClassDecorator {
    return (target: Function) => {
        Reflect.defineMetadata(META_KEY.table, name, target);
    };
}

/* ───────────────
 * @Column(options)
 * ─────────────── */
export function Column(options: ColumnOptions = {}): PropertyDecorator {
    return (target: Object, propertyKey: string | symbol) => {
        if (!target) return;
        const ctor = (target as any).constructor;
        const columns: Record<string, ColumnOptions> =
            Reflect.getMetadata(META_KEY.columns, ctor) || {};
        columns[String(propertyKey)] = options;
        Reflect.defineMetadata(META_KEY.columns, columns, ctor);
    };
}

/* ───────────────
 * Helpers
 * ─────────────── */
export function getTableName(target: any): string {
    return Reflect.getMetadata(META_KEY.table, target) || target.table;
}

export function getSchema(target: any): Record<string, ColumnOptions> {
    return Reflect.getMetadata(META_KEY.columns, target) || {};
}
