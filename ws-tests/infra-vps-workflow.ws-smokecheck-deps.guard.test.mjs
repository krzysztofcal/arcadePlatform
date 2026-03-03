import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function remoteBash(text) {
  const start = text.indexOf("bash <<'BASH'");
  const end = text.indexOf("\n            BASH", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start, end);
}

test("infra VPS ws smoke-check uses built-in node modules only on runner", () => {
  const text = workflowText();
  const remote = remoteBash(text);

  assert.equal(text.includes("command -v wscat"), false);
  assert.equal(text.includes("npm i ws"), false);
  assert.equal(text.includes("docker run"), false);
  assert.equal(text.includes("require('ws')"), false);

  assert.ok(text.includes("timeout 15s node <<'NODE'"));
  assert.ok(text.includes("require('tls')"));
  assert.ok(text.includes("require('crypto')"));

  assert.equal(remote.includes("command -v node"), false);
  assert.equal(remote.includes("timeout 12s node"), false);
  assert.equal(remote.includes("https://ws.kcswh.pl/ws"), false);
});
