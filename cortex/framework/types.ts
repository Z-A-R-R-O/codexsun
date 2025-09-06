// cortex/framework/types.ts

// 1) Bring Container into the local scope for this file:
import type { Container } from "./container";

// 2) (Optional but nice) re-export DI types so other modules can import from here too:
export type { Container, FactoryConfig } from "./container";

/** Logger used across the framework. */
export interface Logger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    child: (scope: string) => Logger;
}

export type HttpMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "OPTIONS"
    | "HEAD";

/** RequestContext available to route handlers (framework-level). */
export interface RequestContext {
    di: Container;
    params: Record<string, string>;
    model?: any;
    user?: any;
    session?: any; // Added to support session data (e.g., sid in welcome.ts)
    tenant?: any;  // Added to support tenant data (e.g., tenantId in welcome.ts)
}

/** Declarative route shape used by the registry. */
export interface RouteDefinition {
    method: HttpMethod;
    path: string;
    handler?: (ctx: RequestContext) => Promise<Response> | Response;
    middleware?: Array<(ctx: RequestContext, next: () => void) => Promise<void>>;
    params?: string[];
    regex?: RegExp;
    name?: string;
    redirect?: { path: string; status: number };
    rateLimit?: { windowMs: number; max: number };
    model?: { param: string; resolver: (id: string) => Promise<any> };
}

/** Route interface used in RouteRegistry (matches route-registry.ts). */
export interface Route {
    method: HttpMethod;
    path: string;
    handler?: (ctx: RequestContext) => Promise<Response> | Response;
    middleware?: Array<(ctx: RequestContext, next: () => void) => Promise<void>>;
    params?: string[];
    regex?: RegExp;
    name?: string;
    redirect?: { path: string; status: number };
    rateLimit?: { windowMs: number; max: number };
    model?: { param: string; resolver: (id: string) => Promise<any> };
}

/** Optional module interface for registering routes programmatically. */
export interface RouteModule {
    routes?: RouteDefinition[];
    register?: (registry: any) => Promise<void>;
}