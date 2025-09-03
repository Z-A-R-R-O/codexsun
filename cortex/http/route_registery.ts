// cortex/framework/route_register.ts
// Collects routes from one or more providers into a single array.

import type { RouteDef } from "./chttpx";

export type RouteProvider = () => Promise<RouteDef[]> | RouteDef[];

/**
 * RouteRegister
 * - Register any number of route providers (functions returning RouteDef[])
 * - Collect them into a single RouteDef[] (awaits async providers)
 */
export class RouteRegistery {
    private providers: RouteProvider[] = [];

    addProvider(p: RouteProvider): this {
        this.providers.push(p);
        return this;
    }

    addProviders(ps: RouteProvider[]): this {
        this.providers.push(...ps);
        return this;
    }

    clear(): void {
        this.providers = [];
    }

    async collect(): Promise<RouteDef[]> {
        const out: RouteDef[] = [];
        for (const p of this.providers) {
            const chunk = await p();
            if (Array.isArray(chunk)) out.push(...chunk);
        }
        // (Optional) de-dup by method+string-path
        const seen = new Set<string>();
        const deduped: RouteDef[] = [];
        for (const r of out) {
            const key =
                `${Array.isArray(r.method) ? r.method.join(",") : r.method}|` +
                (typeof r.path === "string" ? r.path : r.path.toString());
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(r);
            }
        }
        return deduped;
    }
}
