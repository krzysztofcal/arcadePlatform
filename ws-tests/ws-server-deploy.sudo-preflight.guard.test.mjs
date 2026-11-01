import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";

test("ws-server deploy workflow keeps only the exact production restart privileged", () => {
  const text = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");

  assert.doesNotMatch(text, /sudo -n true/);
  assert.match(text, /systemctl cat ws-server\.service/);
  assert.match(text, /sudo -n \/usr\/local\/sbin\/arcade-ws-production-env-preflight/);
  assert.doesNotMatch(text, /systemctl restart ws-server\.service/);
  assert.match(text, /sudo -n \/usr\/local\/sbin\/arcade-ws-restart-gate restart/);
  assert.doesNotMatch(text, /sudo -n (?:cat|test|rm|mkdir|tar|ln|mv|node|bash|rsync)\b/);
  assert.doesNotMatch(text, /sudo -n systemctl cat/);
});

test("ws-server deploy gates the release switch and the automatic rollback on the restart gate", () => {
  const text = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
  const script = text.slice(text.indexOf("- name: Atomic release switch + restart + health gate on VPS"));
  const lockIdx = script.indexOf("flock -w 300 9");
  const gateIdx = script.indexOf('RESTART_GATE="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate check || true)"');
  const switchIdx = script.indexOf('ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"');
  const restartIdx = script.indexOf('RESTART_RESULT="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate restart || true)"');
  assert.ok(lockIdx !== -1 && lockIdx < gateIdx && gateIdx < switchIdx && switchIdx < restartIdx, "check under the lock, switch, then gated restart");
  assert.match(script.slice(gateIdx, switchIdx), /!= RESTART_SAFE\*[\s\S]*STOP: restart gate is not safe; nothing switched[\s\S]*exit 1/);
  assert.match(script.slice(restartIdx), /!= RESTARTED\*[\s\S]*STOP: gated restart refused or failed[\s\S]*false\n\s*fi\n\s*HAVE_RESTARTED=1/);

  const rollback = script.slice(script.indexOf("rollback() {"), script.indexOf("on_error() {"));
  assert.match(rollback, /if \[ "\$HAVE_RESTARTED" != "1" \]; then[\s\S]*release link restored; no restart was performed"\n\s*return 0/);
  const rollbackRestartIdx = rollback.indexOf('ROLLBACK_RESULT="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate restart || true)"');
  assert.ok(rollbackRestartIdx !== -1);
  assert.match(rollback.slice(rollbackRestartIdx), /!= RESTARTED\*[\s\S]*ln -sfn -- "\$NEW_RELEASE_APP_DIR"[\s\S]*ROLLBACK_BLOCKED: restart gate is not safe/);
  assert.doesNotMatch(text, /sudo -n \/usr\/bin\/systemctl restart ws-server\.service/);
  const sudoers = fs.readFileSync("infra/vps/arcade-deploy.sudoers", "utf8");
  assert.match(sudoers, /\/usr\/local\/sbin\/arcade-ws-restart-gate check, \\\n\s+\/usr\/local\/sbin\/arcade-ws-restart-gate restart\n/);
  assert.doesNotMatch(sudoers, /restart ws-server\.service/);
  assert.match(fs.readFileSync("infra/vps/bootstrap.sh", "utf8"), /ws-restart-gate\.mjs" \\\n  \/usr\/local\/sbin\/arcade-ws-restart-gate\ninstall -d -o root -g root -m 0755 \/etc\/arcadeplatform\/ws-hold\n/);
  // Minimal root staging on an existing host: validate before install, never touch services.
  const stage = fs.readFileSync("infra/vps/stage-ws-restart-gate.sh", "utf8");
  assert.match(stage, /\[\[ "\$EUID" -ne 0 \]\]/);
  assert.ok(stage.indexOf('visudo -cf "$SUDOERS_SRC"') < stage.indexOf('install -o root -g root -m 0440 "$SUDOERS_SRC"'));
  assert.match(stage, /install -d -o root -g root -m 0755 "\$HOLD_DIR"/);
  assert.match(stage, /HOLD_DIR="\/etc\/arcadeplatform\/ws-hold"/);
  assert.doesNotMatch(stage, /systemctl (?:restart|reload|stop|start)/);
});

test("restart gate is fail-closed for every unverifiable runtime state", async () => {
  const { evaluateRestartGate, holdPathIssue, readSafeStopEvidence, parseDbQuiet, readEnvValues } = await import("../infra/vps/ws-restart-gate.mjs");
  const ready = {
    active: true, drain: true, loadedHandsInProgress: 0, tableCommandsInFlight: 0, stateWritesInFlight: 0,
    supervisorSweepInProgress: false, dbHandsInProgress: 0, dbVersionMismatches: 0,
    dbFinancialIssues: { missingState: 0, missingEscrow: 0, invalidAmounts: 0, balanceMismatches: 0, unresolvedRequests: 0 },
    restartSafe: true
  };
  const running = (holdStatus, httpStatus = 200) => evaluateRestartGate({ serviceState: "active", httpStatus, holdStatus });
  assert.deepEqual(running(ready), { safe: true, line: "RESTART_SAFE" });
  for (const httpStatus of [503, 401, 500, null]) assert.equal(running(ready, httpStatus).safe, false, String(httpStatus));
  for (const serviceState of ["activating", "deactivating", "unknown"]) {
    assert.equal(evaluateRestartGate({ serviceState, httpStatus: 200, holdStatus: ready }).safe, false, serviceState);
  }
  assert.equal(running(undefined).line, "RESTART_BLOCKED runtime_without_restart_preflight");
  assert.equal(running({ ...ready, restartSafe: false }).safe, false);
  assert.equal(running({ ...ready, drain: false }).line, "RESTART_BLOCKED drain_inactive");
  assert.equal(running({ ...ready, dbHandsInProgress: null }).line, "RESTART_BLOCKED dbHandsInProgress=unknown");
  assert.equal(running({ ...ready, dbFinancialIssues: null }).line, "RESTART_BLOCKED financial_unverified");
  assert.equal(evaluateRestartGate({ serviceState: "active", holdPathIssue: "unprotected", httpStatus: 200, holdStatus: ready }).line, "RESTART_BLOCKED hold_path_unprotected");

  // A stopped service never passes on its state alone.
  const quiet = parseDbQuiet("0|0|0|0|0|0\n");
  const evidence = { valid: true };
  for (const serviceState of ["inactive", "failed"]) {
    assert.equal(evaluateRestartGate({ serviceState, safeStop: { valid: false }, dbQuiet: quiet }).line, `RESTART_BLOCKED service_${serviceState}_without_safe_stop_evidence`);
    assert.equal(evaluateRestartGate({ serviceState, safeStop: evidence, dbQuiet: null }).line, "RESTART_BLOCKED db_unverified");
    assert.deepEqual(evaluateRestartGate({ serviceState, safeStop: evidence, dbQuiet: quiet }), { safe: true, line: "RESTART_SAFE safe_stop_evidence", usesSafeStop: true });
  }
  assert.equal(evaluateRestartGate({ serviceState: "failed", safeStop: evidence, dbQuiet: parseDbQuiet("1|0|0|0|2|0") }).line, "RESTART_BLOCKED handsInProgress=1,balanceMismatches=2");
  for (const output of ["", "0|0|0|0|0", "0|0|0|0|0|x", "error"]) assert.equal(parseDbQuiet(output), null, output);

  // Hold file and evidence must sit in a directory chain the deploy account cannot change.
  const uid = process.getuid();
  const boundary = fs.mkdtempSync(`${os.tmpdir()}/ws-restart-gate-`);
  fs.mkdirSync(`${boundary}/ws-hold`, { mode: 0o755 });
  fs.chmodSync(`${boundary}/ws-hold`, 0o755);
  fs.chmodSync(boundary, 0o755);
  const holdFile = `${boundary}/ws-hold/new-hands`;
  assert.equal(holdPathIssue(holdFile, { expectedUid: uid, boundary }), null);
  fs.writeFileSync(holdFile, "drain\n", { mode: 0o644 });
  assert.equal(holdPathIssue(holdFile, { expectedUid: uid, boundary }), null);
  fs.chmodSync(holdFile, 0o664);
  assert.equal(holdPathIssue(holdFile, { expectedUid: uid, boundary }), "unprotected");
  fs.chmodSync(holdFile, 0o644);
  fs.chmodSync(`${boundary}/ws-hold`, 0o775);
  assert.equal(holdPathIssue(holdFile, { expectedUid: uid, boundary }), "unprotected");
  fs.chmodSync(`${boundary}/ws-hold`, 0o755);
  assert.equal(holdPathIssue(holdFile, { expectedUid: uid + 1, boundary }), "unprotected");
  assert.equal(holdPathIssue(`${boundary}/missing/new-hands`, { expectedUid: uid, boundary }), "unprotected");
  assert.equal(holdPathIssue("relative/new-hands", { expectedUid: uid, boundary }), "unset");
  assert.equal(holdPathIssue("/opt/ws-server/hold-new-hands"), "unprotected");

  const nowMs = Date.parse("2026-11-01T12:00:00Z");
  assert.equal(readSafeStopEvidence(holdFile, { expectedUid: uid, nowMs }).valid, false);
  fs.writeFileSync(`${boundary}/ws-hold/safe-stop`, "safe-stop 2026-11-01T11:30:00Z\n", { mode: 0o600 });
  assert.equal(readSafeStopEvidence(holdFile, { expectedUid: uid, nowMs }).valid, true);
  assert.equal(readSafeStopEvidence(holdFile, { expectedUid: uid, nowMs: nowMs + 3 * 60 * 60 * 1000 }).valid, false);
  fs.chmodSync(`${boundary}/ws-hold/safe-stop`, 0o666);
  assert.equal(readSafeStopEvidence(holdFile, { expectedUid: uid, nowMs }).valid, false);

  const envFile = `${boundary}/ws-server.env`;
  fs.writeFileSync(envFile, "SUPABASE_URL=x\nPOKER_WS_INTERNAL_TOKEN=\"gate-token\"\n", { mode: 0o600 });
  assert.equal(readEnvValues(envFile, { allowTestUid: true }).POKER_WS_INTERNAL_TOKEN, "gate-token");
  fs.chmodSync(envFile, 0o644);
  assert.throws(() => readEnvValues(envFile, { allowTestUid: true }), /env_file_untrusted/);
});
