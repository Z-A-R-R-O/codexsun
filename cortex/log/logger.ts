// cortex/log/logger.ts — robust console logger + optional file sink
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type TimeFormat = "iso" | "epoch" | "none";
export type Layout = "text" | "json";

const EMOJI: Record<string, string> = {
    trace: "🧭", debug: "🔧", info: "ℹ️", warn: "⚠️", error: "❌", fatal: "💥",
    access: "📨", start: "🚀", stop: "🛑", success: "✅",
};

const LEVEL_NUM: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export interface AccessLogRecord {
    ts?: string;
    method?: string;
    url?: string;
    path?: string;
    status?: number;
    duration_ms?: number;
    bytes?: number;
    ip?: string;
    ua?: string;
    msg?: string;
}

export interface LoggerOptions {
    name?: string;
    level?: LogLevel;
    layout?: Layout;                 // console format (default from env)
    json?: boolean;                  // back-compat: overrides layout if provided
    emoji?: boolean;
    color?: boolean;
    time?: TimeFormat;
    console?: boolean;
    /** file sink config or false to disable */
    file?: { path?: string; append?: boolean; format?: Layout } | false;
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

    /** Accepts either AccessLogRecord OR (message, ctx) for compatibility */
    access(rec: AccessLogRecord | string, ctx?: Record<string, unknown>): void;
}

const pickTTY = () => process.stdout?.isTTY ?? false;
const nowISO = () => new Date().toISOString();

