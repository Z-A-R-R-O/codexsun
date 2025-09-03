// logger.ts — Unified logger with robust file saving (reopen on error, drain-aware, flush on exit)
// - Text or JSON layout (switchable for console and file)
// - Server/CLI/Test presets
// - Emoji toggle (console only)
// - No DB store; file-only

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ────────────────────────────────────────────────────────────────────────────────
// 🎭 Emoji Map (toggle with options.emoji)
// ────────────────────────────────────────────────────────────────────────────────
const EMOJI = {
    trace: "🧭",
    debug: "🔧",
    info: "ℹ️",
    success: "✅",
    warn: "⚠️",
    error: "❌",
    fatal: "💥",
    access: "📨",
    start: "🚀",
    stop: "🛑",
    test: { pass: "✅", fail: "❌", skip: "⏭️" },
} as const;

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const LEVEL_NUM: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
export type TimeFormat = "iso" | "epoch" | "none";
export type Layout = "text" | "json";

export interface AccessLogRecord {
    ts?: string;
    method: string;
    url?: string;
    path?: string;
    status: number;
    duration_ms?: number;
    bytes?: number;
    ip?: string;
    request_id?: string;
    user_agent?: string;
    referer?: string;
}

export interface ErrorContext {
    ts?: string;
    method?: string;
    url?: string;
    path?: string;
    ip?: string;
    request_id?: string;
}

