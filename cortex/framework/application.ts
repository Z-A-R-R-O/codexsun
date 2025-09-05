// cortex/framework/application.ts
import type { RouteRegistry } from "./route-registry";
import { DIContainer } from "./di";

export class App {
    private di: DIContainer;
    private registry: RouteRegistry;

    constructor(di: DIContainer, registry: RouteRegistry) {
        this.di = di;
        this.registry = registry;
    }

    getLogger() {
        return this.di.resolve("logger");
    }

    registerService(name: string, factory: (app: App) => any, scope: "singleton" | "scoped" | "transient" = "scoped") {
        this.di.register(name, { type: scope, factory: () => factory(this) });
    }

    registerRoutes(factory: (app: App) => any) {
        this.registry.addProvider((di: DIContainer) => factory(this));
    }
}