// Minimal test entry: just loads .env and runs the cfg tests.
import 'dotenv/config';

import run from "./e2e.server.test";
import { logger } from "../cortex/utils/log_cx";
import { cacheTests } from "./cache.test";
import { dbContextTests } from "./db_context.test";
import { routeRegistryTests } from "./route_registry.test";
import { mdb } from "../cortex/database/db";

async function main() {
    // Ensure DB is alive before running tests
    await mdb.healthz();

    await run();
    await cacheTests();
    await dbContextTests();
    await routeRegistryTests();
    //
    logger.info("all done 🙏");
}

main().catch((e) => {
    console.error("[test] fatal", e);
    process.exit(1);
});
