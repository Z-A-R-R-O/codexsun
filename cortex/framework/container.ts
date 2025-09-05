// cortex/framework/container.ts

export interface FactoryConfig {
    type: "singleton" | "scoped" | "transient";
    /**
     * Factory function that may receive the container.
     * Using (c: Container) => any keeps us flexible for resolving deps.
     * If `value` is provided, factory is ignored.
     */
    factory?: (c: Container) => any;
    /**
     * Pre-built value; if set, this takes precedence over factory/type.
     */
    value?: any;
}

/**
 * Minimal DI container with scoped/singleton/transient lifetimes.
 * - singleton: instantiate once per token
 * - scoped:    instantiate on every resolve call (like transient for this simple container)
 * - transient: instantiate on every resolve call
 */
export class Container {
    public services: Map<string, FactoryConfig> = new Map();
    public singletons: Map<string, any> = new Map();

    /**
     * Register a token with a FactoryConfig.
     * Example:
     *   c.register("logger", { type: "singleton", factory: () => new Logger() })
     */
    register(name: string, config: FactoryConfig): void {
        this.services.set(name, config);
    }

    /**
     * Convenience helper for transient factory registration.
     */
    registerFactory<T>(token: string, factory: (c: Container) => T): void {
        this.services.set(token, { type: "transient", factory });
    }

    /**
     * Resolve a token into a value/instance according to its config.
     */
    resolve<T>(name: string): T {
        const config = this.services.get(name);
        if (!config) {
            throw new Error(`Service not found: ${name}`);
        }

        // If a fixed value is provided, return it directly.
        if (config.value !== undefined) {
            return config.value as T;
        }

        if (!config.factory) {
            throw new Error(`No factory or value defined for service: ${name}`);
        }

        // Singleton: cache once
        if (config.type === "singleton") {
            if (!this.singletons.has(name)) {
                this.singletons.set(name, config.factory(this));
            }
            return this.singletons.get(name) as T;
        }

        // For "scoped" and "transient" in this simple container, create per resolve
        return config.factory(this) as T;
    }

    /**
     * Create an instance of a class (no DI into constructor here;
     * extend if you need parameter injection).
     */
    make<T>(cls: new (...args: any[]) => T): T {
        return new cls();
    }
}

// Re-export a type alias for ergonomic imports elsewhere if desired
export type { Container as IContainer };
