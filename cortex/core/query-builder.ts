export class QueryBuilder {
    private _where: string[] = [];

    where(field: string, op: string, value: any): this {
        this._where.push(`${field} ${op} '${value}'`);
        return this;
    }

    toSQL(base: string): string {
        return base + (this._where.length ? " WHERE " + this._where.join(" AND ") : "");
    }
}