export interface LoggerOptions {
    name?: string;
    level?: LogLevel;
    layout?: Layout; // console format
    json?: boolean; // back-compat; overrides layout when provided
    emoji?: boolean;
    color?: boolean;
    time?: TimeFormat;
    console?: boolean;
    file?: { path: string; append?: boolean; format?: Layout } | false;
    context?: Record<string, unknown>;
    includePid?: boolean;
    includeHostname?: boolean;
    redact?: string[];
    sampler?: (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => boolean;
}

export interface Logger {
    level: LogLevel;
    options(): Readonly<LoggerOptions>;
    trace(msg: string, ctx?: Record<string, unknown>): void;
    debug(msg: string, ctx?: Record<string, unknown>): void;
    info(msg: string, ctx?: Record<string, unknown>): void;
    warn(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string | Error, ctx?: Record<string, unknown>): void;
    fatal(msg: string | Error, ctx?: Record<string, unknown>): void;
    success(msg: string, ctx?: Record<string, unknown>): void;
    start(msg: string, ctx?: Record<string, unknown>): void;
    stop(msg: string, ctx?: Record<string, unknown>): void;
    access(rec: AccessLogRecord): void;
    errorWithContext(err: unknown, ctx?: ErrorContext & Record<string, unknown>): void;
    pass(msg: string, ctx?: Record<string, unknown>): void;
    fail(msg: string, ctx?: Record<string, unknown>): void;
    skip(msg: string, ctx?: Record<string, unknown>): void;
    child(extra: Record<string, unknown>): Logger;
}

// ────────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────────
const pickTTY = () => Boolean(process.stdout && (process.stdout as any).isTTY);
const nowISO = () => new Date().toISOString();
const toEpoch = () => Date.now();

function ensureDirFor(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function redactObj(obj: Record<string, unknown> | undefined, redact?: string[]) {
    if (!obj || !redact?.length) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redact.includes(k) ? "[REDACTED]" : v;
    return out;
}

const COLOR = {
    gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
    blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function colorFor(level: LogLevel) {
    switch (level) {
        case "trace": return COLOR.gray;
        case "debug": return COLOR.cyan;
        case "info": return COLOR.blue;
        case "warn": return COLOR.yellow;
        case "error": return COLOR.red;
        case "fatal": return (s: string) => COLOR.bold(COLOR.red(s));
    }
}

function levelFromEnv(): LogLevel {
    const v = String(process.env.LOG_LEVEL || "").toLowerCase();
    if (["trace","debug","info","warn","error","fatal"].includes(v)) return v as LogLevel;
    return process.env.APP_DEBUG === "true" ? "debug" : "info";
}

function layoutFromEnv(): Layout {
    const v = String(process.env.LOG_FORMAT || "text").toLowerCase();
    return v === "json" ? "json" : "text";
}

// ────────────────────────────────────────────────────────────────────────────────
// Robust file sink
// ────────────────────────────────────────────────────────────────────────────────
function makeFileSink(targetPath: string, append = true) {
    ensureDirFor(targetPath);
    let stream: fs.WriteStream | undefined;
    let queue: string[] = [];
    let opening = false;

    const open = () => {
        if (opening) return; opening = true;
        try {
            stream = fs.createWriteStream(targetPath, { flags: append ? "a" : "w" });
            stream.on("error", onError);
            stream.on("close", onClose);
            stream.on("drain", flushQueue);
        } finally {
            opening = false;
        }
    };

    const onError = (_err: any) => {
        // Try to reopen shortly; keep queue in memory
        try { stream?.destroy(); } catch {}
        stream = undefined;
        setTimeout(open, 250);
    };
    const onClose = () => {
        stream = undefined;
        setTimeout(open, 0);
    };

    const flushQueue = () => {
        if (!stream) return;
        while (queue.length) {
            const line = queue.shift()!;
            if (!stream.write(line)) {
                // backpressure again; wait for next drain
                break;
            }
        }
    };

    const write = (line: string) => {
        if (!stream) open();
        const toWrite = line.endsWith("\n") ? line : line + "\n";
        if (stream) {
            if (!stream.write(toWrite)) {
                queue.push(toWrite);
            }
        } else {
            // As a last-resort fallback (very early startup), append synchronously
            try {
                fs.appendFileSync(targetPath, toWrite);
            } catch {
                // swallow; we'll retry once stream opens
                queue.push(toWrite);
            }
        }
    };

    const close = () => {
        try { stream?.end(); } catch {}
    };

    // Open immediately
    open();

    // Best-effort cleanup on process exit
    process.on("beforeExit", close);
    process.on("SIGINT", () => { close(); process.exit(0); });
    process.on("SIGTERM", () => { close(); process.exit(0); });

    return { write };
}

// ────────────────────────────────────────────────────────────────────────────────
// Logger factory
// ────────────────────────────────────────────────────────────────────────────────
export function makeLogger(opts: LoggerOptions = {}): Logger {
    const layout: Layout = typeof opts.json === "boolean" ? (opts.json ? "json" : "text") : (opts.layout ?? layoutFromEnv());

    const base = {
        name: opts.name,
        level: opts.level ?? levelFromEnv(),
        layout,
        emoji: opts.emoji ?? true,
        color: opts.color ?? pickTTY(),
        time: opts.time ?? "iso",
        console: opts.console ?? true,
        file: opts.file === false ? false : opts.file ?? false,
        context: opts.context ?? {},
        includePid: opts.includePid ?? true,
        includeHostname: opts.includeHostname ?? true,
        redact: opts.redact ?? [],
        sampler: opts.sampler ?? (() => true),
    } as Required<Omit<LoggerOptions, "file">> & { file: LoggerOptions["file"] };

    // Prepare file sink if requested
    let fileSink: { write: (line: string) => void } | undefined;
    let fileFormat: Layout = base.layout;
    if (base.file) {
        fileFormat = base.file.format || base.layout;
        fileSink = makeFileSink(base.file.path, base.file.append !== false);
    }

    function timeStamp(): string | number | undefined {
        if (base.time === "iso") return nowISO();
        if (base.time === "epoch") return toEpoch();
        return undefined;
    }

    // Text layout (bracketed)
    function fmtTextLine(level: LogLevel, msg: string, ctx?: Record<string, unknown>, forFile = false) {
        const t = timeStamp();
        const ts = t == null ? "" : `[${t}]`;
        const lvl = `[${level.toUpperCase()}]`;
        const meta: string[] = [];
        if (base.name) meta.push(`name=${base.name}`);
        if (base.includePid) meta.push(`pid=${process.pid}`);
        if (base.includeHostname) meta.push(`host=${os.hostname()}`);
        const metaStr = meta.length ? `[${meta.join(" ")}]` : "";
        const emoji = (!forFile && base.emoji) ? ((EMOJI as any)[level] || "") + " " : "";
        const col = (!forFile && base.color) ? colorFor(level) : (s: string) => s;
        const ctxStr = ctx && Object.keys(ctx).length ? ` ${JSON.stringify(ctx)}` : "";
        return `${ts}${lvl}${metaStr} ${emoji}${col(level.padEnd(0))} ${msg}${ctxStr}`.trim();
    }
    function fmtAccessText(rec: AccessLogRecord, forFile = false) {
        const t = rec.ts || nowISO();
        const a = `[REQUEST method=${rec.method}${rec.path ? ` path=${rec.path}` : rec.url ? ` url=${rec.url}` : ""}${rec.ip ? ` ip=${rec.ip}` : ""}${rec.referer ? ` referer=${JSON.stringify(rec.referer)}` : ""}${rec.user_agent ? ` ua=${JSON.stringify(rec.user_agent)}` : ""}${rec.request_id ? ` rid=${rec.request_id}` : ""}]`;
        const r = `[RESPONSE status=${rec.status}${rec.duration_ms != null ? ` dur=${rec.duration_ms}ms` : ""}${rec.bytes != null ? ` bytes=${rec.bytes}` : ""}]`;
        const ts = `[${t}]`;
        const icon = (!forFile && base.emoji) ? `${EMOJI.access} ` : "";
        return `${ts}${a}${r} ${icon}`.trim();
    }

    // Writers
    function writeConsole(line: string) {
        if (base.console) process.stdout.write(line + "\n");
    }
    function writeFile(line: string) {
        fileSink?.write(line);
    }

    function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
        const red = redactObj(ctx, base.redact);
        if (!base.sampler(level, msg, red || undefined)) return;

        if (base.layout === "json") writeConsole(JSON.stringify({ ts: timeStamp(), level, level_num: LEVEL_NUM[level], name: base.name, pid: base.includePid ? process.pid : undefined, hostname: base.includeHostname ? os.hostname() : undefined, msg, ...red }));
        else writeConsole(fmtTextLine(level, msg, red, false));

        if (fileSink) {
            if (fileFormat === "json") writeFile(JSON.stringify({ ts: timeStamp(), level, name: base.name, msg, ...red }));
            else writeFile(fmtTextLine(level, msg, red, true));
        }
    }

    function writeAccess(rec: AccessLogRecord) {
        const data: AccessLogRecord = { ts: rec.ts || nowISO(), ...rec };

        if (base.layout === "json") writeConsole(JSON.stringify({ type: "access", ...data }));
        else writeConsole(fmtAccessText(data, false));

        if (fileSink) {
            if (fileFormat === "json") writeFile(JSON.stringify({ type: "access", ...data }));
            else writeFile(fmtAccessText(data, true));
        }
    }

    function toCtx(err: any): Record<string, unknown> {
        if (!err) return {};
        if (err instanceof Error) return { err: { name: err.name, message: err.message, stack: err.stack } };
        return { err: String(err) };
    }

    const api: Logger = {
        get level() { return base.level; },
        set level(v: LogLevel) { (base as any).level = v; },
        options() { return Object.freeze({ ...base, file: base.file }); },

        trace(msg, ctx) { if (LEVEL_NUM[base.level] <= LEVEL_NUM.trace) write("trace", msg, { ...base.context, ...ctx }); },
        debug(msg, ctx) { if (LEVEL_NUM[base.level] <= LEVEL_NUM.debug) write("debug", msg, { ...base.context, ...ctx }); },
        info(msg, ctx)  { if (LEVEL_NUM[base.level] <= LEVEL_NUM.info)  write("info",  msg, { ...base.context, ...ctx }); },
        warn(msg, ctx)  { if (LEVEL_NUM[base.level] <= LEVEL_NUM.warn)  write("warn",  msg, { ...base.context, ...ctx }); },
        error(msg, ctx) {
            if (LEVEL_NUM[base.level] <= LEVEL_NUM.error) {
                const isErr = msg instanceof Error;
                write("error", isErr ? msg.message : String(msg), { ...base.context, ...(ctx || {}), ...(isErr ? toCtx(msg) : {}) });
            }
        },
        fatal(msg, ctx) {
            if (LEVEL_NUM[base.level] <= LEVEL_NUM.fatal) {
                const isErr = msg instanceof Error;
                write("fatal", isErr ? msg.message : String(msg), { ...base.context, ...(ctx || {}), ...(isErr ? toCtx(msg) : {}) });
            }
        },

        success(msg, ctx) { write("info", `${EMOJI.success} ${msg}`, { ...base.context, ...ctx }); },
        start(msg, ctx)   { write("info", `${EMOJI.start} ${msg}`, { ...base.context, ...ctx }); },
        stop(msg, ctx)    { write("info", `${EMOJI.stop} ${msg}`, { ...base.context, ...ctx }); },

        access(rec) { writeAccess(rec); },

        errorWithContext(err, ctx) {
            const msg = err instanceof Error ? err.message : String(err);
            write("error", msg, { ...base.context, ...ctx, ...toCtx(err) });
        },

        pass(msg, ctx) { write("info", `${EMOJI.test.pass} ${msg}`, { ...base.context, test: { status: "pass" }, ...ctx }); },
        fail(msg, ctx) { write("error", `${EMOJI.test.fail} ${msg}`, { ...base.context, test: { status: "fail" }, ...ctx }); },
        skip(msg, ctx) { write("warn", `${EMOJI.test.skip} ${msg}`, { ...base.context, test: { status: "skip" }, ...ctx }); },

        child(extra) { return makeLogger({ ...base, context: { ...base.context, ...extra }, file: base.file }); },
    };

    return api;
}

// ────────────────────────────────────────────────────────────────────────────────
// Presets
// ────────────────────────────────────────────────────────────────────────────────
export function createServerLogger(options: Partial<LoggerOptions> = {}) {
    return makeLogger({
        name: options.name ?? "server",
        emoji: options.emoji ?? true,
        layout: options.layout ?? (typeof options.json === "boolean" ? (options.json ? "json" : "text") : undefined),
        color: options.color, // tty auto
        level: options.level ?? levelFromEnv(),
        time: options.time ?? "iso",
        console: options.console ?? true,
        file: options.file ?? { path: "storage/framework/log.txt", append: true, format: (process.env.LOG_FILE_FORMAT === "json" ? "json" : "text") },
        includePid: options.includePid ?? true,
        includeHostname: options.includeHostname ?? true,
        redact: options.redact ?? ["password", "token", "secret"],
        context: { app: process.env.APP_NAME || "CodexSun", version: process.env.APP_VERSION || "1.0.0", ...(options.context || {}) },
    });
}

export function createCliLogger(options: Partial<LoggerOptions> = {}) {
    return makeLogger({
        name: options.name ?? "cli",
        emoji: options.emoji ?? true,
        layout: options.layout ?? "text",
        level: options.level ?? levelFromEnv(),
        time: options.time ?? "iso",
        console: options.console ?? true,
        file: options.file ?? false,
        context: options.context || {},
    });
}

export function createTestLogger(options: Partial<LoggerOptions> = {}) {
    return makeLogger({
        name: options.name ?? "test",
        emoji: options.emoji ?? true,
        layout: options.layout ?? "text",
        color: options.color ?? false,
        level: options.level ?? "info",
        time: options.time ?? "none",
        console: options.console ?? true,
        file: options.file ?? false,
        context: options.context || {},
    });
}

export function createJsonLogger(options: Partial<LoggerOptions> = {}) {
    return makeLogger({ ...options, layout: "json", color: false, emoji: false });
}

// Default export used across the app
export const logger = createServerLogger();
