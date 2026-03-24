import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/ws-preview-deploy.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function stepBlock(section, stepName) {
  const escapedName = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`- name: ${escapedName}\\n([\\s\\S]*?)(?=\\n\\s*- name:|$)`));
  assert.ok(match, `missing step block: ${stepName}`);
  return match[0];
}

test("ws preview deploy workflow keeps the preview-only manual contract", () => {
  const text = workflowText();
  const validateSection = text.split(/^  deploy:\n/m)[0];
  const deploySection = text.split(/^  deploy:\n/m)[1] ?? "";

  assert.match(text, /^name: WS Preview Deploy/m);
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /^\s+push:/m);
  assert.doesNotMatch(text, /^\s+pull_request:/m);

  assert.match(text, /inputs:\n\s+ref:\n\s+description: Git ref to deploy to the preview WS host\n\s+required: true\n\s+type: string/);
  assert.match(text, /ref: \$\{\{ inputs\.ref \}\}/);

  assert.match(text, /WS_PREVIEW_HOST/);
  assert.match(text, /WS_PREVIEW_USER/);
  assert.match(text, /WS_PREVIEW_SSH_KEY/);

  assert.match(text, /ws-preview\.kcswh\.pl/);
  assert.match(text, /\/opt\/arcade-ws-preview/);
  assert.match(text, /\/opt\/arcade-ws-preview\/ws-server/);
  assert.match(text, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /http:\/\/127\.0\.0\.1:3001\/healthz/);
  assert.match(text, /https:\/\/ws-preview\.kcswh\.pl\/healthz/);
  assert.match(text, /node --test ws-tests\/ws-preview-deploy\.workflow\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-preview-deploy\.remote-shape\.guard\.test\.mjs/);

  assert.doesNotMatch(deploySection, /ws\.kcswh\.pl/);
  assert.doesNotMatch(deploySection, /\/opt\/ws-server/);
  assert.doesNotMatch(deploySection, /\/etc\/arcadeplatform\/ws-preview\.env/);
  assert.doesNotMatch(deploySection, /ws-server\.service/);
  assert.doesNotMatch(deploySection, /\/opt\/arcade-ws-preview\/releases/);
  assert.doesNotMatch(deploySection, /ln -sfn/);
  assert.doesNotMatch(deploySection, /readlink -f/);
  assert.doesNotMatch(deploySection, /PREVIOUS_TARGET/);
  assert.doesNotMatch(validateSection, /PREVIEW_RELEASES_DIR/);
});

test("ws preview deploy validates workflow files from workflow ref and builds app from inputs.ref", () => {
  const text = workflowText();
  const validateSection = text.split(/^  deploy:\n/m)[0];
  const deploySection = text.split(/^  deploy:\n/m)[1] ?? "";

  const validateCheckout = stepBlock(validateSection, "Checkout workflow ref");
  const deployCheckout = stepBlock(deploySection, "Checkout deploy target ref");

  assert.doesNotMatch(validateCheckout, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(deployCheckout, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(validateSection, /node --test ws-tests\/ws-preview-deploy\.workflow\.guard\.test\.mjs/);
  assert.match(validateSection, /node --test ws-tests\/ws-preview-deploy\.remote-shape\.guard\.test\.mjs/);
  assert.doesNotMatch(validateSection, /Validate preview-only workflow contract literals/);
});


test("ws preview deploy workflow keeps preview runtime contract and does not manage Caddy", () => {
  const text = workflowText();

  assert.match(text, /ws-preview\.kcswh\.pl/);
  assert.match(text, /\/opt\/arcade-ws-preview\/ws-server/);
  assert.match(text, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /http:\/\/127\.0\.0\.1:3001\/healthz/);
  assert.doesNotMatch(text, /\/etc\/caddy\/Caddyfile/);
  assert.doesNotMatch(text, /infra\/vps\/Caddyfile/);
  assert.doesNotMatch(text, /Caddyfile\.preview\.example/);
});

test("ws preview deploy workflow packages and validates shared runtime files", () => {
  const text = workflowText();

  assert.match(text, /PREVIEW_STAGE_WS_DIR:/);
  assert.match(text, /mkdir -p "\$PREVIEW_STAGE_WS_DIR"/);
  assert.match(text, /cp -R shared "\$PREVIEW_STAGE_DIR"\/shared/);
  assert.match(text, /sudo -n test -f "\$TMP_EXTRACT_DIR\/shared\/poker-domain\/join\.mjs"/);
  assert.match(text, /sudo -n test -f "\$TMP_EXTRACT_DIR\/ws-server\/server\.mjs"/);
  assert.match(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR\/ws-server\/" "\$PREVIEW_APP_DIR"\//);
  assert.match(text, /sudo -n mkdir -p "\$PREVIEW_BASE_DIR\/shared"/);
  assert.match(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR\/shared\/" "\$PREVIEW_BASE_DIR\/shared"\//);
  assert.doesNotMatch(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR"\/ "\$PREVIEW_BASE_DIR"\//);
});

test("poker deployment doc states the unified preview Caddy ownership model", () => {
  const text = fs.readFileSync("docs/poker-deployment.md", "utf8");

  assert.match(text, /manual-only/i);
  assert.match(text, /does not manage Caddy/i);
  assert.match(text, /infra\/vps\/Caddyfile` is the single source of truth for both production and preview WS routing/i);
  assert.match(text, /ws-preview\.kcswh\.pl/);
  assert.match(text, /\/opt\/arcade-ws-preview\/ws-server/);
  assert.match(text, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(text, /ws-server-preview\.service/);
  assert.match(text, /http:\/\/127\.0\.0\.1:3001\/healthz/);
  assert.doesNotMatch(text, /Caddyfile\.preview\.example/);
});
