// tests/apps/cxsun/tenant/tenant.e2e.test.ts
// Tenant e2e
// - Test 1: Tenant Healthz
// - Test 2: Tenant List
// - Test 3: Tenant Get by ID (existing or fake)
// - Test 4: Tenant Update (only if we have an ID)

import assert from "node:assert/strict";
import { bootstrap, section } from "../../../base/bootstrap";

function extractListItems(body: any): any[] {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.items)) return body.items;
    return [];
}
function extractCount(body: any): number | undefined {
    if (typeof body?.count === "number") return body.count;
    const items = extractListItems(body);
    if (items) return items.length;
    return undefined;
}
function expectOneOf(status: number, allowed: number[], label: string) {
    assert.ok(allowed.includes(status), `${label} -> unexpected status ${status} (allowed: ${allowed.join(",")})`);
}

export async function tenantE2E(): Promise<void> {
    const { baseURL, logger, client } = await bootstrap({ probePath: "/api/tenants/hz" });

    // ---------------- Test 1: Tenant Healthz ----------------
    {
        const path = "/api/tenants/hz";

        section(logger, "Test 1: Tenant Healthz — request");
        logger.info("GET " + baseURL + path);

        const res = await client.get(path);

        section(logger, "Test 1: Tenant Healthz — response");
        logger.info(`status: ${res.status}`);
        logger.info(res.json ?? res.text);

        assert.equal(res.status, 200, `expected 200, got ${res.status}`);
        if (res.json && typeof res.json === "object" && "ok" in res.json) {
            assert.equal(res.json.ok, true, "expected body.ok === true");
        }

        logger.info("Test 1: Tenant Healthz — ✅ passed");
    }

    // ---------------- Test 2: Tenant List -------------------
    let listItems: any[];
    {
        const path = "/api/tenants";

        section(logger, "Test 2: Tenant List — request");
        logger.info("GET " + baseURL + path);

        const res = await client.get(path);

        section(logger, "Test 2: Tenant List — response");
        logger.info(`status: ${res.status}`);
        logger.info(res.json ?? res.text);

        assert.equal(res.status, 200, `expected 200, got ${res.status}`);
        assert.equal(res.json?.ok, true, "expected body.ok === true");
        assert.ok(Array.isArray(res.json?.items), "items should be an array");

        const count = extractCount(res.json);
        listItems = extractListItems(res.json);
        assert.ok(typeof count === "number", "count should be a number");
        assert.equal(listItems.length, count, "items.length should match count");

        logger.info("Test 2: Tenant List — ✅ passed", { count });
    }

    // ---------------- Test 3: Get by ID ---------------------
    const envId = process.env.E2E_TENANT_ID && String(process.env.E2E_TENANT_ID);
    const candidateId: string | undefined =
        envId || (listItems.length > 0 && typeof listItems[0]?.id === "string" ? listItems[0].id : undefined);

    if (candidateId) {
        const path = `/api/tenants/${candidateId}`;

        section(logger, "Test 3: Get by ID — request");
        logger.info("GET " + baseURL + path);

        const res = await client.get(path);

        section(logger, "Test 3: Get by ID — response");
        logger.info(`status: ${res.status}`);
        logger.info(res.json ?? res.text);

        expectOneOf(res.status, [200], "get tenant by id");
        const obj = res.json?.item ?? res.json;
        if (obj && typeof obj === "object") {
            assert.equal(obj.id, candidateId, "fetched tenant id mismatch");
        }

        logger.info("Test 3: Get by ID — ✅ passed", { id: candidateId });
    } else {
        const fake = "ffffffffffffffffffffffff";
        const path = `/api/tenants/${fake}`;

        section(logger, "Test 3: Get by ID (fake) — request");
        logger.info("GET " + baseURL + path);

        const res = await client.get(path);

        section(logger, "Test 3: Get by ID (fake) — response");
        logger.info(`status: ${res.status}`);
        logger.info(res.json ?? res.text);

        expectOneOf(res.status, [404, 400], "get unknown tenant");
        logger.info("Test 3: Get by ID (fake) — ✅ passed", { id: fake });
    }

    // ---------------- Test 4: Update ------------------------
    if (candidateId) {
        const newName = `e2e-updated-${Date.now()}`;

        {
            const path = `/api/tenants/${candidateId}`;

            section(logger, "Test 4: Update — request (PATCH name)");
            logger.info("PATCH " + baseURL + path);
            logger.info("body", { name: newName });


            const res = await client.patch(path, { name: newName });

            section(logger, "Test 4: Update — response");
            logger.info(`status: ${res.status}`);
            logger.info(res.json ?? res.text);

            expectOneOf(res.status, [200, 204], "update tenant");

            if (res.status === 200 && typeof res.json === "object" && res.json) {
                const obj = res.json?.item ?? res.json;
                if (typeof obj?.name === "string") {
                    assert.equal(obj.name, newName, "updated name not reflected in PATCH response");
                }
            }
        }
        {
            const path = `/api/tenants/${candidateId}`;

            section(logger, "Test 4: Update — verify (GET after PATCH)");
            logger.info("GET " + baseURL + path);

            const res = await client.get(path);

            section(logger, "Test 4: Update — verify response");
            logger.info(`status: ${res.status}`);
            logger.info("body", res.json ?? res.text);


            expectOneOf(res.status, [200], "re-get after update");
            const obj = res.json?.item ?? res.json;
            if (typeof obj?.name === "string") {
                assert.ok(obj.name.startsWith("e2e-updated-"), "updated name not persisted");
            }
        }
        {
            const path = `/api/tenants/${candidateId}`;

            section(logger, "Test 4: Update — immutable guard (PATCH id)");
            logger.info("PATCH " + baseURL + path);
            logger.info("body", { id: "nope" });



            const res = await client.patch(path, { id: "nope" });

            section(logger, "Test 4: Update — immutable guard response");
            logger.info(`status: ${res.status}`);
            logger.info(res.json ?? res.text);

            expectOneOf(res.status, [400, 422], "immutable field rejection");
        }

        logger.info("Test 4: Update — ✅ passed", { id: candidateId });
    } else {
        section(logger, "Test 4: Update — skipped");
        logger.info("no tenant id available; set E2E_TENANT_ID to exercise PATCH");
    }
}
