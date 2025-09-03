// cortex/core/SchemaConnector.ts
import type { Model } from "./model";
import type { TableDefFn } from "../../migration/Blueprint";
import Builder, { defineTable } from "../../migration/Builder";

/**
 * Initializes schema for a Model using a TableDefFn (DSL) and a dialect Builder.
 * - Attaches the schema JSON to Model._schema (columns + constraints)
 * - Returns the CREATE TABLE SQL (dialect-specific)
 */
export function initSchemaFromDSL(
    ModelClass: typeof Model,
    builder: Builder,
    def: TableDefFn
): string {
    const tableName = (ModelClass as any).table;
    if (!tableName) throw new Error(`Model ${ModelClass.name} is missing static 'table'`);

    // Build SQL via your dialect Builder
    const { content } = builder.buildCreateTable(tableName, def);

    // Build schema JSON via your helper (driver-agnostic)
    const built = defineTable(tableName, def);
    (ModelClass as any)._schema = {
        name: built.name,
        columns: built.columns,
        constraints: built.constraints,
    };

    return content;
}
