// tenant.model.ts — TS5-safe model
import { Model } from "../../../../cortex/core/model";
import { Table, Column } from "../../../../cortex/core/decorators";

@Table("tenants")
export class Tenant extends Model {
    static table = "tenants";

    @Column({ type: "string" })
    name!: string;

    @Column({ type: "string", nullable: true })
    email?: string;
}
