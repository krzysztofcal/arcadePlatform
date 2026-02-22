import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./e2e-security.spec.ts", import.meta.url), "utf8");
assert.equal(source.includes("Math.random"), false);

console.log("e2e-security no insecure randomness behavior test passed");
