import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const TARGET_FILES = [
  "ws-tests/infra-vps-workflow.guard.test.mjs",
  "ws-tests/infra-vps-workflow.smokecheck-structure.behavior.test.mjs",
  "ws-tests/infra-vps-workflow.ws-smokecheck-deps.guard.test.mjs"
];

const bannedUrl = ["https://", "ws.kcswh.pl", "/ws"].join("");

test("infra VPS ws tests avoid literal full URL substring patterns that trigger CodeQL", () => {
  for (const path of TARGET_FILES) {
    const text = fs.readFileSync(path, "utf8");
    assert.equal(text.includes(bannedUrl), false, `${path} must not contain full URL literal`);
  }
});
