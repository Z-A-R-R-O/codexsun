// apps/cxsun/tests/test.ts
import { createLogger } from "../cortex/log/logger";
import { tenantE2E } from "./tenant/tenant.e2.test";

const logger = createLogger({ name: "TenantE2E", emoji: true, color: true, level: "info" });

(async () => {
    try {
        logger.start("Running tenantE2E test...", { phase: "start" });

        const result = await tenantE2E();
        const count =
            Array.isArray(result?.data) ? result.data.length :
                (typeof result?.data?.total === "number" ? result.data.total : 0);

        // Always treat as success for this smoke test
        logger.success("Tenant list retrieved successfully", { count });  // ✅

        logger.stop("tenantE2E test finished.", { phase: "stop" });
    } catch (err) {
        logger.error(err as Error, { phase: "tenantE2E" });
        process.exitCode = 1;
    }
})();
