// import os from "os";
// import chalk from "chalk";
//
// export interface FastifyLog {
//     level: number;
//     time: number;
//     pid: number;
//     hostname: string;
//     reqId: string;
//     res?: { statusCode: number };
//     responseTime?: number;
//     msg: string;
// }
//
// function formatDate(epoch: number): string {
//     const d = new Date(epoch);
//     const pad = (n: number) => String(n).padStart(2, "0");
//     return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
//         d.getHours()
//     )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// }
//
// export function formatServerLog(log: FastifyLog): string {
//     const date = formatDate(log.time);
//
//     const levelMap: Record<number, string> = {
//         10: chalk.gray("🔍 TRACE"),
//         20: chalk.blue("🐛 DEBUG"),
//         30: chalk.green("ℹ️ INFO"),
//         40: chalk.yellow("⚠️ WARN"),
//         50: chalk.red.bold("❌ ERROR"),
//         60: chalk.magentaBright("💀 FATAL"),
//     };
//
//     const levelText = levelMap[log.level] || chalk.white(`LVL${log.level}`);
//     const status = log.res?.statusCode ? chalk.cyan(` status=${log.res.statusCode}`) : "";
//     const response =
//         log.responseTime !== undefined
//             ? chalk.magenta(` responseTime=${log.responseTime.toFixed(2)}ms`)
//             : "";
//
//     return (
//         chalk.dim(`[${date}]`) +
//         ` [${levelText}] ` +
//         chalk.gray(`(pid=${log.pid} host=${log.hostname} reqId=${log.reqId ?? "-"})`) +
//         " " +
//         log.msg +
//         status +
//         response
//     ).trim();
// }
//
// /**
//  * Internal class — NOT exported directly.
//  */
// class ServerLoggerClass {
//     private context: string;
//     private startTime: number;
//     private timers: Record<string, number>;
//
//     constructor(context: string) {
//         this.context = context;
//         this.startTime = Date.now();
//         this.timers = {};
//     }
//
//     info(msg: string) {
//         console.log(chalk.green(`✅ [INFO][${this.context}]`), msg);
//     }
//
//     warn(msg: string) {
//         console.warn(chalk.yellow(`⚠️ [WARN][${this.context}]`), msg);
//     }
//
//     error(msg: string) {
//         console.error(chalk.red.bold(`❌ [ERROR][${this.context}]`), msg);
//     }
//
//     startTimer(label: string) {
//         this.timers[label] = Date.now();
//         console.log(chalk.blue(`⏱️ [TIMER][${this.context}]`), `Started "${label}"`);
//     }
//
//     endTimer(label: string) {
//         const start = this.timers[label];
//         if (start) {
//             const duration = Date.now() - start;
//             console.log(
//                 chalk.blue(`⏱️ [TIMER][${this.context}]`),
//                 `Ended "${label}" in ${chalk.magenta(duration + "ms")}`
//             );
//             delete this.timers[label];
//         } else {
//             this.error(`Timer "${label}" not found`);
//         }
//     }
//
//     progress(current: number, total: number) {
//         const percent = ((current / total) * 100).toFixed(1);
//         console.log(
//             chalk.cyan(`📊 [PROGRESS][${this.context}]`),
//             `${current}/${total} (${percent}%)`
//         );
//     }
//
//     elapsed() {
//         const ms = Date.now() - this.startTime;
//         const sec = (ms / 1000).toFixed(2);
//         console.log(chalk.magenta(`⏲️ [ELAPSED][${this.context}]`), `${sec}s`);
//     }
//
//     static oneOff(message: string) {
//         const log: FastifyLog = {
//             level: 30,
//             time: Date.now(),
//             pid: process.pid,
//             hostname: os.hostname(),
//             reqId: "startup",
//             msg: message,
//         };
//         console.log(formatServerLog(log));
//     }
// }
//
// /**
//  * Proxy wrapper: allows both
//  *   new ServerLogger("ctx")
//  * and
//  *   ServerLogger("msg")
//  */
// export const ServerLogger: any = new Proxy(ServerLoggerClass as any, {
//     apply(_target, _thisArg, argArray) {
//         ServerLoggerClass.oneOff(argArray[0]);
//     },
// });
