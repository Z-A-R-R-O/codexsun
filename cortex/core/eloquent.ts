import { ORM } from "./orm";
import { QueryBuilder } from "./query-builder";

export abstract class Eloquent {
    static orm = new ORM();

    static query() {
        return new QueryBuilder();
    }

    static find(id: number) {
        return this.orm.select((this as any).table, `id = ${id}`);
    }
}
