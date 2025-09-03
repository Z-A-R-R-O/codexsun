import "reflect-metadata";
import { Schema } from "./schema";
import { ColumnType } from "./types";

const SCHEMA_KEY = Symbol("schema");

function addColumn(target: any, propertyKey: string, type: ColumnType) {
    let schema: Schema = Reflect.getMetadata(SCHEMA_KEY, target.constructor) || new Schema();

    // get runtime design type (Number, String, Boolean, Date, etc.)
    const tsType = Reflect.getMetadata("design:type", target, propertyKey);

    schema.addColumn({
        name: propertyKey,
        type,
        tsType: tsType?.name || "unknown",
    });

    Reflect.defineMetadata(SCHEMA_KEY, schema, target.constructor);
}

// generic
export function Column(type: ColumnType) {
    return function (target: any, propertyKey: string) {
        addColumn(target, propertyKey, type);
    };
}

// shorthand
export function PrimaryKey() { return Column(ColumnType.Primary); }
export function Email() { return Column(ColumnType.Email); }
export function String() { return Column(ColumnType.String); }
export function BooleanCol() { return Column(ColumnType.Boolean); }
export function DateTime() { return Column(ColumnType.DateTime); }

// schema retriever
export function GetSchema(target: any): Schema {
    return Reflect.getMetadata(SCHEMA_KEY, target) || new Schema();
}
