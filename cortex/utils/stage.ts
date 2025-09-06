// // cortex/utils/stage.ts
// import { color, fmtMs, log } from './locger';
//
// export class Stage {
//     private startAt = Date.now();
//     constructor(private title: string) {
//         log.header(this.title);
//     }
//     end(okText = 'done') {
//         const ms = Date.now() - this.startAt;
//         console.log(`${color.green('✔')} ${okText} ${color.gray(`(${fmtMs(ms)})`)}`);
//     }
//     fail(err: unknown, prefix = 'failed') {
//         const ms = Date.now() - this.startAt;
//         console.error(`${color.red('✖')} ${prefix} ${color.gray(`(${fmtMs(ms)})`)}`);
//         if (err) console.error(color.red('[error]'), (err as any)?.message || err);
//     }
// }
