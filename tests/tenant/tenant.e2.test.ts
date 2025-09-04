// apps/cxsun/tests/tenant.e2e.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { tenantRoutes } from "../../apps/cxsun/src/tenant/code/tenant.routes";

class MockRes {
    statusCode = 200;
    private headers: Record<string, string> = {};
    private body = "";

    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = String(value); }
    getHeader(name: string) { return this.headers[name.toLowerCase()]; }

    write(chunk?: any) {
        if (chunk == null) return true;
        if (Buffer.isBuffer(chunk)) this.body += chunk.toString("utf8");
        else this.body += typeof chunk === "string" ? chunk : JSON.stringify(chunk);
        return true;
    }
    end(chunk?: any) { if (chunk !== undefined) this.write(chunk); }

    private parseBody(): any {
        const ct = (this.getHeader("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
            try { return this.body ? JSON.parse(this.body) : null; } catch { /* fall through */ }
        }
        return this.body || null;
    }

    result() {
        const data = this.parseBody();
        // pass through if already { ok, data }
        if (data && typeof data === "object" && "ok" in data && "data" in data) return data;
        // wrap common shapes
        if (Array.isArray(data)) return { ok: true, data };
        if (data && typeof data === "object" && ("items" in data || "total" in data)) return { ok: true, data };
        // default to success with empty array if 2xx
        return { ok: this.statusCode >= 200 && this.statusCode < 300, data: Array.isArray(data) ? data : [] };
    }
}

function mockReq(): Partial<IncomingMessage> {
    return { method: "GET", url: "/api/tenants" };
}

export async function tenantE2E() {
    const routes = await tenantRoutes();
    const r = routes.find(rt =>
        rt.method === "GET" &&
        (typeof rt.path === "string" ? rt.path === "/api/tenants" : (rt.path as RegExp).test("/api/tenants"))
    );
    if (!r) throw new Error("GET /api/tenants route not found");

    const res = new MockRes() as unknown as ServerResponse;
    const req = mockReq() as IncomingMessage;

    // @ts-ignore
    await r.handler(req, res);

    return (res as unknown as MockRes).result();
}
