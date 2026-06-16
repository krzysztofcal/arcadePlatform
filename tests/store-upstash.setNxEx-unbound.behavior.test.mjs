import assert from "node:assert/strict";
import { __remoteStoreForTests as remoteStore } from "../netlify/functions/_shared/store-upstash.mjs";

const run = async () => {
  const calls = [];
  const originalEval = remoteStore.eval;
  remoteStore.eval = async (script, keys, argv) => {
    calls.push({ script: String(script || ""), keys, argv });
    return "OK";
  };

  try {
    const { setNxEx } = remoteStore;
    const result = await setNxEx("k", 10, "v");
    assert.equal(result, "OK");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].keys?.[0], "k");
    assert.equal(calls[0].argv?.[0], "v");
    assert.equal(calls[0].argv?.[1], "10");
    assert.ok(calls[0].script.toLowerCase().includes("'nx'"));
    assert.ok(calls[0].script.toLowerCase().includes("'ex'"));
  } finally {
    remoteStore.eval = originalEval;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
