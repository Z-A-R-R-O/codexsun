// apps/app-test.ts
// App-level test runner (exports default). Loads env and runs the tenant suite.

import "dotenv/config";
import { tenantE2E } from "./cxsun/tenant/tenant.e2e.test";
import { resolveLogger } from "../base/bootstrap";

export default async function runAppTests() {
    const logger = await resolveLogger();
    logger.info("[runner] starting tenant suite");
    await tenantE2E();
    logger.info("[runner] all done 🙏");
}
