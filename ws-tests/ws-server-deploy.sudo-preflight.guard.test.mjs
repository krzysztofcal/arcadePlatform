import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";

test("ws-server deploy workflow keeps only the exact production restart privileged", () => {
  const text = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");

  assert.doesNotMatch(text, /sudo -n true/);
  assert.match(text, /systemctl cat ws-server\.service/);
  assert.match(text, /sudo -n \/usr\/local\/sbin\/arcade-ws-production-env-preflight/);
  assert.match(text, /sudo -n \/usr\/bin\/systemctl restart ws-server\.service/);
  assert.doesNotMatch(text, /sudo -n (?:cat|test|rm|mkdir|tar|ln|mv|node|bash|rsync)\b/);
  assert.doesNotMatch(text, /sudo -n systemctl cat/);
});

test("ws-server deploy gates the release switch and the automatic rollback on the restart gate", () => {
  const text = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
  const script = text.slice(text.indexOf("- name: Atomic release switch + restart + health gate on VPS"));
  const lockIdx = script.indexOf("flock -w 300 9");
  const gateIdx = script.indexOf('RESTART_GATE="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate || true)"');
  const switchIdx = script.indexOf('ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"');
  assert.ok(lockIdx !== -1 && lockIdx < gateIdx && gateIdx < switchIdx, "gate runs under the lock, before the switch");
  assert.match(script.slice(gateIdx, switchIdx), /!= RESTART_SAFE\*[\s\S]*STOP: restart gate is not safe; nothing switched[\s\S]*exit 1/);

  const rollback = script.slice(script.indexOf("rollback() {"), script.indexOf("on_error() {"));
  const rollbackGateIdx = rollback.indexOf('ROLLBACK_GATE="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate || true)"');
  assert.ok(rollbackGateIdx !== -1 && rollbackGateIdx < rollback.indexOf('ln -sfn "$PREVIOUS_TARGET"'));
  assert.match(rollback, /ROLLBACK_BLOCKED: restart gate is not safe[\s\S]*return 0/);
  assert.match(fs.readFileSync("infra/vps/arcade-deploy.sudoers", "utf8"), /\/usr\/local\/sbin\/arcade-ws-restart-gate ""/);
  assert.match(fs.readFileSync("infra/vps/bootstrap.sh", "utf8"), /ws-restart-gate\.mjs" \\\n  \/usr\/local\/sbin\/arcade-ws-restart-gate/);
});

test("restart gate is fail-closed for every unverifiable runtime state", async () => {
  const { evaluateRestartGate, readInternalToken } = await import("../infra/vps/ws-restart-gate.mjs");
  const ready = {
    active: true, drain: true, loadedHandsInProgress: 0, tableCommandsInFlight: 0, stateWritesInFlight: 0,
    supervisorSweepInProgress: false, dbHandsInProgress: 0, dbVersionMismatches: 0,
    dbFinancialIssues: { missingState: 0, missingEscrow: 0, invalidAmounts: 0, balanceMismatches: 0, unresolvedRequests: 0 },
    restartSafe: true
  };
  assert.deepEqual(evaluateRestartGate({ serviceState: "active", holdStatus: ready }), { safe: true, line: "RESTART_SAFE" });
  assert.equal(evaluateRestartGate({ serviceState: "inactive", holdStatus: null }).safe, true);
  for (const serviceState of ["activating", "deactivating", "unknown"]) {
    assert.equal(evaluateRestartGate({ serviceState, holdStatus: ready }).safe, false, serviceState);
  }
  assert.equal(evaluateRestartGate({ serviceState: "active", holdStatus: undefined }).line, "RESTART_BLOCKED runtime_without_restart_preflight");
  const blocked = (holdStatus) => evaluateRestartGate({ serviceState: "active", holdStatus });
  assert.equal(blocked({ ...ready, restartSafe: false }).safe, false);
  assert.equal(blocked({ ...ready, drain: false }).line, "RESTART_BLOCKED drain_inactive");
  assert.equal(blocked({ ...ready, dbHandsInProgress: null }).line, "RESTART_BLOCKED dbHandsInProgress=unknown");
  assert.equal(blocked({ ...ready, dbFinancialIssues: null }).line, "RESTART_BLOCKED financial_unverified");
  assert.equal(blocked({ ...ready, dbFinancialIssues: { ...ready.dbFinancialIssues, missingEscrow: 2 } }).line, "RESTART_BLOCKED missingEscrow=2");

  const dir = fs.mkdtempSync(`${os.tmpdir()}/ws-restart-gate-`);
  const envFile = `${dir}/ws-server.env`;
  fs.writeFileSync(envFile, "SUPABASE_URL=x\nPOKER_WS_INTERNAL_TOKEN=\"gate-token\"\n", { mode: 0o600 });
  assert.equal(readInternalToken(envFile, { allowTestUid: true }), "gate-token");
  fs.chmodSync(envFile, 0o644);
  assert.throws(() => readInternalToken(envFile, { allowTestUid: true }), /env_file_untrusted/);
});
