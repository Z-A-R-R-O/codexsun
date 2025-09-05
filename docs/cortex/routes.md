Thank you for requesting further enhancements to `cortex/framework/route-registry.ts`, which exports `RouteRegistry`. You’ve asked to add the following features:
- **Route Matching**: Add a method to match requests against registered routes.
- **Parameter Validation**: Validate parameter names or types in `parseParams`.
- **Middleware Execution**: Add a method to simulate middleware execution for testing.
- **Laravel-like Features**: Implement a routing system inspired by Laravel, supporting:
    - Routes with URI and closure (simple and expressive).
    - Redirect routes, parameters, optional parameters, regular expressions, named routes, grouping, middleware, authentication, subdomain routing, route prefixes, fallback routes, rate limiting, CORS resource sharing, and route caching.

I’ll update `cortex/framework/route-registry.ts` to incorporate all previously implemented features (route validation, middleware support, duplicate route detection, path normalization, route precedence, logger integration, route parameter parsing, nested route grouping, and performance caching) plus the newly requested features. The implementation will remain compatible with `cortex/framework/application.ts` and `apps/cxsun/tenant/src/tenant/code/tenant.provider.ts`, using `DIContainer` from `cortex/framework/di.ts` for logger resolution. I’ll ensure a Laravel-inspired, expressive routing system while keeping the code minimal yet robust.

---

### Approach
To achieve Laravel-like routing, I’ll:
- Extend the `Route` and `RouteConfig` interfaces to support named routes, redirect routes, optional parameters, regular expressions, subdomains, prefixes, and fallback routes.
- Add methods for route matching, middleware execution, and rate limiting.
- Validate parameter names in `parseParams`.
- Support CORS via middleware and headers.
- Enhance route caching for performance.
- Provide a simple, closure-based API for registering routes, inspired by Laravel’s expressive syntax.

### Updated Project Context
- **File**: `cortex/framework/route-registry.ts` (only this file will be coded).
- **Dependencies**: Uses `DIContainer` from `cortex/framework/di.ts` for logger resolution.
- **Compatibility**: Works with `App.registerRoutes` in `cortex/framework/application.ts` and routes defined in `apps/cxsun/tenant/src/tenant/code/tenant.routes.ts`.
- **Structure**: Assumes `apps/cxsun/app.ts` registers `tenant` module routes via `TenantProvider`.

---

### `cortex/framework/route-registry.ts`
This updated file exports `RouteRegistry` with all requested features, including Laravel-inspired routing capabilities.

<xaiArtifact artifact_id="1976efd6-ab61-4d4f-8e7e-7606cd6c8d53" artifact_version_id="089e5431-2329-4894-829a-f332bc81ffde" title="route-registry.ts" contentType="text/typescript">

