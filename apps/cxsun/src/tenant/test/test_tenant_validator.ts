// cortex/tests/test_tenant_validator.ts
import assert from "node:assert/strict";
import { TenantCreateSchema, TenantUpdateSchema } from "../code/tenant.validator";
import { logger } from "../../../../../cortex/log/logger";

export async function tenantValidatorTests() {
    logger.info("▶ TenantValidator: starting tests");

    // create: minimal valid
    {
        const parsed = TenantCreateSchema.parse({ slug: "acme", name: "Acme" });
        logger.debug("create minimal", { parsed });
        assert.equal(parsed.slug, "acme");
        assert.equal(parsed.name, "Acme");
        // if default(true) is applied:
        // @ts-ignore
        if ("is_active" in parsed) assert.equal(typeof parsed.is_active, "boolean");
    }

    // create: invalid email
    {
        let threw = false;
        try {
            // @ts-ignore
            TenantCreateSchema.parse({ slug: "x", name: "X", email: "nope" });
        } catch (e) {
            threw = true;
            logger.debug("create invalid email threw as expected", { error: String(e) });
        }
        assert.equal(threw, true);
    }

    // create: null email/meta allowed
    {
        const parsed = TenantCreateSchema.parse({ slug: "x", name: "X", email: null, meta: null });
        logger.debug("create nullable fields", { parsed });
        assert.equal(parsed.email, null);
        assert.equal(parsed.meta, null);
    }

    // update: partial OK
    {
        const parsed = TenantUpdateSchema.parse({ name: "New Name" });
        logger.debug("update partial", { parsed });
        assert.equal(parsed.name, "New Name");
    }

    // update: unknown key rejected due to .strict()
    {
        let threw = false;
        try {
            // @ts-ignore
            TenantUpdateSchema.parse({ nope: true });
        } catch (e) {
            threw = true;
            logger.debug("update unknown key threw as expected", { error: String(e) });
        }
        assert.equal(threw, true);
    }

    logger.info("✔ TenantValidator: all tests passed");
}
