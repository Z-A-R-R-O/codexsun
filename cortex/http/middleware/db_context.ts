// cortex/http/middleware/db_context.ts
// Per-request DB context bound to the active tenant/profile.
// Uses your project's Connection facade (see /connection.ts).

import type { IncomingMessage, ServerResponse } from "http";
import { Connection, type Profile } from "../../database/connection";

type ReqWithCtx = IncomingMessage & {
    tenant?: { id?: string | null };
    db?: {
        profile: Profile;
        query: (sql: string, params?: unknown) => Promise<any>;
        fetchOne: <T = any>(sql: string, params?: unknown) => Promise<T | undefined>;
        fetchAll: <T = any>(sql: string, params?: unknown) => Promise<T[]>;
        executeMany: (sql: string, sets: unknown[]) => Promise<any>;
        begin: () => Promise<any>;
        commit: () => Promise<any>;
        rollback: () => Promise<any>;
        engine: () => Promise<any>;
        getConnection: () => Promise<any>;
        close: () => Promise<void>;
        healthz: () => Promise<boolean>;
    };
};

/**
 * Optional mapper to choose a DB profile for this request.
 * Defaults to:
 *   - header X-Db-Profile (if present)
 *   - req.tenant.id (if present)
 *   - "default"
 */
export function dbContextMiddleware(
    mapProfile: (req: ReqWithCtx) => Profile = (req) =>
        ((req.headers["x-db-profile"] as string) ||
            (req.tenant?.id as string) ||
            "default") as Profile,
) {
    return async function dbMw(req: ReqWithCtx, _res: ServerResponse, next: () => void | Promise<void>) {
        const profile = mapProfile(req);

        // Build a thin context by composing the project's Connection facade.
        const c = await Connection(profile);

        req.db = {
            profile,
            query: c.Query,
            fetchOne: c.FetchOne,
            fetchAll: c.FetchAll,
            executeMany: c.ExecuteMany,
            begin: c.Begin,
            commit: c.Commit,
            rollback: c.Rollback,
            engine: c.Engine,
            getConnection: c.GetConnection,
            close: c.Close,       // NOTE: closes the engine for this profile (pool). Use with care.
            healthz: c.Healthz,
        };

        await Promise.resolve(next());
    };
}
