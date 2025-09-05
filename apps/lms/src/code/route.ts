// apps/cxsun/src/tenant/code/tenant.routes.ts

import { Router } from "../../../../cortex/http/route";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

function toHttpRequest(req: IncomingMessage): any {
    const url = new URL(req.url || "/", "http://localhost");
    const query: Record<string, string | string[]> = {};
    // simple query parser preserving arrays ?a=1&a=2
    url.searchParams.forEach((v, k) => {
        if (k in query) {
            const prev = query[k];
            query[k] = Array.isArray(prev) ? [...prev, v] : [prev as string, v];
        } else {
            query[k] = v;
        }
    });
    return {
        method: req.method || "GET",
        path: url.pathname,
        query,
        headers: Object.create(null), // keep minimal for now
        body: undefined,
        files: undefined,
        raw: req,
    };
}

function writeJson(res: ServerResponse, payload: unknown, status = 200) {
    const body = JSON.stringify(payload ?? null);
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-length", Buffer.byteLength(body));
    res.write(body);
    res.end();
}

function withHandler(fn: (httpReq: any) => any | Promise<any>) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const httpReq = toHttpRequest(req);
            const data = await fn(httpReq);
            writeJson(res, data, 200);
        } catch (err: any) {
            writeJson(res, { ok: false, error: "INTERNAL", message: err?.message || String(err) }, 500);
        }
    };
}

// Helpers to inject params for :id style routes
function withParam(name: string, fn: (httpReq: any) => any | Promise<any>) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        const httpReq = toHttpRequest(req);
        const parts = httpReq.path.split("/").filter(Boolean);
        const id = parts[parts.length - 1]; // naive: last segment
        httpReq.params = { ...(httpReq.params || {}), [name]: id };
        try {
            const data = await fn(httpReq);
            writeJson(res, data, 200);
        } catch (err: any) {
            writeJson(res, { ok: false, error: "INTERNAL", message: err?.message || String(err) }, 500);
        }
    };
}

export function lmsRoutes() {
    const route = new Router();
    const ctx = new LmsController();

    // list + create meta
    route.get("/api/tenants", withHandler(ctx.index.bind(ctx))).named("tenants:index");
    route.get("/api/tenants/create", withHandler(ctx.create.bind(ctx))).named("tenants:create");

    // read/edit/update
    route.get("/api/tenants/:id", withParam("id", ctx.edit.bind(ctx))).named("tenants:show");
    route.get("/api/tenants/:id/edit", withParam("id", ctx.edit.bind(ctx))).named("tenants:edit");
    route.put("/api/tenants/:id", withParam("id", ctx.update.bind(ctx))).named("tenants:update");

    // store + delete
    route.post("/api/tenants", withHandler(ctx.store.bind(ctx))).named("tenants:store");
    route.delete("/api/tenants/:id", withParam("id", ctx.delete.bind(ctx))).named("tenants:delete");

    // print + upload + download
    route.get("/api/tenants/:id/print", withParam("id", ctx.print.bind(ctx))).named("tenants:print");
    route.post("/api/tenants/upload", withHandler(ctx.upload.bind(ctx))).named("tenants:upload");
    route.get("/api/tenants/:id/download", withParam("id", ctx.download.bind(ctx))).named("tenants:download");

    return route.all();
}
