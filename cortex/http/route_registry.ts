// route_registry.ts
import type { RouteDef } from './chttpx';

export type RouteProvider = () => Promise<RouteDef[]> | RouteDef[];

export class RouteRegistry {
  private routes: RouteDef[] = [];
  private providers: RouteProvider[] = [];

  addRoutes(defs: RouteDef[]) { this.routes.push(...defs); }
  addProvider(p: RouteProvider) { this.providers.push(p); }

  async collect(): Promise<RouteDef[]> {
    let out = [...this.routes];
    for (const p of this.providers) {
      const defs = await p();
      out = out.concat(defs);
    }
    return out;
  }
}

export type AppInstance = RouteRegistry;
