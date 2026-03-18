import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-preview-deploy.yml", "utf8");
}

test("ws-preview deploy workflow stays manual, validate-gated and preview-only", () => {
  const text = workflowText();

  assert.match(text, /name: WS Preview Deploy/);
  assert.match(text, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(text, /pull_request:/);
  assert.doesNotMatch(text, /push:/);
  assert.match(text, /validate:/);
  assert.match(text, /deploy:/);
  assert.match(text, /deploy:\n\s+needs: validate/);
  assert.match(text, /ref: \$\{\{ github\.ref \}\}/);
  assert.match(text, /PREVIEW_PUBLIC_HOST: \$\{\{ secrets\.WS_PREVIEW_HOST \}\}/);

  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /127\.0\.0\.1:3100\/healthz/);
  assert.match(text, /https:\/\/\$PREVIEW_PUBLIC_HOST\/healthz/);
  assert.match(text, /\/opt\/arcade-ws-preview/);
  assert.match(text, /ws-server-preview-dist\.tgz/);
  assert.match(text, /node --test ws-tests\/ws-preview-deploy\.workflow\.guard\.test\.mjs/);

  assert.doesNotMatch(text, /ws-server\.service/);
  assert.doesNotMatch(text, /ws\.kcswh\.pl/);
  assert.doesNotMatch(text, /127\.0\.0\.1:3000/);
  assert.match(text, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.doesNotMatch(text, /\/opt\/ws-server-preview/);
});
