import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const CADDYFILE_PATH = "infra/vps/Caddyfile";
const PREVIEW_EXAMPLE_PATH = "infra/vps/Caddyfile.preview.example";
const WS_PR_WORKFLOW_PATH = ".github/workflows/ws-pr-checks.yml";

function caddyfileText() {
  return fs.readFileSync(CADDYFILE_PATH, "utf8");
}

function hostBlock(text, host) {
  const start = text.indexOf(`${host} {`);
  assert.notEqual(start, -1, `missing host block: ${host}`);
  const nextHostMatch = text.slice(start + 1).match(/\n[a-z0-9.-]+ \{/i);
  return nextHostMatch ? text.slice(start, start + 1 + nextHostMatch.index) : text.slice(start);
}

test("infra/vps/Caddyfile is the unified prod+preview WS source of truth", () => {
  const text = caddyfileText();
  const prod = hostBlock(text, "ws.kcswh.pl");
  const preview = hostBlock(text, "ws-preview.kcswh.pl");

  assert.ok(text.includes("ws.kcswh.pl"));
  assert.ok(text.includes("ws-preview.kcswh.pl"));
  assert.equal(fs.existsSync(PREVIEW_EXAMPLE_PATH), false);

  assert.match(prod, /@healthz path \/healthz/);
  assert.match(prod, /@ws path \/ws\*/);
  assert.match(prod, /reverse_proxy 127\.0\.0\.1:3000/);
  assert.match(prod, /respond "OK" 200/);

  assert.match(preview, /@healthz path \/healthz/);
  assert.match(preview, /@ws path \/ws\*/);
  assert.match(preview, /reverse_proxy 127\.0\.0\.1:3001/);
  assert.match(preview, /respond "OK" 200/);
});

test("WS PR harness runs the unified infra VPS Caddy guard", () => {
  const workflow = fs.readFileSync(WS_PR_WORKFLOW_PATH, "utf8");
  assert.ok(workflow.includes("node --test ws-tests/infra-vps-caddy.guard.test.mjs"));
});
