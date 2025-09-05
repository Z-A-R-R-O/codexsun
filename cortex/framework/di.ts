// cortex/framework/di.ts

export interface DIContainer {
    register(name: string, config: FactoryConfig): void;
    resolve<T>(name: string): T;
    services: Map<string, FactoryConfig>;
    singletons: Map<string, any>;
}

interface FactoryConfig {
    type: "singleton" | "scoped" | "transient";
    factory?: () => any;
    value?: any;
}

export class DIContainer {
    public services: Map<string, FactoryConfig> = new Map();
    public singletons: Map<string, any> = new Map();

    register(name: string, config: FactoryConfig) {
        this.services.set(name, config);
    }

    resolve<T>(name: string): T {
        const config = this.services.get(name);
        if (!config) {
            throw new Error(`Service not found: ${name}`);
        }

        if (config.value !== undefined) {
            return config.value as T;
        }

        if (!config.factory) {
            throw new Error(`No factory or value defined for service: ${name}`);
        }

        if (config.type === "singleton") {
            if (!this.singletons.has(name)) {
                this.singletons.set(name, config.factory());
            }
            return this.singletons.get(name) as T;
        }

        // For scoped or transient, create a new instance
        return config.factory() as T;
    }
}