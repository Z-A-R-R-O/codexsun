# Usage Guide for Framework Components

## 1. App (application.ts)
The `App` class is the core of the framework, managing dependency injection (DI) and route registration.

- **Setup**:
  - Create a `Container` and `RouteRegistry` instance.
  - Pass them to the `App` constructor.
  - A default logger is automatically registered if none exists.

- **Key Methods**:
  - `getLogger()`: Returns a `Logger` for logging (info, warn, error, debug).
  - `registerService(name, factory, scope)`: Registers a service in the DI container (scope: `singleton`, `scoped`, `transient`).
  - `registerRoutes(factory)`: Registers routes via a function returning a `RouteConfig`.
  - `registerRouteModule(module)`: Registers a `RouteModule` or function returning `RouteConfig`.
  - `getRegistry()`: Returns the `RouteRegistry` instance.

- **Example**:
  ```typescript
  import { App, Container, RouteRegistry } from "./cortex/framework";

  const container = new Container();
  const registry = new RouteRegistry(container);
  const app = new App(container, registry);

  app.registerService("myService", () => ({ do: () => "action" }), "singleton");
  app.registerRoutes((app) => ({
    path: "/api",
    routes: [{ method: "GET", path: "/hello", handler: () => new Response("Hello") }],
  }));
  app.getLogger().info("App setup complete");
  ```

## 2. RouteRegistry (route-registry.ts)
The `RouteRegistry` manages route registration and matching for HTTP requests.

- **Setup**:
  - Initialize with a `Container` to resolve dependencies (e.g., logger).
  - Use via `App`’s `registerRoutes` or `registerRouteModule`.

- **Key Methods**:
  - `add(route)`: Adds a single route (`RouteDefinition`).
  - `get/post/put/delete(uri, handler, options)`: Registers routes for specific HTTP methods.
  - `redirect(from, to, status)`: Sets up a redirect route.
  - `fallback(handler)`: Defines a fallback route for unmatched requests.
  - `all()`: Lists all registered routes.
  - `matchRequest(method, path, hostname, userId, ip)`: Matches a request to a route, returning a `MatchResult` or null.
  - `generateUrl(name, params)`: Generates a URL for a named route.

- **Example**:
  ```typescript
  import { RouteRegistry, Container } from "./cortex/framework";

  const container = new Container();
  const registry = new RouteRegistry(container);

  registry.get("/users", async (ctx) => new Response("Users"));
  registry.redirect("/old", "/new", 301);
  registry.fallback(async (ctx) => new Response("Not Found", { status: 404 }));
  ```

## 3. Container (container.ts)
The `Container` handles dependency injection for services.

- **Setup**:
  - Create a `Container` instance.
  - Register services using `register` or `registerFactory`.

- **Key Methods**:
  - `register(name, config)`: Registers a service with a factory and scope (`singleton`, `scoped`, `transient`).
  - `registerFactory<T>(token, factory)`: Registers a factory function for a service.
  - `resolve<T>(name)`: Retrieves a service instance by name.
  - `make<T>(cls)`: Instantiates a class (basic constructor call).

- **Example**:
  ```typescript
  import { Container } from "./cortex/framework";

  const container = new Container();
  container.register("logger", {
    type: "singleton",
    factory: () => ({ info: console.log, warn: console.warn, error: console.error }),
  });
  const logger = container.resolve("logger");
  logger.info("Service resolved");
  ```

## 4. Types (types.ts)
The `types.ts` file defines shared TypeScript interfaces for the framework.

- **Key Types**:
  - `Logger`: Interface for logging (`debug`, `info`, `warn`, `error`, `child`).
  - `HttpMethod`: Enum-like type for HTTP methods (`GET`, `POST`, etc.).
  - `RouteDefinition`: Defines a route (`method`, `path`, `handler`, `name`).
  - `RouteModule`: Interface for route modules (`routes` or `register` method).
  - `RequestContext`: Context for route handlers (includes `di`, `params`, etc.).

- **Usage**:
  - Import types in `application.ts`, `route-registry.ts`, or app code for type safety.
  - Example:
    ```typescript
    import type { RouteModule, Logger } from "./cortex/framework/types";

    const module: RouteModule = {
      routes: [{ method: "GET", path: "/test", handler: async () => new Response("Test") }],
    };
    ```

## Integration Example
```typescript
import { App, Container, RouteRegistry } from "./cortex/framework";
import type { RouteConfig } from "./cortex/framework";

// Setup
const container = new Container();
const registry = new RouteRegistry(container);
const app = new App(container, registry);

// Register a service
app.registerService("db", () => ({ query: () => "data" }), "singleton");

// Register routes
const routeConfig: RouteConfig = {
  path: "/api",
  routes: [
    {
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        const db = ctx.di.resolve("db");
        return new Response(`User ${ctx.params.id}: ${db.query()}`);
      },
    },
  ],
};
app.registerRouteModule(() => routeConfig);

// Log
app.getLogger().info("App ready");
```

## Notes
- **Type Safety**: Use `RouteConfig` and `RouteModule` via `App` to avoid direct imports from `route-registry.ts` or `types.ts`.
- **Error Handling**: Wrap async calls (e.g., `registerRouteModule`) in try-catch for robust apps.
- **Assumptions**: `Response` is DOM `Response`. Define in `types.ts` if needed.