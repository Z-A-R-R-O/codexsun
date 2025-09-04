// audit.service.ts
import { AuditLog } from "./audit.model";
import { mdb } from "../../database/db";

export class AuditService {
    static async log(
        action: "create" | "update" | "delete",
        table: string,
        recordId: string,
        data: any,
        userId?: string,
        oldData?: any
    ): Promise<void> {
        const log = {
            table_name: table,
            action,
            record_id: recordId,
            user_id: userId || null,
            old_data: oldData ? JSON.stringify(oldData) : null,
            new_data: data ? JSON.stringify(data) : null,
            created_at: new Date().toISOString(),
        };

        await mdb.query(
            `INSERT INTO ${AuditLog.table} 
             (table_name, action, record_id, user_id, old_data, new_data, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                log.table_name,
                log.action,
                log.record_id,
                log.user_id,
                log.old_data,
                log.new_data,
                log.created_at,
            ]
        );
    }
}
