// cortex/tests/test_tenant_integration.ts
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import {execSync} from "node:child_process";
import chalk from "chalk";
// import tenantsRouter from "../temp/Tenant.api";
import {TenantRepo} from "../code/tenant.repo";
import {closeEngine, execute } from "../../../../../cortex/database/connection_manager";

/**
 * Starts a lightweight Express app with the tenant API mounted.
 * Returns base URL and a shutdown function.
 */
async function startServer() {
    const app = express();
    app.use(express.json());
    app.use("/api/tenant", tenantsRouter);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (addr == null || typeof addr === "string") throw new Error("No address from server.listen");
    const baseURL = `http://127.0.0.1:${addr.port}`;

    return {
        baseURL,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve())),
            ),
    };
}

function printStep(num: number, title: string) {
    console.log(chalk.cyan(`\n[${num}] ${title}...`));
}

function printResult(success: boolean, msg: string) {
    if (success) {
        console.log(chalk.green(`   ✔ ${msg}`));
    } else {
        console.log(chalk.red(`   ✘ ${msg}`));
    }
}

export async function tenantIntegrationTests(p0: { routerPathCandidates: string[]; }) {
    console.log(chalk.magenta("▶ Tenant Integration Tests starting with real DB + HTTP"));

    // 🔄 Reset DB before running tests
    try {
        console.log(chalk.yellow("Resetting database with migrations (pnpm cx migration fresh)..."));
        execSync("pnpm cx migration fresh", {stdio: "inherit"});
        // await closeEngine();
    } catch (err) {
        console.error(chalk.red("❌ Failed to reset database before tests"), err);
        throw err;
    }

    const {baseURL, close} = await startServer();
    console.log(chalk.yellow(`Server started at ${baseURL}`));

    try {
// 1. Create Tenant
        printStep(1, "Create tenant via POST /api/tenant");
        {
            const res = await fetch(`${baseURL}/api/tenants`, {
                method: "POST",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({
                    slug: "integ-acme",
                    name: "Integ Acme",
                    email: null,
                    meta: null,
                }),
            });
            const body = await res.json();
            console.log(chalk.gray("   [debug] API create response:"), body); // 👈 NEW

            assert.equal(res.status, 201);
            const id = (body.data?.id ?? body.id) as number | undefined;
            assert.ok(id, "POST should return an id");
            printResult(true, "Tenant created successfully with id " + id);

            // 👇 add a direct DB check after create
            const result = await execute("default", "SELECT * FROM tenant WHERE id = ?", [id]);
            console.log(chalk.gray("   [debug] DB insert result object:"), result);
        }

        // 2. List Tenants
        printStep(2, "List tenant via GET /api/tenant");
        {
            const res = await fetch(`${baseURL}/api/tenants?limit=5&offset=0`);
            const body = await res.json();
            assert.equal(res.status, 200);
            assert.ok(
                Array.isArray(body?.data) || Array.isArray(body),
                "GET list should return an array",
            );
            printResult(true, `Listed tenants count: ${body?.data?.length ?? body.length}`);
        }

        // 3. Show Tenant by Slug
        printStep(3, "Show tenant via GET /api/tenant/by-slug/integ-acme");
        {
            const res = await fetch(`${baseURL}/api/tenants/by-slug/integ-acme`);
            const body = await res.json();
            assert.equal(res.status, 200);
            const t = body.data ?? body;
            assert.equal(t.slug, "integ-acme");
            printResult(true, `Fetched tenant with slug ${t.slug}`);
        }

        // 4. Update Tenant
        printStep(4, "Update tenant via PATCH /api/tenant/:id");
        {
            const bySlug = await TenantRepo.findBySlug("integ-acme");
            assert.ok(bySlug, "precondition: slug should exist");
            const res = await fetch(`${baseURL}/api/tenants/${bySlug!.id}`, {
                method: "PATCH",
                headers: {"content-type": "application/json"},
                body: JSON.stringify({name: "Integ Acme Updated"}),
            });
            const body = await res.json();
            assert.equal(res.status, 200);
            const t = body.data ?? body;
            assert.equal(t.name, "Integ Acme Updated");
            printResult(true, `Updated tenant name to "${t.name}"`);
        }

        // // 5. Delete Tenant
        // printStep(5, "Delete tenant via DELETE /api/tenant/:id");
        // {
        //     const bySlug = await TenantRepo.findBySlug("integ-acme");
        //     assert.ok(bySlug, "precondition: slug should exist before delete");
        //     const res = await fetch(`${baseURL}/api/tenant/${bySlug!.id}`, {
        //         method: "DELETE",
        //     });
        //     assert.equal(res.status, 204);
        //
        //     const res2 = await fetch(`${baseURL}/api/tenant/by-slug/integ-acme`);
        //     assert.equal(res2.status, 404);
        //     printResult(true, "Tenant deleted and confirmed not found");
        // }


        // 5. Delete Tenant (split into sub-steps)
        printStep(5, "Delete tenant flow");

        {
            // 5a: Fetch tenant by slug before delete
            console.log(chalk.blue("   [5a] Fetching tenant before delete..."));
            const bySlugBefore = await TenantRepo.findBySlug("integ-acme");
            assert.ok(bySlugBefore, "Tenant must exist before delete");
            console.log(chalk.green("   ✔ Tenant found before delete, id=" + bySlugBefore.id));

            // 5b: Perform DELETE
            console.log(chalk.blue("   [5b] Sending DELETE /api/tenant/:id..."));
            const res = await fetch(`${baseURL}/api/tenants/${bySlugBefore.id}`, {
                method: "DELETE",
            });
            console.log(chalk.yellow(`   Response status: ${res.status}`));
            assert.equal(res.status, 204);
            console.log(chalk.green("   ✔ DELETE returned 204"));


// 5c-raw: Verify tenant directly in DB after delete
            console.log(chalk.blue("   [5c-raw] Fetching tenant after delete (raw SQL check)..."));
            try {
                const result = await execute("default", `SELECT * FROM tenants WHERE slug = ?`, ["integ-acme"]);
                console.log(chalk.gray("   [debug] raw execute() return object:"), result); // 👈 NEW
                const rows = result?.rows ?? result;
                console.log("   DB rows after delete:", rows);
            } catch (err) {
                console.error("   DB query error:", err);
            }
// 5c-api: Verify tenant via API after delete
            console.log(chalk.blue("   [5c-api] Fetching tenant after delete (API)..."));
            try {
                const res2 = await fetch(`${baseURL}/api/tenants/by-slug/integ-acme`);
                console.log(chalk.yellow(`   Response status: ${res2.status}`));
                const body2 = await res2.json().catch(() => null);
                console.log(chalk.gray("   Response body:"), body2);

                // Expect 404 because slug should not be accessible after soft delete
                assert.equal(res2.status, 404);
                console.log(chalk.green("   ✔ Tenant not found after delete (404)"));
            } catch (err) {
                console.error(chalk.red("   ✘ Error while fetching after delete (API)"), err);
                throw err;
            }
        }


        console.log(chalk.green("\n✔ Tenant Integration Tests completed successfully!"));
    } finally {
        await close();
        await closeEngine();
    }
}