function levelFromEnv(): LogLevel {
    const v = String(process.env.LOG_LEVEL || "").toLowerCase();
    if (["trace", "debug", "info", "warn", "error", "fatal"].includes(v)) return v as LogLevel;
    return process.env.APP_DEBUG === "true" ? "debug" : "info";
}
function layoutFromEnv(): Layout {
    const v = String(process.env.LOG_JSON || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on" ? "json" : "text";
}

function colorFn(level: LogLevel) {
    const C = {
        gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
        blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
        cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
        yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
        red: (s: string) => `\x1b[31m${s}\x1b[0m`,
        magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
        bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    };
    switch (level) {
        case "trace": return C.gray;
        case "debug": return C.cyan;
        case "info":  return C.blue;
        case "warn":  return C.yellow;
        case "error": return C.red;
        case "fatal": return (s: string) => C.bold(C.red(s));
    }
}

function ensureDirFor(filePath?: string) {
    if (!filePath) return; // ← safe: no-op when disabled/undefined
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeFileSink(targetPath?: string, append = true) {
    if (!targetPath) {
        // disabled sink (no file path)
        return { write: (_line: string) => {} };
    }
    ensureDirFor(targetPath);
    let stream: fs.WriteStream | undefined;

    const open = () => {
        stream = fs.createWriteStream(targetPath, { flags: append ? "a" : "w" });
        stream.on("error", () => { try { stream?.destroy(); } catch {} setTimeout(open, 250); });
    };
    open();

    return {
        write(line: string) {
            try {
                // If stream died, try to reopen quickly
                if (!stream || (stream as any).destroyed) open();
                stream!.write(line + "\n");
            } catch {
                // swallow file errors
            }
        }
    };
}

function redactObj(obj: Record<string, unknown> | undefined, redact?: string[]) {
    if (!obj || !redact?.length) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redact.includes(k) ? "[REDACTED]" : v;
    return out;
}

export function makeLogger(opts: LoggerOptions = {}): Logger {
    const layout: Layout =
        typeof opts.json === "boolean" ? (opts.json ? "json" : "text") : (opts.layout ?? layoutFromEnv());

    const base = {
        name: opts.name ?? "server",
        level: opts.level ?? levelFromEnv(),
        layout,
        emoji: opts.emoji ?? true,
        color: opts.color ?? pickTTY(),
        time: opts.time ?? "iso",
        console: opts.console ?? true,
        file: (() => {
            if (opts.file === false) return false;
            const defPath = process.env.LOG_FILE_PATH || path.resolve(process.cwd(), "storage", "framework", "log.txt");
            const given = opts.file ?? {};
            return {
                path: given.path || defPath,                  // ← always a string here
                append: given.append !== false,
                format: given.format || layout,
            };
        })(),
        context: opts.context ?? {},
        includePid: opts.includePid ?? true,
        includeHostname: opts.includeHostname ?? true,
        redact: opts.redact ?? ["password", "token", "secret"],
        sampler: opts.sampler ?? (() => true),
    } as Required<Omit<LoggerOptions, "file">> & { file: LoggerOptions["file"] | { path: string; append: boolean; format: Layout } };

    // sinks
    const fileSink = base.file ? makeFileSink((base.file as any).path, (base.file as any).append) : undefined;
    const fileFormat: Layout = base.file ? (base.file as any).format : base.layout;

    const app = (base.context as any).app || process.env.APP_NAME || "App";
    const host = base.includeHostname ? os.hostname() : undefined;
    const pid = base.includePid ? process.pid : undefined;

    function fmt(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
        const t = base.time === "iso" ? nowISO() : base.time === "epoch" ? String(Date.now()) : undefined;
        const body = {
            t, app, host, pid, name: base.name, level,
            msg, ...(ctx ? redactObj(ctx, base.redact) : {}),
        };

        if (base.layout === "json") {
            return JSON.stringify(body);
        }

        const cf = colorFn(level);
        const icon = base.emoji ? (EMOJI[level] || "") + " " : "";
        const head = [
            icon + (t ? `${t} ` : ""),
            app ? `${app} ` : "",
            `${level.toUpperCase()}:`,
        ].join("");
        const tail = ctx && Object.keys(ctx).length ? " " + JSON.stringify(redactObj(ctx, base.redact)) : "";
        return (base.color ? cf(head) : head) + " " + msg + tail;
    }

    function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
        if (!base.sampler(level, msg, ctx)) return;
        if (LEVEL_NUM[base.level] > LEVEL_NUM[level]) return;

        const line = fmt(level, msg, ctx);
        if (base.console) {
            const fn = level === "error" || level === "fatal" ? console.error : level === "warn" ? console.warn : console.log;
            fn(line);
        }
        if (fileSink) {
            const fileLine = fileFormat === "json" ? JSON.stringify({ ...JSON.parse(line), type: "log" }) : line;
            fileSink.write(fileLine);
        }
    }

    function writeAccess(rec: AccessLogRecord | string, extra?: Record<string, unknown>) {
        if (typeof rec === "string") {
            // compatibility: access("METHOD /path?x", { ip, ua, ms })
            return write("info", rec, extra);
        }
        const data: AccessLogRecord = { ts: rec.ts || nowISO(), ...rec };
        const line =
            base.layout === "json"
                ? JSON.stringify({ type: "access", app, host, pid, name: base.name, ...data })
                : `${base.emoji ? EMOJI.access + " " : ""}${data.ts} ${app} ACCESS: ${data.method || ""} ${data.path || data.url || ""} ${data.status ?? ""} ${data.duration_ms ?? ""}ms`;
        if (base.console) console.log(line);
        if (fileSink) fileSink.write(line);
    }

    return {
        get level() { return base.level; },
        set level(v: LogLevel) { (base as any).level = v; },

        options() { return Object.freeze({ ...base, file: base.file }); },

        trace: (m, c) => write("trace", m, c),
        debug: (m, c) => write("debug", m, c),
        info:  (m, c) => write("info",  m, c),
        warn:  (m, c) => write("warn",  m, c),
        error: (m, c) => write("error", m instanceof Error ? m.message : m, m instanceof Error ? { ...(c||{}), err: { name: m.name, message: m.message, stack: m.stack } } : c),
        fatal: (m, c) => write("fatal", m instanceof Error ? m.message : m, m instanceof Error ? { ...(c||{}), err: { name: m.name, message: m.message, stack: m.stack } } : c),

        success: (m, c) => write("info",  m, { ...(c||{}), ok: true }),
        start:   (m, c) => write("info",  m, { ...(c||{}), phase: "start" }),
        stop:    (m, c) => write("info",  m, { ...(c||{}), phase: "stop" }),

        access: writeAccess,
    };
}

// Backwards-compatible factory
export function createServerLogger(options: Partial<LoggerOptions> = {}): Logger {
    return makeLogger({
        name: options.name ?? "server",
        emoji: options.emoji ?? true,
        layout: options.layout ?? (typeof options.json === "boolean" ? (options.json ? "json" : "text") : undefined),
        color: options.color,
        level: options.level ?? levelFromEnv(),
        time: options.time ?? "iso",
        console: options.console ?? true,
        // Default the file path if not provided, but allow disabling via file:false
        file: options.file === false ? false : (options.file ?? {
            path: process.env.LOG_FILE_PATH || path.resolve(process.cwd(), "storage", "framework", "log.txt"),
            append: true,
            format: (process.env.LOG_FILE_FORMAT === "json" ? "json" : "text") as Layout,
        }),
        includePid: options.includePid ?? true,
        includeHostname: options.includeHostname ?? true,
        redact: options.redact ?? ["password", "token", "secret"],
        context: { app: process.env.APP_NAME || "CodexSun", version: process.env.APP_VERSION || "1.0.0", ...(options.context || {}) },
        sampler: options.sampler,
    });
}

// Optional shorthand
export const createLogger = createServerLogger;
