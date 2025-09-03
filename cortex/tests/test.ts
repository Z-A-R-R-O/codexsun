// Minimal test entry: just loads .env and runs the cfg tests.
import 'dotenv/config';


import {userIntegrationTests} from "../../apps/cxsun/src/user/core/user_integration.test";


async function main() {
    await userIntegrationTests()
}

main().catch((e) => {
    console.error('[test] fatal', e);
    process.exit(1);
});
