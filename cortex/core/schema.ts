import { ColumnType } from "./types";

export interface ColumnMeta {
    name: string;
    type: ColumnType;   // decorator intent
    tsType: string;     // runtime type
}

export class Schema {
    private columns: ColumnMeta[] = [];

    addColumn(col: ColumnMeta) {
        this.columns.push(col);
    }

    getColumns(): ColumnMeta[] {
        return this.columns;
    }

    validate(data: Record<string, any>): string[] {
        const errors: string[] = [];

        for (const col of this.columns) {
            const value = data[col.name];

            switch (col.type) {
                case ColumnType.Primary:
                    if (typeof value !== "number") errors.push(`${col.name} must be a number`);
                    break;

                case ColumnType.String:
                    if (typeof value !== "string") errors.push(`${col.name} must be a string`);
                    break;

                case ColumnType.Email:
                    if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                        errors.push(`${col.name} must be a valid email`);
                    }
                    break;

                case ColumnType.Boolean:
                    if (typeof value !== "boolean") errors.push(`${col.name} must be a boolean`);
                    break;

                case ColumnType.DateTime:
                    if (!(value instanceof Date)) errors.push(`${col.name} must be a Date`);
                    break;
            }
        }

        return errors;
    }
}
