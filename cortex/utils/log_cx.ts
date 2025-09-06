// // cortex/logger/logger.ts
// import { format } from "node:util";
//
// type Level = "debug" | "info" | "warn" | "error";
// type Stage = "development" | "production" | "test";
//
// const stage: Stage = (process.env.NODE_ENV as Stage) || "development";
// const isProd = stage === "production";
//
// type Context = Record<string, unknown>;
//
// function ts() {
//     return new Date().toISOString();
// }
//
// function serialize(obj: unknown) {
//     if (obj instanceof Error) {
//         return { name: obj.name, message: obj.message, stack: obj.stack };
//     }
//     return obj;
// }
//
// function writeLine(level: Level, msg: string, ctx?: Context) {
//     if (isProd) {
//         // JSON line for production
//         const line = {
//             time: ts(),
//             level,
//             message: msg,
//             ...Object.fromEntries(
//                 Object.entries(ctx || {}).map(([k, v]) => [k, serialize(v)])
//             ),
//         };
//         process.stdout.write(JSON.stringify(line) + "\n");
//     } else {
//         // Pretty for dev
//         const badge =
//             level === "debug" ? "🐞"
//                 : level === "info" ? "ℹ️ "
//                     : level === "warn" ? "⚠️ "
//                         : "🛑";
//         const ctxText = ctx && Object.keys(ctx).length
//             ? " " + format(ctx)
//             : "";
//         process.stdout.write(`${badge} ${level.toUpperCase()} ${ts()} ${msg}${ctxText}\n`);
//     }
// }
//
// function makeLogger(boundCtx: Context = {}) {
//     const log = {
//         level: (process.env.LOG_LEVEL as Level) || (isProd ? "info" : "debug"),
//
//         debug(msg: string, ctx?: Context) {
//             if (["debug"].includes(this.level)) writeLine("debug", msg, { ...boundCtx, ...ctx });
//         },
//         info(msg: string, ctx?: Context) {
//             if (["debug", "info"].includes(this.level)) writeLine("info", msg, { ...boundCtx, ...ctx });
//         },
//         warn(msg: string, ctx?: Context) {
//             if (["debug", "info", "warn"].includes(this.level)) writeLine("warn", msg, { ...boundCtx, ...ctx });
//         },
//         error(msg: string, ctx?: Context) {
//             writeLine("error", msg, { ...boundCtx, ...ctx });
//         },
//
//         // create a child logger that always includes some context
//         child(extra: Context) {
//             return makeLogger({ ...boundCtx, ...extra });
//         },
//     };
//
//     return log;
// }
//
// export type Logger = ReturnType<typeof makeLogger>;
// export const logger: Logger = makeLogger();
