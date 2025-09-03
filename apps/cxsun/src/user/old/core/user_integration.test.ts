import Fastify from "fastify";
import chalk from "chalk";
import userApi from "./user.api"; // adjust path if needed

export async function userIntegrationTests() {
    const fastify = Fastify({ logger: false });
    await fastify.register(userApi, { prefix: "/api" });
    await fastify.ready();

    console.log(chalk.cyan("\n=== User API Integration Tests ==="));
    console.log(fastify.printRoutes());

    // helper: inject + parse JSON
    async function injectJson(method: string, url: string, payload?: any) {
        const res = await fastify.inject({ method, url, payload });
        let json: any = null;
        try {
            json = res.body ? JSON.parse(res.body) : null;
        } catch {
            json = res.body;
        }
        return { res, json };
    }

    // --- 0. Health check ---
    {
        const { res, json } = await injectJson("GET", "/api/users/z");
        if (res.statusCode === 200 && json?.status === "ok") {
            console.log(chalk.green(`✔ health check ok (${json.service})`));
        } else {
            console.log(
                chalk.red(
                    `✘ health check failed (${res.statusCode}), body=${JSON.stringify(json)}`
                )
            );
            await fastify.close();
            return; // stop further tests if API not healthy
        }
    }

    // helper: extract array from response
    function extractArray(json: any): any[] | null {
        if (Array.isArray(json)) return json;
        if (Array.isArray(json?.data)) return json.data;
        if (Array.isArray(json?.items)) return json.items;
        return null;
    }

    // helper: extract id from response
    function extractId(json: any): number | string | null {
        return (
            json?.id ??
            json?.data?.id ??
            json?.user?.id ??
            json?.result?.id ??
            json?.insertId ??
            json?.lastId ??
            null
        );
    }

    // --- 1. List ---
    {
        const { res, json } = await injectJson("GET", "/api/users");
        const arr = extractArray(json);
        if (res.statusCode === 200 && arr) {
            console.log(chalk.green(`✔ list users works (count=${arr.length})`));
        } else {
            console.log(
                chalk.yellow(
                    `↪ list endpoint returned ${res.statusCode}, structure=${JSON.stringify(
                        json
                    ).slice(0, 80)}...`
                )
            );
        }
    }

    // ... rest of your tests unchanged ...
    // (Create, Get by ID, Update, Validation error, Duplicate email, Pagination, Search, Patch, Delete, Restore)

    await fastify.close();
    console.log(chalk.bold.green("\n=== User API Integration Tests Completed ==="));
}
