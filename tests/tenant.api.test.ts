// tests/tenant.api.test.ts
// Run with: npx vitest run tests/tenant.api.test.ts
import { describe, it, expect } from 'vitest';
import { exec } from './tenant.harness';

const SCOPE_READ = ['tenant:read'];
const SCOPE_WRITE = ['tenant:read','tenant:write'];

describe('Tenant API', () => {
    it('lists tenants (empty)', async () => {
        const res = await exec('GET', '/api/v1/tenants', { scopes: SCOPE_READ });
        expect(res.statusCode).toBe(200);
    });

    it('creates tenant (idempotent)', async () => {
        const body = { name: 'Acme Inc', slug: 'acme' };
        const res1 = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body, headers: { 'idempotency-key': 'k1' } });
        expect(res1.statusCode).toBe(201);
        const res2 = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body, headers: { 'idempotency-key': 'k1' } });
        expect(res2.statusCode).toBe(201);
    });

    it('gets by id with ETag/If-None-Match', async () => {
        const create = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body: { name: 'Beta', slug: 'beta' } });
        const id = create.body?.id ?? JSON.parse(JSON.stringify(create.body)).id; // depending on json helper
        const get1 = await exec('GET', `/api/v1/tenants/${id}`, { scopes: SCOPE_READ });
        const tag = get1.headers['etag'];
        const notModified = await exec('GET', `/api/v1/tenants/${id}`, { scopes: SCOPE_READ, headers: { 'if-none-match': tag } });
        expect(notModified.statusCode).toBe(304);
    });

    it('updates with If-Match', async () => {
        const c = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body: { name: 'Gamma', slug: 'gamma' } });
        const id = (c.body?.id) ?? JSON.parse(JSON.stringify(c.body)).id;
        const g = await exec('GET', `/api/v1/tenants/${id}`, { scopes: SCOPE_READ });
        const tag = g.headers['etag'];
        const u = await exec('PUT', `/api/v1/tenants/${id}`, { scopes: SCOPE_WRITE, body: { name: 'Gamma+', slug: 'gamma' }, headers: { 'if-match': tag } });
        expect(u.statusCode).toBe(200);
    });

    it('soft deletes', async () => {
        const c = await exec('POST', '/api/v1/tenants', { scopes: SCOPE_WRITE, body: { name: 'Delta', slug: 'delta' } });
        const id = (c.body?.id) ?? JSON.parse(JSON.stringify(c.body)).id;
        const d = await exec('DELETE', `/api/v1/tenants/${id}`, { scopes: SCOPE_WRITE });
        expect(d.statusCode).toBe(200);
    });
});