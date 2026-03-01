import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("infra VPS smoke check structure keeps rollback-safe ordering", () => {
  const text = workflowText();

  const appliedIndex = text.indexOf("APPLIED=1");
  const reloadIndex = text.indexOf("sudo -n systemctl reload caddy", appliedIndex);
  const healthzIndex = text.indexOf("HEALTHZ_BODY=", reloadIndex);
  const nodeSmokeIndex = text.indexOf("timeout 12s node <<'NODE'", healthzIndex);
  const trapClearIndex = text.indexOf("trap - ERR", nodeSmokeIndex);

  assert.notEqual(appliedIndex, -1);
  assert.notEqual(reloadIndex, -1);
  assert.notEqual(healthzIndex, -1);
  assert.notEqual(nodeSmokeIndex, -1);
  assert.notEqual(trapClearIndex, -1);

  assert.equal(appliedIndex < reloadIndex, true);
  assert.equal(reloadIndex < healthzIndex, true);
  assert.equal(healthzIndex < nodeSmokeIndex, true);
  assert.equal(nodeSmokeIndex < trapClearIndex, true);
});

test("infra VPS smoke checks are standalone commands and trap remains active", () => {
  const text = workflowText();

  assert.ok(text.includes("trap 'on_error' ERR"));
  assert.ok(text.includes("rollback()"));
  assert.ok(text.includes("HEALTHZ_BODY=\"$(curl -fsS https://ws.kcswh.pl/healthz"));
  assert.ok(text.includes("timeout 12s node <<'NODE'"));
  assert.ok(text.includes("curl -sS -o /dev/null -D - --http1.1 https://ws.kcswh.pl/ws"));
  assert.equal(text.includes("WS_RESPONSE=\"$("), false);
});
