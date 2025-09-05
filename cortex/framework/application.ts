// cortex/framework/application.ts
import type { RouteRegistry } from "./route-registry";
import { Container } from "./container";
import type { Logger, RouteModule } from "./types";
import type { RouteConfig } from "./route-registry";

export type { RouteConfig, RouteModule }; // Export types for use in tenant.provider.ts

export class App {
    private di: Container;
    private registry: RouteRegistry;

    constructor(di: Container, registry: RouteRegistry) {
        // Register default logger if not already registered
        if (!di.services.has("logger")) {
            di.register("logger", {
                type: "singleton",
                factory: () => ({
                    debug: (...args: unknown[]) => console.debug("[app]", ...args),
                    info: (...args: unknown[]) => console.info("[app]", ...args),
                    warn: (...args: unknown[]) => console.warn("[app]", ...args),
                    error: (...args: unknown[]) => console.error("[app]", ...args),
                    child: (scope: string) => ({
                        debug: (...args: unknown[]) => console.debug(`[app:${scope}]`, ...args),
                        info: (...args: unknown[]) => console.info(`[app:${scope}]`, ...args),
                        warn: (...args: unknown[]) => console.warn(`[app:${scope}]`, ...args),
                        error: (...args: unknown[]) => console.error(`[app:${scope}]`, ...args),
                    }),
                }),
            });
        }
        this.di = di;
        this.registry = registry;
    }

    getLogger(): Logger {
        return this.di.resolve<Logger>("logger");
    }

    getRegistry(): RouteRegistry {
        return this.registry;
    }

    registerService(name: string, factory: (app: App) => any, scope: "singleton" | "scoped" | "transient" = "scoped") {
        this.di.register(name, { type: scope, factory: () => factory(this) });
    }

    registerRoutes(factory: (app: App) => any) {
        this.registry.addProvider((di: Container) => factory(this));
    }

    async registerRouteModule(module: RouteModule | ((app: App) => RouteConfig)) {
        if (typeof module === "function") {
            this.registerRoutes((app: App) => module(app));
        } else if (module && ("routes" in module || "register" in module)) {
            if (module.register) {
                await module.register(this.getRegistry());
            } else if (module.routes) {
                this.registerRoutes(() => ({ path: "/", routes: module.routes }));
            }
        } else {
            throw new Error("Invalid route module: must be a function or RouteModule");
        }
    }
}