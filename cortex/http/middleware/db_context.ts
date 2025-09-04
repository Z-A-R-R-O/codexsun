// cortex/http/middleware/db_context.ts

import type { IncomingMessage, ServerResponse } from "http";
import type { Profile } from "../../database/db";
import { db, mdb } from "../../database/db";

type ReqWithCtx = IncomingMessage & {
    tenant?: { id?: string | null };
    db?: {
        profile: Profile;
        query: (sql: string, params?: unknown) => Promise<any>;
        fetchOne: (sql: string, params?: unknown) => Promise<any>;
        fetchAll: (sql: string, params?: unknown) => Promise<any[]>;
        execMany: (sql: string, sets: unknown[]) => Promise<any>;
        healthz: () => Promise<boolean>;
        engine: () => unknown;
    };
};

function defaultProfileMapper(req: ReqWithCtx): Profile {
    return (
        (req.headers["x-db-profile"] as string) ||
        (req.tenant?.id as string) ||
        "default"
    ) as Profile;
}

export function dbContextMiddleware(
    mapProfile: (req: ReqWithCtx) => Profile = defaultProfileMapper,
    connectionFactory?: any // for testing, lets you inject fakeConnection
) {
    return async function dbMw(
        req: ReqWithCtx,
        _res: ServerResponse,
        next: () => void | Promise<void>
    ) {
        const profile = mapProfile(req);

        if (connectionFactory) {
            // testing path
            const conn = await connectionFactory(profile);
            req.db = {
                profile,
                query: conn.Query,
                fetchOne: conn.FetchOne,
                fetchAll: conn.FetchAll,
                execMany: conn.ExecuteMany,
                healthz: conn.Healthz,
                engine: conn.Engine,
            };
        } else if (profile === "default") {
            req.db = {
                profile,
                query: (sql: string, params?: unknown) => mdb.query(sql, params),
                fetchOne: (sql: string, params?: unknown) => mdb.fetchOne(sql, params),
                fetchAll: (sql: string, params?: unknown) => mdb.fetchAll(sql, params),
                execMany: async () => {
                    throw new Error("execMany not supported on mdb");
                },
                healthz: () => mdb.healthz(),
                engine: () => undefined,
            };
        } else {
            const tenantId = profile.replace(/^tenant:/, "") || req.tenant?.id || "";
            req.db = {
                profile,
                query: (sql: string, params?: unknown) => db.query(tenantId, sql, params),
                fetchOne: (sql: string, params?: unknown) => db.fetchOne(tenantId, sql, params),
                fetchAll: (sql: string, params?: unknown) => db.fetchAll(tenantId, sql, params),
                execMany: (sql: string, sets: unknown[]) => db.execMany(tenantId, sql, sets),
                healthz: () => db.healthz(tenantId),
                engine: () => undefined,
            };
        }

        await next();
    };
}