```typescript
// cortex/framework/route-registry.ts

import type { DIContainer } from "./di";

interface Route {
    method: string;
    path: string;
    handler: (req: any, res: any) => Promise<{ status: number; body: any }>;
    middleware?: Array<(req: any, res: any, next: () => void) => Promise<void>>;
    params?: string[];
    regex?: RegExp;
    name?: string; // Named route
    redirect?: { path: string; status: number }; // Redirect route
    rateLimit?: { windowMs: number; max: number }; // Rate limiting
}

interface RouteConfig {
    path: string;
    routes: Route[];
    middleware?: Array<(req: any, res: any, next: () => void) => Promise<void>>;
    subConfigs?: RouteConfig[];
    prefix?: string; // Route prefix
    subdomain?: string; // Subdomain routing
    cors?: { origin: string; methods?: string[]; headers?: string[] }; // CORS
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
}

export class RouteRegistry {
    private providers: Array<(di: DIContainer) => RouteConfig> = [];
    private registeredRoutes: Set<string> = new Set();
    private cachedConfigs: CachedRouteConfig[] = [];
    private logger: any;
    private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();
    private fallbackRoute: Route | null = null;

    constructor(di: DIContainer) {
        this.logger = di.resolve("logger");
    }

    // Laravel-inspired expressive route registration
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
        this.fallbackRoute = { method: "ANY", path: "*", handler, ...options, params: [] };
        this.logger.info("Fallback route registered", { context: "route-registry" });
    }

    private addRoute(route: Route) {
        this.addProvider(() => ({
            path: "/",
            routes: [route],
        }));
    }

    addProvider(factory: (di: DIContainer) => RouteConfig) {
        this.validateProvider(factory);
        this.providers.push(factory);
        this.cacheProvider(factory);
    }

    private validateProvider(factory: (di: DIContainer) => RouteConfig) {
        try {
            const mockDI: DIContainer = {
                register: () => {},
                resolve: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
            };
            const config = factory(mockDI);

            if (!config.path || typeof config.path !== "string") {
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
            if (config.cors && (!config.cors.origin || typeof config.cors.origin !== "string")) {
                throw new Error("RouteConfig CORS must have a valid 'origin'");
            }

            const normalizedBasePath = this.normalizePath(config.path);
            if (!normalizedBasePath.startsWith("/")) {
                throw new Error(`Base path must start with '/': ${config.path}`);
            }

            const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "ANY"];
            for (const route of config.routes) {
                if (!validMethods.includes(route.method.toUpperCase())) {
                    throw new Error(`Invalid HTTP method: ${route.method}`);
                }
                if (!route.path && !route.redirect) {
                    throw new Error(`Route must have a valid 'path' or 'redirect': ${JSON.stringify(route)}`);
                }
                if (route.redirect && (!route.redirect.path || typeof route.redirect.path !== "string")) {
                    throw new Error(`Redirect must have a valid 'path': ${JSON.stringify(route)}`);
                }
                if (!route.handler && !route.redirect) {
                    throw new Error(`Route must have a valid 'handler' function: ${JSON.stringify(route)}`);
                }
                if (route.middleware && !Array.isArray(route.middleware)) {
                    throw new Error(`Route middleware must be an array: ${JSON.stringify(route)}`);
                }
                if (route.rateLimit && (!Number.isInteger(route.rateLimit.max) || !Number.isInteger(route.rateLimit.windowMs))) {
                    throw new Error(`Rate limit must have valid 'max' and 'windowMs': ${JSON.stringify(route)}`);
                }

                if (route.path) {
                    route.params = this.parseParams(route.path);
                    if (route.regex) {
                        try {
                            new RegExp(route.regex);
                        } catch {
                            throw new Error(`Invalid regex for route: ${route.path}`);
                        }
                    }

                    const fullPath = `${route.method.toUpperCase()} ${this.normalizePath(normalizedBasePath + route.path)}`;
                    if (this.registeredRoutes.has(fullPath)) {
                        this.logger.warn(`Duplicate route detected: ${fullPath}`, {
                            context: "route-registry",
                        });
                    } else {
                        this.registeredRoutes.add(fullPath);
                    }
                }

                if (route.name && typeof route.name !== "string") {
                    throw new Error(`Route name must be a string: ${JSON.stringify(route)}`);
                }
            }

            if (config.subConfigs) {
                for (const subConfig of config.subConfigs) {
                    this.validateProvider(() => subConfig);
                }
            }
        } catch (err) {
            this.logger.error(`Failed to validate route provider: ${String(err)}`, {
                context: "route-registry",
                error: String(err),
            });
            throw err;
        }
    }

    private cacheProvider(factory: (di: DIContainer) => RouteConfig) {
        try {
            const mockDI: DIContainer = {
                register: () => {},
                resolve: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
            };
            const config = factory(mockDI);
            const normalizedConfig = this.normalizeConfig(config);
            this.cachedConfigs.push(normalizedConfig);
        } catch (err) {
            this.logger.error(`Failed to cache route provider: ${String(err)}`, {
                context: "route-registry",
                error: String(err),
            });
        }
    }

    collect(di: DIContainer): RouteConfig[] {
        const configs: RouteConfig[] = [];
        this.registeredRoutes.clear();

        for (const cached of this.cachedConfigs) {
            try {
                const config = cached.config;
                configs.push(config);

                for (const route of cached.normalizedRoutes) {
                    const fullPath = `${route.method.toUpperCase()} ${route.fullPath}`;
                    if (this.registeredRoutes.has(fullPath)) {
                        this.logger.warn(`Duplicate route detected during collection: ${fullPath}`, {
                            context: "route-registry",
                        });
                    } else {
                        this.registeredRoutes.add(fullPath);
                    }
                }

                if (config.subConfigs) {
                    for (const subConfig of config.subConfigs) {
                        const normalizedSubConfig = this.normalizeConfig(subConfig);
                        configs.push(normalizedSubConfig.config);
                        for (const route of normalizedSubConfig.normalizedRoutes) {
                            const fullPath = `${route.method.toUpperCase()} ${route.fullPath}`;
                            if (this.registeredRoutes.has(fullPath)) {
                                this.logger.warn(`Duplicate route detected during collection: ${fullPath}`, {
                                    context: "route-registry",
                                });
                            } else {
                                this.registeredRoutes.add(fullPath);
                            }
                        }
                    }
                }
            } catch (err) {
                this.logger.error(`Failed to collect routes: ${String(err)}`, {
                    context: "route-registry",
                    error: String(err),
                });
            }
        }

        return configs.sort((a, b) => b.path.length - a.path.length);
    }

    async matchRequest(method: string, path: string, hostname?: string): Promise<MatchResult | null> {
        for (const cached of this.cachedConfigs.sort((a, b) => b.normalizedPath.length - a.normalizedPath.length)) {
            const config = cached.config;

            if (config.subdomain && hostname && !this.matchSubdomain(hostname, config.subdomain)) {
                continue;
            }

            for (const route of cached.normalizedRoutes) {
                if (route.method.toUpperCase() !== "ANY" && route.method.toUpperCase() !== method.toUpperCase()) {
                    continue;
                }

                const params = this.matchPath(path, route.fullPath, route.params || [], route.regex);
                if (params) {
                    if (route.rateLimit && !(await this.checkRateLimit(route, path))) {
                        return {
                            route: { method: "ANY", path, handler: async () => ({ status: 429, body: { error: "Rate limit exceeded" } }) },
                            config,
                            params: {},
                        };
                    }
                    return { route, config, params };
                }
            }

            if (config.subConfigs) {
                for (const subConfig of config.subConfigs) {
                    const normalizedSubConfig = this.normalizeConfig(subConfig);
                    for (const route of normalizedSubConfig.normalizedRoutes) {
                        if (route.method.toUpperCase() !== "ANY" && route.method.toUpperCase() !== method.toUpperCase()) {
                            continue;
                        }
                        const params = this.matchPath(path, route.fullPath, route.params || [], route.regex);
                        if (params) {
                            if (route.rateLimit && !(await this.checkRateLimit(route, path))) {
                                return {
                                    route: { method: "ANY", path, handler: async () => ({ status: 429, body: { error: "Rate limit exceeded" } }) },
                                    config: normalizedSubConfig.config,
                                    params: {},
                                };
                            }
                            return { route, config: normalizedSubConfig.config, params };
                        }
                    }
                }
            }
        }

        if (this.fallbackRoute) {
            return { route: this.fallbackRoute, config: { path: "/", routes: [this.fallbackRoute] }, params: {} };
        }

        return null;
    }

    async executeMiddleware(route: Route, config: RouteConfig, req: any, res: any): Promise<boolean> {
        const middlewares = [...(config.middleware || []), ...(route.middleware || [])];
        for (const middleware of middlewares) {
            try {
                let nextCalled = false;
                await middleware(req, res, () => { nextCalled = true; });
                if (!nextCalled) {
                    this.logger.info("Middleware stopped execution", { context: "route-registry", path: route.path });
                    return false;
                }
            } catch (err) {
                this.logger.error(`Middleware execution failed: ${String(err)}`, {
                    context: "route-registry",
                    path: route.path,
                    error: String(err),
                });
                res.status = 500;
                res.body = { error: "Internal server error" };
                return false;
            }
        }
        return true;
    }

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
            params.push(paramName);
        }
        return params;
    }

    private matchPath(path: string, routePath: string, params: string[], regex?: RegExp): Record<string, string> | null {
        if (regex) {
            const match = path.match(regex);
            if (!match) return null;
            return params.reduce((acc, param, i) => {
                acc[param] = match[i + 1] || "";
                return acc;
            }, {} as Record<string, string>);
        }

        const pathSegments = path.split("/").filter(Boolean);
        const routeSegments = routePath.split("/").filter(Boolean);
        if (pathSegments.length !== routeSegments.length && !params.some(p => routeSegments.includes(`:${p}?`))) {
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

    private async checkRateLimit(route: Route, path: string): Promise<boolean> {
        if (!route.rateLimit) return true;
        const key = `${route.method}:${path}`;
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
            this.normalizeConfig({ ...subConfig, prefix: normalizedBasePath })
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
                })),
                subConfigs: normalizedSubConfigs,
            },
            normalizedPath: normalizedBasePath,
            normalizedRoutes,
        };
    }

    private pathToRegex(path: string, params: string[]): RegExp {
        let pattern = "^" + path.replace(/\/+/g, "\\/").replace(/:([a-zA-Z_][a-zA-Z0-9_]*(?:\?)?)/g, (match, p1) => {
            return p1.endsWith("?") ? `(?:/([^/]+))?` : `/([^/]+)`;
        }) + "$";
        return new RegExp(pattern);
    }
}
```

