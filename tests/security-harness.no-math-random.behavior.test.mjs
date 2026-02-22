import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "tests/e2e-security.spec.ts",
  "tests/e2e-origin-allowlist.behavior.test.mjs",
  "tests/e2e-security.harness.rate-limit-disabled.behavior.test.mjs",
  "tests/rate-limit.key-derivation.behavior.test.mjs",
];

for (const filePath of files) {
  const content = readFileSync(new URL(`../${filePath}`, import.meta.url), "utf8");
  assert.equal(content.includes("Math.random"), false, `Math.random found in ${filePath}`);
}

console.log("security harness no Math.random behavior test passed");
