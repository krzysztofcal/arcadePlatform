import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

function pushBlock(text) {
  const match = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\n\w/);
  return match ? match[1] : "";
}

test("ws-deploy push trigger surface includes WS browser/server contract coverage", () => {
  const text = workflowText();
  const push = pushBlock(text);

  assert.match(push, /paths:[\s\S]*-\s*"ws-tests\/\*\*"/);
  assert.match(push, /"ws-server\/\*\*"/);
  assert.match(push, /"poker\/\*\*"/);
  assert.match(push, /"tests\/\*\*"/);
  assert.match(push, /"scripts\/test-all\.mjs"/);
  assert.match(push, /"scripts\/generate-build-info\.js"/);
  assert.match(push, /"tests\/poker-ws-client\.test\.mjs"/);
  assert.match(push, /"docs\/poker-deployment\.md"/);
  assert.match(push, /paths:[\s\S]*-\s*"\.github\/workflows\/ws-deploy\.yml"/);
});


test("ws-deploy explicitly executes poker ws client preview-routing test", () => {
  const text = workflowText();
  assert.match(text, /Run poker ws client behavior test/);
  assert.match(text, /node --test tests\/poker-ws-client\.test\.mjs/);
});


test("preview ws systemd example entrypoint stays aligned with ws runtime", () => {
  const text = fs.readFileSync("infra/vps/ws-server-preview.service.example", "utf8");
  assert.match(text, /ExecStart=\/usr\/bin\/node server\.mjs/);
  assert.doesNotMatch(text, /server\.js/);
});