</xaiArtifact>

---

### Enhancements and Features

1. **Route Validation**:
    - Validates `RouteConfig` (`path`, `routes`, `middleware`, `subConfigs`, `cors`) and `Route` (`method`, `path` or `redirect`, `handler`, `middleware`, `rateLimit`, `name`, `regex`).
    - Ensures valid HTTP methods (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `ANY`) and path formats.
    - Checks CORS `origin` and regex validity.
    - Logs errors via `logger`.

2. **Middleware Support**:
    - Supports async middleware in `Route` and `RouteConfig` with `(req, res, next) => Promise<void>`.
    - Validated in `validateProvider`.

3. **Error Handling and Duplicate Route Detection**:
    - Tracks routes in `registeredRoutes` (Set of `METHOD /path`) for duplicates.
    - Logs warnings for duplicates and errors for validation/collection failures.

4. **Path Normalization**:
    - `normalizePath`: Removes duplicate slashes, ensures single leading slash, removes trailing slash.

5. **Route Precedence**:
    - Sorts `cachedConfigs` and `configs` by path length (longer paths first) in `collect` and `matchRequest`.

6. **Logger Integration**:
    - Resolves `logger` from `DIContainer` for consistent logging (`context: "route-registry"`).

7. **Route Parameters**:
    - `parseParams`: Extracts parameters (e.g., `:id`, `:name?`) using regex `/:[a-zA-Z_][a-zA-Z0-9_]*(?:\?)?/g`.
    - Validates parameter names to ensure they are alphanumeric with underscores.
    - Supports optional parameters (e.g., `:id?`).
    - Stores parameters in `Route.params`.

