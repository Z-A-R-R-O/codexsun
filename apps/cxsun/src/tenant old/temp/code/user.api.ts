// ========================================= app/user/User.api.ts =========================================
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { UserController } from './user.controller';
import { UserRepo } from './user.repo';
import { ConnectionAdapter } from '../../../../../../cortex/database/contracts/ConnectionAdapter';
// import { detectDialectFromVersionString } from '../../../../../cortex/database/contracts/dialects';


// Use your existing connection manager
import { getConnection } from '../../../../../../cortex/database/connection_manager';


const UserApi: FastifyPluginAsync<{ profile?: string }> = fp(async (fastify, opts) => {
    const profile = opts.profile ?? 'default';
    const raw = await getConnection(profile);
    const conn = new ConnectionAdapter(raw);


// Detect DB version/dialect
    let version = 'unknown';
    try {
        const v1 = await conn.fetchOne<{ version?: string; VERSION?: string }>('SELECT VERSION() AS version');
        version = (v1?.version ?? (v1 as any)?.VERSION ?? 'unknown') as string;
    } catch {
        try {
            const v2 = await conn.fetchOne<{ version?: string }>('SELECT sqlite_version() AS version');
            version = v2?.version ?? 'sqlite';
        } catch {}
    }
    // const dialect = detectDialectFromVersionString(version);


    const repo = new UserRepo(conn, dialect);
    const ctl = new UserController(repo);


    fastify.get('/api/user/ensure-schema', ctl.ensureSchema);
    fastify.get('/api/user/:id', ctl.get);
    fastify.get('/api/user', ctl.list); // ?tenant_id=1&limit=50&offset=0
    fastify.post('/api/user', ctl.create);
    fastify.put('/api/user', ctl.update);
    fastify.delete('/api/user/:id', ctl.remove);
});


export default UserApi;