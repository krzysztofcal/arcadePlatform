import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("runner smoke check validates TLS/WebSocket handshake and helloAck with diagnostics", () => {
  const text = workflowText();

  assert.match(text, /const socket = tls\.connect/);
  assert.match(text, /if \(!statusLine\.includes\('101'\)\) return fail\('unexpected-status'\)/);
  assert.match(text, /sec-websocket-accept/);
  assert.match(text, /if \(wsAccept !== expectedAccept\) return fail\('invalid-accept-header'\)/);
  assert.match(text, /"type":"helloAck"/);

  assert.match(text, /stage=\$\{stage\}/);
  assert.match(text, /reason=\$\{reason\}/);
  assert.match(text, /status=\$\{statusLine \|\| 'n\/a'\}/);
  assert.match(text, /accept=\$\{wsAccept \|\| 'n\/a'\}/);
});
