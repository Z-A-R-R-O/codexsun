export enum ColumnType {
    Primary = "primary",
    String = "string",
    Email = "email",
    Boolean = "boolean",
    DateTime = "datetime",
    SoftDelete = "softdelete", // 🔥 new
}

// branded types
export type PrimaryKey = number & { __brand: "pk" };
export type Str = string & { __brand: "str" };
export type Email = string & { __brand: "email" };
export type Bool = boolean & { __brand: "bool" };
export type DateTime = Date & { __brand: "datetime" };
export type SoftDelete = Date | null;
