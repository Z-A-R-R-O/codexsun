// cortex/log/logger.ts
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
    ts?: string; method?: string; url?: string; path?: string; status?: number; duration_ms?: number;
    bytes?: number; ip?: string; ua?: string; msg?: string;
}

export interface LoggerOptions {
    name?: string;
    level?: LogLevel;
    layout?: Layout;                 // console format
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
    access(rec: AccessLogRecord | string, ctx?: Record<string, unknown>): void;
}

// ---- internals ----
type InternalFile = false | { path: string; append: boolean; format: Layout };
type InternalOptions = Required<Omit<LoggerOptions, "file">> & { file: InternalFile };

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

function redactObj(obj: Record<string, unknown> | undefined, redact?: string[]) {
    if (!obj || !redact?.length) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redact.includes(k) ? "[REDACTED]" : v;
    return out;
}

function makeFileSink(filePath: string, append: boolean) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stream = fs.createWriteStream(filePath, { flags: append ? "a" : "w" });
    stream.on("error", () => { try { stream?.destroy(); } catch {} });
    return { write(line: string) { try { stream.write(line + "\n"); } catch {} } };
}

export function makeLogger(opts: LoggerOptions = {}): Logger {
    const layout: Layout =
        typeof opts.json === "boolean" ? (opts.json ? "json" : "text") : (opts.layout ?? layoutFromEnv());


    const jsonFlag = typeof opts.json === "boolean" ? opts.json : (layout === "json");

    const defaultFile: InternalFile =
        opts.file === false
            ? false
            : {
                path: (opts.file?.path) || (process.env.LOG_FILE_PATH || path.resolve(process.cwd(), "storage", "framework", "log.txt")),
                append: opts.file?.append !== false,
                format: (opts.file?.format) ?? ((process.env.LOG_FILE_FORMAT === "json" ? "json" : "text") as Layout),
            };

    const base: InternalOptions = {
        name: opts.name ?? (process.env.APP_NAME || "CodexSun"),
        level: opts.level ?? levelFromEnv(),
        layout,
        json: jsonFlag,
        emoji: opts.emoji ?? true,
        color: opts.color ?? pickTTY(),
        time: opts.time ?? "iso",
        console: opts.console ?? true,
        file: defaultFile,
        context: opts.context ?? {},
        includePid: opts.includePid ?? true,
        includeHostname: opts.includeHostname ?? true,
        redact: opts.redact ?? ["password", "token", "secret"],
        sampler: opts.sampler ?? (() => true),
    };

    const fileSink = base.file ? makeFileSink(base.file.path, base.file.append) : undefined;

    function fmt(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
        const t = base.time === "iso" ? nowISO() : base.time === "epoch" ? String(Date.now()) : undefined;
        const cf = colorFn(level);

        // ✅ show green check for success-tagged info logs
        const icon = base.emoji
            ? (((ctx as any)?.__success ? EMOJI.success : (EMOJI[level] || "")) + " ")
            : "";

        const head =
            (t ? `${t} ` : "") +
            (base.name ? `${base.name} ` : "") +
            `${level.toUpperCase()}:`;

        const tail = ctx && Object.keys(ctx).length ? " " + JSON.stringify(redactObj(ctx, base.redact)) : "";
        return (base.color ? cf(icon + head) : icon + head) + " " + msg + tail;
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
            const out = base.layout === "json"
                ? JSON.stringify({ t: nowISO(), name: base.name, level, msg, ...(ctx ? redactObj(ctx, base.redact) : {}) })
                : line;
            fileSink.write(out);
        }
    }

    return {
        get level() { return base.level; },
        set level(v: LogLevel) { (base as any).level = v; },

        options(): Readonly<LoggerOptions> {
            const file: LoggerOptions["file"] =
                base.file === false ? false : { path: base.file.path, append: base.file.append, format: base.file.format };
            // return exactly LoggerOptions shape (no booleans except 'false')
            return Object.freeze({
                name: base.name,
                level: base.level,
                layout: base.layout,
                emoji: base.emoji,
                color: base.color,
                time: base.time,
                console: base.console,
                file,
                context: base.context,
                includePid: base.includePid,
                includeHostname: base.includeHostname,
                redact: base.redact,
                sampler: base.sampler,
            });
        },

        trace: (m, c) => write("trace", m, c),
        debug: (m, c) => write("debug", m, c),
        info:  (m, c) => write("info",  m, c),
        warn:  (m, c) => write("warn",  m, c),
        error: (m, c) => write("error", m instanceof Error ? m.message : m, m instanceof Error ? { ...(c||{}), err: { name: m.name, message: m.message, stack: m.stack } } : c),
        fatal: (m, c) => write("fatal", m instanceof Error ? m.message : m, m instanceof Error ? { ...(c||{}), err: { name: m.name, message: m.message, stack: m.stack } } : c),

        // success -> info level, but tagged so fmt() shows ✅
        success: (m, c) => write("info", m, { ...(c||{}), ok: true, __success: true }),
        start:   (m, c) => write("info", m, { ...(c||{}), phase: "start" }),
        stop:    (m, c) => write("info", m, { ...(c||{}), phase: "stop" }),

        access(rec: AccessLogRecord | string, extra?: Record<string, unknown>) {
            if (typeof rec === "string") return write("info", rec, extra);
            const data: AccessLogRecord = { ts: rec.ts || nowISO(), ...rec };
            const line = `${base.emoji ? EMOJI.access + " " : ""}${data.ts} ${base.name} ACCESS: ${data.method || ""} ${data.path || data.url || ""} ${data.status ?? ""} ${data.duration_ms ?? ""}ms`;
            if (base.console) console.log(line);
            if (fileSink) fileSink.write(line);
        },
    };
}

// Shorthand
export const createLogger = makeLogger;
