// tests/cache.test.ts
import assert from "node:assert/strict";
import { createCache } from "../cortex/http/cache";

export async function cacheTests() {
    const cache = createCache({ driver: "memory", namespace: "test", json: true });

    await cache.set("greet", { hi: "there" }, 2);
    assert.deepEqual(await cache.get("greet"), { hi: "there" });

    let calls = 0;
    const loader = async () => { calls++; return { ts: Date.now() }; };
    const a = await cache.wrap("user:1", 2, loader);
    const b = await cache.wrap("user:1", 2, loader);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);

    const n1 = await cache.incr("count");
    const n2 = await cache.incr("count", 2);
    assert.equal(n1, 1);
    assert.equal(n2, 3);
    await cache.decr("count", 1);
    assert.equal(await cache.get("count"), "2");

    await cache.expire("count", 1);
    const ttl = await cache.ttl("count");
    assert.ok(typeof ttl === "number" || ttl === null);

    const keys = await cache.keys();
    assert.ok(Array.isArray(keys));

    await cache.flush();
    assert.equal(await cache.get("greet"), undefined);

    console.info("✅ cacheTests passed");
}
