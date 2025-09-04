// tenant.test.ts — Node.js native test runner
import test, { before, after } from "node:test";
import assert from "node:assert";
import { Tenant } from "../apps/cxsun/src/tenant/tenant.model";
import { AuditLog } from "../cortex/core/audit/audit.model";
import { DbRefresh } from "./DbRefresh";

before(async () => {
    await DbRefresh.refresh();
});

after(async () => {
    // No mdb.close(), pool is managed automatically
});

let tenantId: string;

test("Tenant: should start with empty list", async () => {
    const tenants = await Tenant.all();
    assert.ok(Array.isArray(tenants));
});

test("Tenant: should add a new tenant", async () => {
    const tenant = await Tenant.create({
        name: "Acme Inc",
        email: "info@acme.com",
    });
    tenantId = tenant.id!;
    assert.ok(tenantId);
    assert.strictEqual(tenant.name, "Acme Inc");
});

test("Tenant: should list tenants", async () => {
    const tenants = await Tenant.all();
    assert.ok(tenants.length > 0);
});

test("Tenant: should get tenant by id", async () => {
    const tenant = await Tenant.find(tenantId);
    assert.ok(tenant);
    assert.strictEqual(tenant!.id, tenantId);
});

test("Tenant: should update tenant", async () => {
    const tenant = await Tenant.find(tenantId);
    assert.ok(tenant);
    tenant!.name = "Acme Corporation";
    await tenant!.save();

    const updated = await Tenant.find(tenantId);
    assert.strictEqual(updated!.name, "Acme Corporation");
});

test("Tenant: should delete tenant", async () => {
    const tenant = await Tenant.find(tenantId);
    assert.ok(tenant);

    await tenant!.delete();
    const deleted = await Tenant.find(tenantId);
    assert.strictEqual(deleted, null);
});

test("Tenant: should have audit logs recorded", async () => {
    const logs = await AuditLog.all();
    assert.ok(logs.length > 0);

    const actions = logs.map(l => l.action);
    assert.ok(actions.includes("create"));
    assert.ok(actions.includes("update"));
    assert.ok(actions.includes("delete"));
});