8. **Route Grouping**:
    - Supports nested `subConfigs` in `RouteConfig`.
    - Applies prefixes recursively via `normalizeConfig`.

9. **Performance (Caching)**:
    - Caches normalized routes in `cachedConfigs` during `addProvider`.
    - Uses cached configs in `collect` and `matchRequest` to reduce processing.

10. **Route Matching** (New):
    - **Added**: `matchRequest(method, path, hostname?)`: Matches a request against registered routes, considering method, path, and subdomain.
    - **How**:
        - Iterates sorted `cachedConfigs` (longer paths first).
        - Checks method, path (using `matchPath` with regex or segment matching), and subdomain.
        - Supports rate limiting and returns 429 if exceeded.
        - Returns `MatchResult` with `route`, `config`, and `params`, or `fallbackRoute` if no match.
    - **Benefit**: Enables server to find and execute the correct route handler.

11. **Parameter Validation** (New):
    - **Added**: Validates parameter names in `parseParams` to ensure they match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
    - **How**: Throws errors for invalid names (e.g., `:123` or `:!id`).
    - **Benefit**: Prevents malformed parameter names.

12. **Middleware Execution** (New):
    - **Added**: `executeMiddleware(route, config, req, res)`: Simulates middleware execution for testing.
    - **How**:
        - Runs config and route middleware in order, awaiting async middleware.
        - Tracks `next` calls; stops if `next` isn’t called.
        - Sets `res.status` and `res.body` on errors.
    - **Benefit**: Allows testing middleware chains without a full server.

13. **Laravel-like Features** (New):
    - **Expressive Routing**:
        - Methods `get`, `post`, `put`, `delete` for closure-based route registration.
        - Example: `registry.get("/users/:id", async (req, res) => ({ status: 200, body: { id: req.params.id } }))`.
    - **Redirect Routes**:
        - `redirect(from, to, status)`: Registers routes with `redirect` property.
        - Example: `registry.redirect("/old", "/new", 301)`.
    - **Parameters and Optional Parameters**:
        - Supports `:id` and `:id?` in paths, parsed by `parseParams`.
    - **Regular Expressions**:
        - Supports `regex` in `Route` for custom path matching.
    - **Named Routes**:
        - Supports `name` in `Route` for referencing routes (e.g., `route("user.profile")` in Laravel).
    - **Grouping**:
        - Supports `subConfigs` for nested routes and `prefix` for base paths.
    - **Middleware**:
        - Supports middleware at route and config levels.
        - Includes `auth` middleware example in usage.
    - **Subdomain Routing**:
        - Supports `subdomain` in `RouteConfig` with regex matching.
    - **Route Prefixes**:
        - Supports `prefix` in `RouteConfig`, applied in `normalizeConfig`.
    - **Fallback Routes**:
        - `fallback(handler)`: Registers a catch-all route for unmatched requests.
    - **Rate Limiting**:
        - Supports `rateLimit` in `Route` with `windowMs` and `max` requests.
        - Uses `rateLimitStore` to track requests.
    - **CORS Resource Sharing**:
        - Supports `cors` in `RouteConfig` with `origin`, `methods`, and `headers`.
        - Middleware can apply CORS headers (example in usage).
    - **Route Caching**:
        - Enhanced by `cachedConfigs` for normalized routes and regexes.

