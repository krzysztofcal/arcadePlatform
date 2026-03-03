import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

test("infra VPS WS smoke-check does not depend on globally installed ws tooling", () => {
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");

  assert.equal(text.includes("command -v wscat"), false);
  assert.equal(text.includes("docker run"), false);
  assert.equal(text.includes("npm i ws"), false);
  assert.equal(text.includes("require('ws')"), false);
  assert.equal(text.includes("require('node:tls')"), false);
  assert.equal(text.includes("require('node:crypto')"), false);

  assert.ok(text.includes("require('tls')"));
  assert.ok(text.includes("require('crypto')"));
  assert.ok(text.includes("if command -v node >/dev/null 2>&1; then"));
  assert.ok(text.includes("--connect-timeout 5"));
  assert.ok(text.includes("--max-time 10"));
  assert.ok(text.includes('mktemp'));
  assert.ok(text.includes('-D "$HDRS"'));
  assert.ok(text.includes('head -n 1 "$HDRS"'));
  assert.ok(text.includes("grep -q '^HTTP/1\\.1 101 '"));
});
