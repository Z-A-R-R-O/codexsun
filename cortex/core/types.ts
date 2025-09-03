// branded types (type-safe at compile time)
export type PrimaryKey = number & { __pk: true };
export type Email = string & { __email: true };
export type Hashed = string & { __hashed: true };
export type Bool = boolean & { __bool: true };
export type DateTime = Date & { __datetime: true };
export type Str = string & { __str: true };

// column types for schema
export enum ColumnType {
    String = "string",
    Boolean = "boolean",
    DateTime = "datetime",
    Primary = "primary",
    Email = "email",
}
