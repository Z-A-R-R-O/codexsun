// cortex/framework/application.ts
import type { RouteRegistry } from "./route-registry";
import { Container } from "./container";

export class App {
    private di: Container;
    private registry: RouteRegistry;

    constructor(di: Container, registry: RouteRegistry) {
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
        this.registry.addProvider((di: Container) => factory(this));
    }
}