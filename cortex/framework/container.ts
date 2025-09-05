export interface Container {
    register(name: string, config: FactoryConfig): void;
    registerFactory<T>(token: string, factory: (c: Container) => T): void;
    resolve<T>(name: string): T;
    make<T>(cls: new (...args: any[]) => T): T;
    services: Map<string, FactoryConfig>;
    singletons: Map<string, any>;
}

interface FactoryConfig {
    type: "singleton" | "scoped" | "transient";
    factory?: (c: Container) => any;
    value?: any;
}

export class Container {
    public services: Map<string, FactoryConfig> = new Map();
    public singletons: Map<string, any> = new Map();

    register(name: string, config: FactoryConfig) {
        this.services.set(name, config);
    }

    registerFactory<T>(token: string, factory: (c: Container) => T) {
        this.services.set(token, { type: "transient", factory });
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
                this.singletons.set(name, config.factory(this));
            }
            return this.singletons.get(name) as T;
        }

        return config.factory(this) as T;
    }

    make<T>(cls: new (...args: any[]) => T): T {
        return new cls();
    }
}