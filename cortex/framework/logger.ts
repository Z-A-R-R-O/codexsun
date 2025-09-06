import { Logger } from './types';

export class ConsoleLogger implements Logger {
  constructor(private prefix = 'app') {}
  debug(...a: unknown[]) { console.debug(`[${this.prefix}]`, ...a); }
  info(...a: unknown[])  { console.info(`[${this.prefix}]`, ...a); }
  warn(...a: unknown[])  { console.warn(`[${this.prefix}]`, ...a); }
  error(...a: unknown[]) { console.error(`[${this.prefix}]`, ...a); }

  child(scope: string): ConsoleLogger {
    return new ConsoleLogger(`${this.prefix}:${scope}`);
  }
}
