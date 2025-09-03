// log_store.ts
import type { LogStore, AccessLogRecord } from "./chttpx";
import { Default } from "../database/connection"; // your facade

export function createDbLogStore(): LogStore {
    return {
        async writeAccess(rec: AccessLogRecord) {
            const db = await Default();
            await db.Query(
                `INSERT INTO access_logs
           (ts, method, url, path, status, duration_ms, bytes, ip, request_id, user_agent, referer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    rec.ts, rec.method, rec.url, rec.path, rec.status, rec.duration_ms,
                    rec.bytes, rec.ip ?? null, rec.request_id, rec.user_agent ?? null, rec.referer ?? null
                ]
            );
        },
        async writeError(err, ctx) {
            const db = await Default();
            await db.Query(
                `INSERT INTO error_logs
           (ts, method, url, path, ip, request_id, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    ctx.ts ?? new Date().toISOString(),
                    ctx.method ?? null, ctx.url ?? null, ctx.path ?? null,
                    ctx.ip ?? null, ctx.request_id ?? null,
                    String((err && (err.stack || err.message)) || err)
                ]
            );
        }
    };
}
