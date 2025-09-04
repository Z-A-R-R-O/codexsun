// cortex/core/audit.model.ts

import { Model } from "../model";
import { Table, Column } from "../decorators";

@Table("audit_logs")
export class AuditLog extends Model {
    static table = "audit_logs";

    @Column({ type: "string" })
    table_name!: string;

    @Column({ type: "string" })
    action!: string;

    @Column({ type: "string" })
    record_id!: string;

    @Column({ type: "string", nullable: true })
    user_id?: string;

    @Column({ type: "string", nullable: true })
    old_data?: string;

    @Column({ type: "string", nullable: true })
    new_data?: string;

    @Column({ type: "string" })
    created_at!: string;
}
