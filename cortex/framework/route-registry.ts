// cortex/framework/route-registry.ts

import type { Container } from "./container";
import type { HttpMethod, RouteDefinition, RequestContext } from "./types";

interface Logger {
    info: (message: string, meta?: any) => void;
    warn: (message: string, meta?: any) => void;
    error: (message: string, meta?: any) => void;
}

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

export interface RouteConfig {
    path: string;
    routes: Route[];
    middleware?: Array<(ctx: RequestContext, next: () => void) => Promise<void>>;
    subConfigs?: RouteConfig[];
    prefix?: string;
    subdomain?: string;
    cors?: { origin: string; methods?: string[]; headers?: string[] };
}

interface CachedRouteConfig {
    config: RouteConfig;
    normalizedPath: string;
    normalizedRoutes: Array<Route & { fullPath: string; fullRegex: RegExp }>;
}

interface MatchResult {
    route: Route;
    config: RouteConfig;
    params: Record<string, string>;
    model?: any;
}

export class RouteRegistry {
    private providers: Array<(di: Container) => RouteConfig> = [];
    private registeredRoutes: Set<string> = new Set();
    private cachedConfigs: CachedRouteConfig[] = [];
    private logger: Logger;
    private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();
    private fallbackRoute: Route | null = null;

    constructor(di: Container) {
        this.logger = di.resolve<Logger>("logger");
    }

    add(route: RouteDefinition) {
        this.addRoute({
            ...route,
            params: this.parseParams(route.path),
        });
    }

    all(): RouteDefinition[] {
        const routes: RouteDefinition[] = [];
        for (const cached of this.cachedConfigs) {
            for (const route of cached.normalizedRoutes) {
                routes.push({
                    method: route.method,
                    path: route.path,
                    handler: route.handler!,
                    name: route.name,
                });
            }
            if (cached.config.subConfigs) {
                for (const subConfig of cached.config.subConfigs) {
                    const normalizedSubConfig = this.normalizeConfig(subConfig);
                    for (const route of normalizedSubConfig.normalizedRoutes) {
                        routes.push({
                            method: route.method,
                            path: route.path,
                            handler: route.handler!,
                            name: route.name,
                        });
                    }
                }
            }
        }
        return routes;
    }

    discover(dir: string): Promise<void> {
        this.logger.info(`Discovering routes in ${dir}`, { context: "route-registry" });
        return Promise.resolve();
    }

    get(uri: string, handler: Route["handler"], options: Partial<Route> = {}) {
        this.addRoute({ method: "GET", path: uri, handler, ...options });
    }

    post(uri: string, handler: Route["handler"], options: Partial<Route> = {}) {
        this.addRoute({ method: "POST", path: uri, handler, ...options });
    }

    put(uri: string, handler: Route["handler"], options: Partial<Route> = {}) {
        this.addRoute({ method: "PUT", path: uri, handler, ...options });
    }

    delete(uri: string, handler: Route["handler"], options: Partial<Route> = {}) {
        this.addRoute({ method: "DELETE", path: uri, handler, ...options });
    }

    redirect(from: string, to: string, status: number = 302) {
        this.addRoute({ method: "GET", path: from, redirect: { path: to, status } });
    }

    fallback(handler: Route["handler"], options: Partial<Route> = {}) {
        this.fallbackRoute = { method: "GET", path: "*", handler, params: [], ...options };
        this.logger.info("Fallback route registered", { context: "route-registry" });
    }

    private addRoute(route: Route) {
        this.addProvider(() => ({
            path: "/",
            routes: [route],
        }));
    }

    addProvider(factory: (di: Container) => RouteConfig) {
        this.validateProvider(factory);
        this.providers.push(factory);
        // Note: Caching is now handled in collect() instead of here
    }

    private validateProvider(factory: (di: Container) => RouteConfig) {
        try {
            const mockDI: Container = {
                register: () => {},
                registerFactory: () => {},
                resolve: <T>(): T => ({
                    info: () => {},
                    warn: () => {},
                    error: () => {}
                } as T),
                make: () => ({} as any),
                services: new Map(),
                singletons: new Map()
            };
            const config = factory(mockDI);

            if (!config.path) {
                throw new Error("RouteConfig must have a valid 'path' string");
            }
            if (!Array.isArray(config.routes)) {
                throw new Error("RouteConfig must have a 'routes' array");
            }
            if (config.middleware && !Array.isArray(config.middleware)) {
                throw new Error("RouteConfig middleware must be an array");
            }
            if (config.subConfigs && !Array.isArray(config.subConfigs)) {
                throw new Error("RouteConfig subConfigs must be an array");
            }
            if (config.cors && (!config.cors.origin)) {
                throw new Error("RouteConfig CORS must have a valid 'origin'");
            }
            // ... (assuming the rest of the validation is truncated but remains the same)
        } catch (err) {
            this.logger.error("Invalid provider", { error: err });
            throw err;
        }
    }

