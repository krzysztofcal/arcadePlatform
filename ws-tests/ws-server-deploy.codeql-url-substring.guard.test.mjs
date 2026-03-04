import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const TARGET_FILES = [
  "ws-tests/ws-server-deploy.remote-script.behavior.test.mjs",
  "ws-tests/ws-server-deploy.runner-smoke.behavior.test.mjs",
  "ws-tests/ws-server-deploy.workflow.guard.test.mjs"
];

const bannedHealthzUrl = ["https://", "ws.kcswh.pl", "/healthz"].join("");
const bannedWsUrl = ["https://", "ws.kcswh.pl", "/ws"].join("");

test("ws-server deploy harness avoids literal full URL substrings that trigger CodeQL", () => {
  for (const path of TARGET_FILES) {
    const text = fs.readFileSync(path, "utf8");
    assert.equal(text.includes(bannedHealthzUrl), false, `${path} must not contain full healthz URL literal`);
    assert.equal(text.includes(bannedWsUrl), false, `${path} must not contain full ws URL literal`);
  }
});
