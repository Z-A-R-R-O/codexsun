// cortex/http/route.ts

import type { RouteDef } from "./chttpx";

export class Router {
    private routes: RouteDef[] = [];

    get(path: string | RegExp, handler: any) {
        return this.add("GET", path, handler);
    }

    post(path: string | RegExp, handler: any) {
        return this.add("POST", path, handler);
    }

    // add PUT, DELETE if needed...

    private add(method: string, path: string | RegExp, handler: any) {
        const r: RouteDef = { method, path, handler };
        this.routes.push(r);
        return {
            named: (name: string) => {
                (r as any).name = name;
                return this;
            },
        };
    }

    all(): RouteDef[] {
        return this.routes;
    }
}
