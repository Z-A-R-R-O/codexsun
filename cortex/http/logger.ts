// cortex/http/logger.ts — JSON console logger + pluggable DB sink
export interface AccessLogRecord {
    ts: string;
    method: string;
    url: string;
    path: string;
    status: number;
    duration_ms: number;
    bytes: number;
    ip?: string;
    request_id: string;
    user_agent?: string;
    referer?: string;
}
export interface LoggerOptions {
    access?: (rec: AccessLogRecord) => void;
    error?: (err: any, ctx: Partial<AccessLogRecord>) => void;
}
export interface LogStore {
    writeAccess(rec: AccessLogRecord): Promise<void> | void;
    writeError(err: any, ctx: Partial<AccessLogRecord>): Promise<void> | void;
}

// Simple console JSON logger
export function createConsoleJsonLogger(store?: LogStore): LoggerOptions {
    return {
        access: (rec) => {
            console.log(JSON.stringify({ level: "access", ...rec }));
            store?.writeAccess(rec);
        },
        error: (e, ctx) => {
            console.error(JSON.stringify({ level: "error", ...ctx, error: String(e?.stack || e) }));
            store?.writeError?.(e, ctx || {});
        },
    };
}

// Compose multiple loggers
export function composeLogger(...loggers: (LoggerOptions | undefined)[]): LoggerOptions {
    return {
        access: (rec) => loggers.forEach(l => l?.access?.(rec)),
        error:  (e, ctx) => loggers.forEach(l => l?.error?.(e, ctx)),
    };
}
