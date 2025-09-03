// tests/route_registry.test.ts
import assert from "node:assert/strict";
import { RouteRegistery, type RouteProvider } from "../cortex/http/route_registery";

export async function routeRegistryTests() {
    const A: RouteProvider = () => [
        {
            method: "GET",
            path: "/",
            handler: (_req, res) => {
                res.end("A"); // no return
            },
        },
        {
            method: "GET",
            path: "/healthz",
            handler: (_req, res) => {
                res.end("H");
            },
        },
    ];

    const B: RouteProvider = () => [
        {
            method: "GET",
            path: "/healthz",
            handler: (_req, res) => {
                res.end("H2");
            },
        },
        {
            method: "POST",
            path: "/login",
            handler: (_req, res) => {
                res.end("L");
            },
        },
    ];


    const reg = new RouteRegistery();
    reg.addProvider(A);
    reg.addProvider(B);

    const routes = await reg.collect();
    assert.equal(routes.length, 3);
    const keys = routes.map(
        (r) => `${Array.isArray(r.method) ? r.method.join(",") : r.method}|${String(r.path)}`,
    );
    assert.ok(keys.includes("GET|/"));
    assert.ok(keys.includes("GET|/healthz"));
    assert.ok(keys.includes("POST|/login"));

    console.info("✅ routeRegistryTests passed");
}
