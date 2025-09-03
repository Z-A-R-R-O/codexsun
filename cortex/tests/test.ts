// Minimal test entry: just loads .env and runs the cfg tests.
import 'dotenv/config';


import {userIntegrationTests} from "../../apps/cxsun/src/user/old/core/user_integration.test";
import {createLogger} from "../log/logger";
import {info} from "autoprefixer";


async function main() {
    await userIntegrationTests()

    // logger.info("[test] all done🙏")
}

main().catch((e) => {
    console.error('[test] fatal', e);
    process.exit(1);
});
