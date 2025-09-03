// cortex/http/middleware/db_context.ts
// Per-request DB context bound to the active tenant/profile.
// Uses your project's Connection facade.

import type { IncomingMessage, ServerResponse } from "http";
import { Connection, type Profile } from "../../database/connection";

type ReqWithCtx = IncomingMessage & {
    tenant?: { id?: string | null };
    db?: {
        profile: Profile;
        query: (sql: string, params?: unknown) => Promise<unknown>;
        fetchOne: <T = unknown>(sql: string, params?: unknown) => Promise<T | null>;
        fetchAll: <T = unknown>(sql: string, params?: unknown) => Promise<T[]>;
        executeMany: (sql: string, sets: unknown[]) => Promise<unknown>;
        begin: () => Promise<unknown>;
        commit: () => Promise<unknown>;
        rollback: () => Promise<unknown>;
        engine: () => unknown;             // Engine | undefined (sync)
        getConnection: () => unknown;      // underlying connection/pool (sync)
        close: () => Promise<void> | void; // facade may be sync or async
        healthz: () => Promise<boolean>;
    };
};

/**
 * Optional mapper to choose a DB profile for this request.
 * Order:
 *   - X-Db-Profile header
 *   - req.tenant.id
 *   - "default"
 */
export function dbContextMiddleware(
    mapProfile: (req: ReqWithCtx) => Profile = (req) =>
        ((req.headers["x-db-profile"] as string) || (req.tenant?.id as string) || "default") as Profile,
) {
    return async function dbMw(req: ReqWithCtx, _res: ServerResponse, next: () => void | Promise<void>) {
        const profile = mapProfile(req);
        const c = await Connection(profile);

        req.db = {
            profile,
            query: c.Query,
            fetchOne: c.FetchOne,       // Promise<T | null>
            fetchAll: c.FetchAll,
            executeMany: c.ExecuteMany,
            begin: c.Begin,
            commit: c.Commit,
            rollback: c.Rollback,
            engine: c.Engine,           // () => Engine | undefined (sync)
            getConnection: c.GetConnection,
            close: c.Close,
            healthz: c.Healthz,
        };

        await next();
    };
}
