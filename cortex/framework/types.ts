export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: (ctx: RequestContext) => Promise<Response> | Response;
  /** Optional name, useful for tests and logs */
  name?: string;
}

export interface RouteModule {
  /** Either export an array of routes or a register() function */
  routes?: RouteDefinition[];
  register?: (reg: RouteRegistry) => void | Promise<void>;
  /** Optional for diagnostics */
  __meta__?: { source?: string };
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RequestContext {
  req: Request;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Dependency container */
  di: Container;
  /** Per-request logger (child of app logger) */
  log: Logger;
  /** arbitrary bag for test instrumentation */
  bag?: Record<string, unknown>;
}

export interface ContainerOptions {
  autoBindSingleton?: boolean;
}

export type Token<T> = symbol & { __t?: T };

export interface Container {
  register<T>(token: Token<T>, value: T): void;
  registerFactory<T>(token: Token<T>, factory: (c: Container) => T): void;
  resolve<T>(token: Token<T>): T;
  make<T>(cls: new (...args: any[]) => T): T;
}

export interface RouteRegistry {
  add(route: RouteDefinition): void;
  all(): RouteDefinition[];
  /** Auto-discover routes by importing modules from a dir */
  discover(dir: string): Promise<void>;
}
