// cortex/http/route.ts
import type { RouteDef } from "./chttpx";

// If you have a Request/Response type, replace `any` below accordingly.
type Handler = (req: any, res?: any) => unknown | Promise<unknown>;

export class Router {
    private routes: RouteDef[] = [];

    get(path: string | RegExp, handler: Handler)    { return this.add("GET", path, handler); }
    post(path: string | RegExp, handler: Handler)   { return this.add("POST", path, handler); }
    put(path: string | RegExp, handler: Handler)    { return this.add("PUT", path, handler); }
    delete(path: string | RegExp, handler: Handler) { return this.add("DELETE", path, handler); }

    // Optional but handy:
    patch(path: string | RegExp, handler: Handler)  { return this.add("PATCH", path, handler); }
    head(path: string | RegExp, handler: Handler)   { return this.add("HEAD", path, handler); }
    options(path: string | RegExp, handler: Handler){ return this.add("OPTIONS", path, handler); }

    // Generic method if you ever need a custom verb
    method(method: string, path: string | RegExp, handler: Handler) {
        return this.add(method.toUpperCase(), path, handler);
    }

    private add(method: string, path: string | RegExp, handler: Handler) {
        const r: RouteDef = { method, path, handler };
        this.routes.push(r);
        return {
            named: (name: string) => {
                (r as any).name = name;
                return this; // keep chaining on the same Router
            },
        };
    }

    all(): RouteDef[] {
        return this.routes;
    }
}