---

### Integration with Framework
- **Used by `cortex/framework/application.ts`**:
    - `RouteRegistry` is instantiated in `main.ts` with `DIContainer` and passed to `App`.
    - `App.registerRoutes` calls `addProvider`.

- **Example Route in `tenant.routes.ts`** (for context, not coded):
  ```typescript
  export default function tenantRoutes(app: App) {
      const logger = app.getLogger();
      return {
          path: "/tenants",
          prefix: "/api",
          subdomain: "tenants",
          cors: { origin: "*", methods: ["GET", "POST"], headers: ["Content-Type"] },
          middleware: [
              async (req, res, next) => {
                  if (!req.user) throw new Error("Unauthorized");
                  next(); // Auth middleware
              },
              async (req, res, next) => {
                  res.headers = { ...res.headers, "Access-Control-Allow-Origin": "*" };
                  next(); // CORS middleware
              },
          ],
          routes: [
              {
                  method: "GET",
                  path: "/:id",
                  name: "tenant.show",
                  regex: /^\/[0-9]+$/,
                  rateLimit: { windowMs: 60000, max: 100 },
                  middleware: [(req, res, next) => { logger.info("Route middleware"); next(); }],
                  handler: async (req) => {
                      logger.info("Handling tenant request", { context: "tenant-routes", tenantId: req.params.id });
                      return { status: 200, body: { id: req.params.id, name: `Tenant ${req.params.id}` } };
                  },
              },
              {
                  method: "GET",
                  path: "/optional/:name?",
                  name: "tenant.optional",
                  handler: async (req) => ({ status: 200, body: { name: req.params.name || "default" } }),
              },
          ],
          subConfigs: [
              {
                  path: "/admin",
                  routes: [
                      {
                          method: "GET",
                          path: "/users",
                          name: "tenant.admin.users",
                          handler: async () => ({ status: 200, body: { users: [] } }),
                      },
                  ],
              },
          ],
      };
  }
  ```

- **Example Usage in `main.ts`** (for context, not coded):
  ```typescript
  const diContainer = new DIContainer();
  const routeRegistry = new RouteRegistry(diContainer);
  diContainer.register("routeRegistry", { type: "singleton", value: routeRegistry });
  const app = new App(diContainer, routeRegistry);
  // Expressive routing
  routeRegistry.get("/health", async () => ({ status: 200, body: { status: "ok" } }));
  routeRegistry.redirect("/old", "/new", 301);
  routeRegistry.fallback(async () => ({ status: 404, body: { error: "Not found" } }));
  await registerApps(diContainer);
  const routes = routeRegistry.collect(diContainer);
  ```

---

### Assumptions
- **File Paths**: `RouteRegistry` is in `cortex/framework/route-registry.ts`, with `DIContainer` from `./di`.
- **Functionality**: Supports `addProvider`, `collect`, `matchRequest`, and expressive methods (`get`, `post`, etc.).
- **Route Format**: Extended to include `name`, `redirect`, `rateLimit`, `regex`, `params`, `subdomain`, `prefix`, `cors`.
- **Logger**: Assumes `logger` is registered with `info`, `warn`, `error` methods.
- **Handler Signature**: `(req, res) => Promise<{ status, body }>`; `res` supports `headers` for CORS.

---

### Optional Enhancements
- **Route Model Binding**: Automatically resolve parameters to models (Laravel-like).
- **Named Route Resolution**: Add a method to generate URLs from route names.
- **Advanced Rate Limiting**: Support per-user or per-IP limits.

If you need these enhancements, want to code other files, or have specific requirements for any feature, let me know! This version updates `cortex/framework/route-registry.ts` with all requested features, providing a Laravel-inspired, robust routing system for the Cortex framework.