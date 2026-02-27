import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

function dockerfileText() {
  return fs.readFileSync("ws-server/Dockerfile", "utf8");
}

test("workflow runs deterministic install and ws behavior test before deploy", () => {
  const text = workflowText();
  assert.match(text, /npm ci --prefix ws-server/);
  assert.match(text, /node --test ws-server\/server\.behavior\.test\.mjs/);
  assert.match(text, /node --test tests\/ws-deploy-workflow\.test\.mjs/);
  assert.match(text, /node --test tests\/ws-lockfile-integrity\.test\.mjs/);
});

test("verify step discovers ws container by compose label and avoids hardcoded name", () => {
  const text = workflowText();
  assert.doesNotMatch(text, /docker inspect ws/);
  assert.doesNotMatch(text, /docker logs ws/);
  assert.match(text, /label=com\.docker\.compose\.service=ws/);
  assert.match(text, /WS_CID="\$\(docker ps --filter "label=com\.docker\.compose\.service=ws" --format/);
  assert.match(text, /docker inspect "\$WS_CID"/);
  assert.match(text, /docker logs "\$WS_CID"/);
});

test("verify step remains bounded and deploy includes compose preflight", () => {
  const text = workflowText();
  assert.match(text, /set -euo pipefail/);
  assert.match(text, /docker compose version >\/dev\/null 2>&1 \|\| \{ echo "docker compose is required on VPS"; exit 1; \}/);
  assert.match(text, /for i in 1 2 3 4 5; do/);
  assert.match(text, /timeout 12s docker run --rm --network host node:20-alpine/);
  assert.match(text, /test "\$WSCAT_OK" = "1"/);
});


test("dockerfile enforces lockfile-based deterministic install", () => {
  const text = dockerfileText();
  assert.match(text, /COPY\s+package\.json\s+package-lock\.json/);
  assert.match(text, /npm\s+ci/);
  assert.doesNotMatch(text, /npm\s+install/);
});