    // New method to collect and cache all RouteConfigs
    collect(options: { di: Container }): RouteConfig[] {
        const di = options.di;
        this.cachedConfigs = [];
        for (const factory of this.providers) {
            try {
                const config = factory(di);
                this.cachedConfigs.push(this.normalizeConfig(config));
            } catch (err) {
                this.logger.error(`Failed to load RouteConfig from provider`, { error: err });
            }
        }
        return this.cachedConfigs.map(cc => cc.config);
    }

    // ... (the rest of the class remains the same, including truncated parts like findByName, normalizePath, etc.)

    private normalizePath(path: string): string {
        return "/" + path.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
    }

    private parseParams(path: string): string[] {
        const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*(?:\?)?)/g;
        const params: string[] = [];
        let match;
        while ((match = paramRegex.exec(path)) !== null) {
            const paramName = match[1].endsWith("?") ? match[1].slice(0, -1) : match[1];
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) {
                throw new Error(`Invalid parameter name: ${paramName}`);
            }
            params.push(match[1]);
        }
        return params;
    }

    private matchPath(path: string, routePath: string, params: string[], regex?: RegExp): Record<string, string> | null {
        if (regex) {
            const match = path.match(regex);
            if (!match) return null;
            return params.reduce((acc, param, i) => {
                acc[param.endsWith("?") ? param.slice(0, -1) : param] = match[i + 1] || "";
                return acc;
            }, {} as Record<string, string>);
        }

        const pathSegments = path.split("/").filter(Boolean);
        const routeSegments = routePath.split("/").filter(Boolean);
        if (pathSegments.length !== routeSegments.length && !params.some(p => routeSegments.includes(`:${p}`))) {
            return null;
        }

        const result: Record<string, string> = {};
        for (let i = 0; i < Math.max(pathSegments.length, routeSegments.length); i++) {
            const pathSeg = pathSegments[i] || "";
            const routeSeg = routeSegments[i] || "";
            if (routeSeg.startsWith(":")) {
                const paramName = routeSeg.endsWith("?") ? routeSeg.slice(1, -1) : routeSeg.slice(1);
                if (pathSeg || !routeSeg.endsWith("?")) {
                    result[paramName] = pathSeg;
                }
            } else if (pathSeg !== routeSeg) {
                return null;
            }
        }
        return result;
    }

    private matchSubdomain(hostname: string, subdomain: string): boolean {
        const regex = new RegExp(`^${subdomain.replace(".", "\\.")}\\..+`);
        return regex.test(hostname);
    }

    private async checkRateLimit(route: Route, path: string, userId?: string, ip?: string): Promise<boolean> {
        if (!route.rateLimit) return true;
        const key = `${route.method}:${path}:${userId || ip || "global"}`;
        const now = Date.now();
        const { windowMs, max } = route.rateLimit;

        const record = this.rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };
        if (now > record.resetTime) {
            record.count = 0;
            record.resetTime = now + windowMs;
        }

        record.count += 1;
        this.rateLimitStore.set(key, record);

        if (record.count > max) {
            this.logger.warn(`Rate limit exceeded for ${key}`, { context: "route-registry" });
            return false;
        }
        return true;
    }

    private normalizeConfig(config: RouteConfig): CachedRouteConfig {
        const normalizedBasePath = this.normalizePath(config.prefix ? config.prefix + config.path : config.path);
        const normalizedRoutes = config.routes.map(route => {
            const routePath = this.normalizePath(route.path || "");
            const fullPath = this.normalizePath(normalizedBasePath + routePath);
            return {
                ...route,
                path: routePath,
                params: this.parseParams(route.path || ""),
                fullPath,
                fullRegex: route.regex || this.pathToRegex(fullPath, route.params || []),
            };
        });
        const normalizedSubConfigs = config.subConfigs?.map(subConfig =>
            this.normalizeConfig({ ...subConfig, prefix: normalizedBasePath }).config
        );
        return {
            config: {
                ...config,
                path: normalizedBasePath,
                routes: normalizedRoutes.map(r => ({
                    method: r.method,
                    path: r.path,
                    handler: r.handler,
                    middleware: r.middleware,
                    params: r.params,
                    regex: r.regex,
                    name: r.name,
                    redirect: r.redirect,
                    rateLimit: r.rateLimit,
                    model: r.model,
                })),
                subConfigs: normalizedSubConfigs,
            },
            normalizedPath: normalizedBasePath,
            normalizedRoutes,
        };
    }

    private pathToRegex(path: string, params: string[]): RegExp {
        let pattern = "^" + path.replace(/\/+/g, "\\/").replace(/:([a-zA-Z_][a-zA-Z0-9_]*\??)/g, (match, p1) => {
            return p1.endsWith("?") ? `(?:/([^/]+))?` : `/([^/]+)`;
        }) + "$";
        return new RegExp(pattern);
    }
}