// tests/test.ts
// Thin entrypoint that calls the exported app test runner.

import run from "./apps/app-test";

run().catch((e) => {
    console.error("[test] fatal", e);
    process.exit(1);
});
