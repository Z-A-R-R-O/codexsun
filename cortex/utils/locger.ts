// // cortex/utils/logger.ts
// // Color + timing helpers usable everywhere (ESM-safe).
//
// const ansi = {
//     reset: '\x1b[0m', bold: '\x1b[1m',
//     red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
//     blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
// };
//
// export const color = {
//     bold: (s: string) => `${ansi.bold}${s}${ansi.reset}`,
//     red: (s: string) => `${ansi.red}${s}${ansi.reset}`,
//     green: (s: string) => `${ansi.green}${s}${ansi.reset}`,
//     yellow: (s: string) => `${ansi.yellow}${s}${ansi.reset}`,
//     blue: (s: string) => `${ansi.blue}${s}${ansi.reset}`,
//     magenta: (s: string) => `${ansi.magenta}${s}${ansi.reset}`,
//     cyan: (s: string) => `${ansi.cyan}${s}${ansi.reset}`,
//     gray: (s: string) => `${ansi.gray}${s}${ansi.reset}`,
// };
//
// export const log = {
//     info:  (...a: any[]) => console.log(color.cyan('[info]'), ...a),
//     ok:    (...a: any[]) => console.log(color.green('✔'), ...a),
//     warn:  (...a: any[]) => console.warn(color.yellow('[warn]'), ...a),
//     error: (...a: any[]) => console.error(color.red('[error]'), ...a),
//     header:(t: string)   => console.log('\n' + color.bold(t)),
// };
//
// export function fmtMs(ms: number) {
//     if (ms < 1000) return `${ms}ms`;
//     const s = ms / 1000;
//     if (s < 60) return `${s.toFixed(2)}s`;
//     const m = Math.floor(s / 60);
//     const r = (s % 60).toFixed(1);
//     return `${m}m ${r}s`;
// }
//
// /** simple step/progress line */
// export function step(label: string, current: number, total?: number) {
//     if (total && total > 0) {
//         const pct = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
//         console.log(color.gray(`[step] ${label}: ${current}/${total} (${pct}%)`));
//     } else {
//         console.log(color.gray(`[step] ${label}`));
//     }
// }
//
// export class Progress {
//     private readonly total: number;
//     private readonly label: string;
//     private readonly startedAt = Date.now();
//     private lastLogAt = this.startedAt;
//
//     constructor(total: number, label = 'progress') {
//         this.total = Math.max(0, total);
//         this.label = label;
//     }
//
//     /** Call on each increment (e.g., after a batch). */
//     tick(current: number) {
//         const now = Date.now();
//         const sinceLast = now - this.lastLogAt;
//         const done = Math.min(current, this.total);
//         const elapsed = now - this.startedAt;
//         const rate = elapsed > 0 ? done / (elapsed / 1000) : 0; // rows/sec
//         const remain = Math.max(0, this.total - done);
//         const etaSec = rate > 0 ? remain / rate : 0;
//         const pct = this.total > 0 ? Math.round((done / this.total) * 100) : 0;
//
//         // Log at most once per second, and always log on completion
//         if (sinceLast >= 1000 || done >= this.total) {
//             console.log(
//                 color.gray(
//                     `[${this.label}] ${done}/${this.total} (${pct}%) ` +
//                     `elapsed=${fmtMs(elapsed)} ` +
//                     `rate=${rate.toFixed(1)}/s ` +
//                     `eta=${fmtMs(Math.round(etaSec * 1000))}`
//                 )
//             );
//             this.lastLogAt = now;
//         }
//     }
//
//     /** Call when finished to print a final summary line. */
//     done(finalCurrent?: number) {
//         const now = Date.now();
//         const done = finalCurrent ?? this.total;
//         const elapsed = now - this.startedAt;
//         const rate = elapsed > 0 ? done / (elapsed / 1000) : 0;
//         console.log(
//             color.gray(
//                 `[${this.label}] complete: ${done}/${this.total} ` +
//                 `total=${fmtMs(elapsed)} avg=${rate.toFixed(1)}/s`
//             )
//         );
//     }
// }
