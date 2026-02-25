import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("poker/poker.js", "utf8");
const match = source.match(/var\s+HEARTBEAT_INTERVAL_MS\s*=\s*(\d+)\s*;/);

assert.ok(match, "Expected HEARTBEAT_INTERVAL_MS constant in poker/poker.js");
const intervalMs = Number(match[1]);
assert.ok(Number.isFinite(intervalMs), "Expected HEARTBEAT_INTERVAL_MS to be numeric");
assert.ok(intervalMs <= 5000, `Expected HEARTBEAT_INTERVAL_MS <= 5000ms but found ${intervalMs}`);
