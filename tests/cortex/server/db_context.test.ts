// tests/db_context.test.ts
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "http";

// Manually stub Connection (instead of mock.module)
const fakeConnection = async (_profile: string) => ({
    Query: async (_sql: string, _p?: unknown) => [],
    FetchOne: async <T>(_sql: string, _p?: unknown) => (null as T | null),
    FetchAll: async <T>(_sql: string, _p?: unknown) => ([] as T[]),
    ExecuteMany: async (_sql: string, _sets: unknown[]) => ({}),
    Begin: async () => ({}),
    Commit: async () => ({}),
    Rollback: async () => ({}),
    Engine: () => ({ engine: "mock" }),
    GetConnection: () => ({ conn: "mock" }),
    Close: async () => {},
    Healthz: async () => true,
});

// Import middleware
import { dbContextMiddleware } from "../../../cortex/http/middleware/db_context";

function makeReq(headers: Record<string, string> = {}, tenantId?: string) {
    return {
        headers,
        tenant: tenantId ? { id: tenantId } : undefined,
    } as unknown as IncomingMessage & { tenant?: { id?: string | null }; db?: any };
}
function makeRes(): ServerResponse {
    return {} as ServerResponse;
}

export async function dbContextTests() {
    // override Connection inside middleware via DI
    const mw = dbContextMiddleware(
        (req) =>
            ((req.headers["x-db-profile"] as string) ||
                (req.tenant?.id as string) ||
                "default") as any,
        fakeConnection as any,
    );

    // Case 1: header wins
    {
        const req = makeReq({ "x-db-profile": "alpha" });
        await mw(req, makeRes(), () => Promise.resolve());
        assert.ok(req.db);
        assert.equal(req.db.profile, "alpha");
        assert.equal(typeof req.db.engine(), "object");
        assert.equal(await req.db.healthz(), true);
    }

    // Case 2: tenant id fallback
    {
        const r1 = makeReq({}, "t_acme");
        await mw(r1, makeRes(), () => Promise.resolve());
        assert.equal(r1.db.profile, "t_acme");
    }

    // Case 3: default fallback
    {
        const r2 = makeReq();
        await mw(r2, makeRes(), () => Promise.resolve());
        assert.equal(r2.db.profile, "default");
    }

    console.info("✅ dbContextTests passed");
}
