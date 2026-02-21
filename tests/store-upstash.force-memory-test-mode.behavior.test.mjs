import assert from "node:assert/strict";

const CASE = `force-memory-${process.pid}-${Date.now()}`;

process.env.XP_TEST_MODE = "1";
process.env.UPSTASH_REDIS_REST_URL = "https://example.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "token";

const { isMemoryStore, store } = await import(`../netlify/functions/_shared/store-upstash.mjs?case=${CASE}`);

assert.equal(isMemoryStore, true);

const key = `store-upstash:test:${CASE}`;
await store.set(key, "ok");
const value = await store.get(key);
assert.equal(value, "ok");

console.log("store-upstash force-memory test-mode behavior test passed");
