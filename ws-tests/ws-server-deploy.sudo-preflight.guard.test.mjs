import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  assert.match(script.slice(restartIdx), /== RESTART_BLOCKED\*[\s\S]*!= RESTARTED\*[\s\S]*HAVE_RESTARTED=uncertain[\s\S]*false\n\s*fi\n\s*HAVE_RESTARTED=1/);

  const rollback = script.slice(script.indexOf("rollback() {"), script.indexOf("on_error() {"));
  assert.match(rollback, /if \[ "\$HAVE_RESTARTED" != "1" \]; then[\s\S]*release link restored; no restart was performed"\n\s*return 0/);
  const rollbackRestartIdx = rollback.indexOf('ROLLBACK_RESULT="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate restart || true)"');
  assert.ok(rollbackRestartIdx !== -1);
  assert.match(rollback.slice(rollbackRestartIdx), /== RESTART_BLOCKED\*[\s\S]*ln -sfn -- "\$NEW_RELEASE_APP_DIR"[\s\S]*ROLLBACK_BLOCKED: restart gate is not safe[\s\S]*RESTART_UNCERTAIN/);
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
  const refuseEnvIdx = stage.indexOf("grep -q '^WS_POKER_NEW_HANDS_HOLD_FILE=' \"$PROD_ENV\"");
  const dropInIdx = stage.indexOf('install -D -o root -g root -m 0644 "$DROPIN_SRC" "$DROPIN_DEST"');
  assert.ok(refuseEnvIdx !== -1 && refuseEnvIdx < dropInIdx && dropInIdx < stage.indexOf("systemctl daemon-reload"));
  assert.match(stage, /systemctl show ws-server\.service -p Environment --value/);
  assert.doesNotMatch(stage, />>?\s*"?\$PROD_ENV/);
  assert.match(fs.readFileSync("infra/vps/bootstrap.sh", "utf8"), /ws-server\.service\.d\/50-new-hands-hold\.conf" \/etc\/systemd\/system\/ws-server\.service\.d\/50-new-hands-hold\.conf/);
  assert.doesNotMatch(stage, /systemctl (?:restart|reload|stop|start)/);
});

test("restart gate is fail-closed for every unverifiable runtime state", async () => {
  const { evaluateRestartGate, holdPathIssue, unitHoldIssue, HOLD_FILE, readSafeStopEvidence, readHoldDrain, parseDbQuiet, parsePresence, readEnvValues } = await import("../infra/vps/ws-restart-gate.mjs");
  const ready = {
    active: true, drain: true, loadedHandsInProgress: 0, tableCommandsInFlight: 0, stateWritesInFlight: 0,
    supervisorSweepInProgress: false, dbHandsInProgress: 0, dbVersionMismatches: 0,
    dbFinancialIssues: { missingState: 0, missingEscrow: 0, invalidAmounts: 0, balanceMismatches: 0, unresolvedRequests: 0 },
    restartSafe: true
  };
  const nobody = parsePresence("0|0\n");
  const running = (holdStatus, httpStatus = 200, presence = nobody) => evaluateRestartGate({ serviceState: "active", httpStatus, holdStatus, presence });
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
  // Seated humans and escrow left on CLOSED tables block both paths; an unreadable count blocks too.
  assert.equal(running(ready, 200, parsePresence("1|0")).line, "RESTART_BLOCKED humanSeatsOpen=1");
  assert.equal(running(ready, 200, parsePresence("0|2")).line, "RESTART_BLOCKED closedWithEscrow=2");
  assert.equal(running(ready, 200, null).line, "RESTART_BLOCKED presence_unverified");
  for (const output of ["", "0", "0|x", "0|0|0"]) assert.equal(parsePresence(output), null, output);
  assert.equal(evaluateRestartGate({ serviceState: "active", holdPathIssue: "unprotected", httpStatus: 200, holdStatus: ready }).line, "RESTART_BLOCKED hold_path_unprotected");

  // The hold path comes only from the unit drop-in: exactly once, the protected value, never from the env file.
  const assignment = `WS_POKER_NEW_HANDS_HOLD_FILE=${HOLD_FILE}`;
  assert.equal(HOLD_FILE, "/etc/arcadeplatform/ws-hold/new-hands");
  assert.equal(unitHoldIssue(`NODE_ENV=production PORT=3000 ${assignment}\n`), null);
  assert.equal(unitHoldIssue("NODE_ENV=production PORT=3000\n"), "unset");
  assert.equal(unitHoldIssue(""), "unset");
  assert.equal(unitHoldIssue(`${assignment} ${assignment}`), "duplicate");
  assert.equal(unitHoldIssue("WS_POKER_NEW_HANDS_HOLD_FILE=/opt/ws-server/hold-new-hands"), "mismatch");
  assert.equal(unitHoldIssue(`X${assignment}`), "unset");
  assert.equal(unitHoldIssue(assignment, { WS_POKER_NEW_HANDS_HOLD_FILE: HOLD_FILE }), "conflict");
  for (const issue of ["unset", "duplicate", "mismatch", "conflict"]) {
    assert.equal(evaluateRestartGate({ serviceState: "active", holdPathIssue: issue, httpStatus: 200, holdStatus: ready }).line, `RESTART_BLOCKED hold_path_${issue}`);
  }

  // A stopped service never passes on its state alone.
  const quiet = parseDbQuiet("0|0|0|0|0|0\n");
  const evidence = { valid: true };
  for (const serviceState of ["inactive", "failed"]) {
    assert.equal(evaluateRestartGate({ serviceState, safeStop: { valid: false }, holdDrain: true, dbQuiet: quiet }).line, `RESTART_BLOCKED service_${serviceState}_without_safe_stop_evidence`);
    assert.equal(evaluateRestartGate({ serviceState, safeStop: evidence, holdDrain: false, dbQuiet: quiet }).line, "RESTART_BLOCKED hold_file_not_drain");
    assert.equal(evaluateRestartGate({ serviceState, safeStop: evidence, holdDrain: true, dbQuiet: null }).line, "RESTART_BLOCKED db_unverified");
    assert.deepEqual(evaluateRestartGate({ serviceState, safeStop: evidence, holdDrain: true, dbQuiet: quiet, presence: nobody }), { safe: true, line: "RESTART_SAFE safe_stop_evidence", usesSafeStop: true });
    assert.equal(evaluateRestartGate({ serviceState, safeStop: evidence, holdDrain: true, dbQuiet: quiet }).line, "RESTART_BLOCKED presence_unverified");
  }
  assert.equal(evaluateRestartGate({ serviceState: "failed", safeStop: evidence, holdDrain: true, dbQuiet: parseDbQuiet("1|0|0|0|2|0"), presence: parsePresence("1|0") }).line, "RESTART_BLOCKED handsInProgress=1,balanceMismatches=2,humanSeatsOpen=1");
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

  // A stopped service restarts only into drain: the protected hold file must say exactly "drain".
  assert.equal(readHoldDrain(holdFile, { expectedUid: uid }), true);
  for (const content of ["", "drain now\n", " drain", "hold\n", "drain\n\n"]) {
    fs.writeFileSync(holdFile, content);
    assert.equal(readHoldDrain(holdFile, { expectedUid: uid }), false, JSON.stringify(content));
  }
  fs.writeFileSync(holdFile, "drain");
  assert.equal(readHoldDrain(holdFile, { expectedUid: uid }), true);
  fs.chmodSync(holdFile, 0o666);
  assert.equal(readHoldDrain(holdFile, { expectedUid: uid }), false);
  fs.chmodSync(holdFile, 0o644);
  assert.equal(readHoldDrain(`${boundary}/ws-hold/absent`, { expectedUid: uid }), false);
  fs.writeFileSync(holdFile, "drain\n");

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

test("an uncertain gated restart stops without touching the release link, a refused one only restores it", async () => {
  const { spawnSync } = await import("node:child_process");
  const text = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
  const script = text.slice(text.indexOf("- name: Atomic release switch + restart + health gate on VPS"));
  const rollback = script.slice(script.indexOf("rollback() {"), script.indexOf("on_error() {"));
  const restartStart = script.indexOf('RESTART_RESULT="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate restart || true)"');
  const restart = script.slice(restartStart, script.indexOf("HAVE_RESTARTED=1", restartStart) + "HAVE_RESTARTED=1".length);
  const run = (fakeResult) => {
    const calls = `${fs.mkdtempSync(`${os.tmpdir()}/ws-gated-restart-`)}/calls`;
    const harness = [
      "set -Eeuo pipefail",
      `ln() { echo "ln $*" >> "${calls}"; }`,
      `mv() { echo "mv $*" >> "${calls}"; }`,
      `node() { return 0; }`,
      `sudo() { echo "sudo $*" >> "${calls}"; printf '%s\\n' "$FAKE_RESULT"; return 1; }`,
      "HAVE_SWITCHED=1; HAVE_RESTARTED=0; PREVIOUS_TARGET=/releases/prev/ws-server; NEW_RELEASE_APP_DIR=/releases/new/ws-server; CURRENT_LINK=/opt/current",
      rollback,
      'on_error() { rc=$?; rollback; exit "$rc"; }',
      "trap 'on_error' ERR",
      restart,
      "echo reached_health_gate"
    ].join("\n");
    const result = spawnSync("bash", ["-c", harness], { env: { PATH: process.env.PATH, FAKE_RESULT: fakeResult }, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [] };
  };

  for (const fakeResult of ["RESTART_FAILED systemctl", "", "garbage"]) {
    const uncertain = run(fakeResult);
    assert.notEqual(uncertain.status, 0, fakeResult);
    assert.match(uncertain.stdout, /STOP: restart outcome uncertain; no automatic rollback[\s\S]*RESTART_UNCERTAIN/);
    assert.deepEqual(uncertain.calls, ["sudo -n /usr/local/sbin/arcade-ws-restart-gate restart"], "no link change and no second restart");
  }

  const refused = run("RESTART_BLOCKED http_503");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout, /STOP: gate refused before restart[\s\S]*release link restored; no restart was performed/);
  assert.deepEqual(refused.calls, [
    "sudo -n /usr/local/sbin/arcade-ws-restart-gate restart",
    "ln -sfn /releases/prev/ws-server /opt/current.tmp",
    "mv -Tf /opt/current.tmp /opt/current"
  ]);
  assert.doesNotMatch(refused.stdout + run("RESTART_FAILED systemctl").stdout, /reached_health_gate/);
});

test("root staging accepts a symlinked psql only when it resolves to a root-owned, non-writable executable", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const stage = fs.readFileSync("infra/vps/stage-ws-restart-gate.sh", "utf8");
  // The other prerequisites keep refusing any symlink; psql is checked before anything is installed.
  assert.match(stage, /for required in "\$HELPER_SRC" "\$SUDOERS_SRC" "\$DROPIN_SRC" \/usr\/bin\/node "\$PROD_ENV"; do\n\s+if \[\[ ! -e "\$required" \|\| -L "\$required" \]\]; then/);
  const psqlCheckIdx = stage.indexOf("if ! trusted_root_executable /usr/bin/psql; then");
  assert.ok(psqlCheckIdx !== -1 && psqlCheckIdx < stage.indexOf("install -D -o root -g root -m 0755"));
  const fn = stage.match(/trusted_root_executable\(\) \{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn);
  const trusted = (candidate) => spawnSync("bash", ["-c", `set -Eeuo pipefail\n${fn}trusted_root_executable "$1"`, "check", candidate]).status === 0;

  const dir = fs.mkdtempSync(`${os.tmpdir()}/ws-stage-psql-`);
  fs.symlinkSync(`${dir}/missing`, `${dir}/dangling`);
  fs.writeFileSync(`${dir}/writable`, "#!/bin/sh\n");
  fs.chmodSync(`${dir}/writable`, 0o777);
  fs.symlinkSync(`${dir}/writable`, `${dir}/psql`);
  assert.equal(trusted(`${dir}/dangling`), false);
  assert.equal(trusted(`${dir}/psql`), false, "world-writable target");
  fs.symlinkSync("/usr/bin/env", `${dir}/link-to-env`);
  if (process.getuid() !== 0) assert.equal(trusted(`${dir}/link-to-env`), false, "link in a non-root directory");

  // Real system symlinks: the shell check must agree with an independent reading of the same rule.
  const describe = (candidate) => {
    const target = fs.realpathSync(candidate);
    const entries = [fs.realpathSync(path.dirname(candidate)), target, path.dirname(target)].map((entry) => {
      const st = fs.statSync(entry);
      return { entry, uid: st.uid, gid: st.gid, mode: (st.mode & 0o7777).toString(8), ok: st.uid === 0 && st.gid === 0 && (st.mode & 0o022) === 0 };
    });
    const st = fs.statSync(target);
    return { expected: st.isFile() && (st.mode & 0o111) !== 0 && entries.every((entry) => entry.ok), entries };
  };
  const systemLinks = ["/usr/bin/psql", "/bin/sh", "/usr/bin/awk"].filter((candidate) => {
    try { return fs.lstatSync(candidate).isSymbolicLink() && fs.existsSync(candidate); } catch { return false; }
  });
  for (const candidate of systemLinks) {
    const { expected, entries } = describe(candidate);
    assert.equal(trusted(candidate), expected, `${candidate}: ${JSON.stringify(entries)}`);
  }
  if (!systemLinks.some((candidate) => describe(candidate).expected)) t.skip("no root-owned system symlink available");
});

test("restart gate runbook commands parse and keep the first-deployment safety rules", async () => {
  const { spawnSync } = await import("node:child_process");
  const doc = fs.readFileSync("docs/ws-production-restart-gate.md", "utf8");
  const commands = [...doc.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
    .filter((span) => /^(T4_DIR=|git |ls |grep |diff |install |bash |stat |systemctl |cp |iptables |curl |ss |umask |P=|tar |test |rm |sudo |cmp |printf |ln |readlink |visudo |id )/.test(span));
  assert.ok(commands.length >= 40);
  for (const command of commands) {
    const parsed = spawnSync("bash", ["-n", "-c", command.replaceAll("<SHA>", "sha").replaceAll("<PREV_SHA>", "prev")], { encoding: "utf8" });
    assert.equal(parsed.status, 0, `${command}\n${parsed.stderr}`);
  }
  // The operator queries run inside one single-quoted node script, so they must not contain a single quote.
  for (const command of commands.filter((span) => span.startsWith("T4_DIR="))) {
    assert.doesNotMatch(command.slice(command.indexOf(" -e '") + 5, -1), /'/);
  }
  assert.match(doc, /Returning to the previous release is covered by this runbook only before C6\.1/);
  assert.match(doc, /iptables -S INPUT \| grep -n t4-ws-block-new/);
  const beforeStop = doc.slice(doc.indexOf("4. Immediately before the stop"), doc.indexOf("5. `systemctl stop ws-server.service"));
  assert.match(beforeStop, /C-M1 position and effect again/);
  const recovery = doc.slice(doc.indexOf("**C7. Recovery (root)**"));
  // Restoring the old release starts WS only when the link points exactly to it; a rollback is proven by the running process.
  assert.match(recovery, /test "\$\(readlink -f \/opt\/ws-server\/current\)" = \/opt\/ws-server\/releases\/<PREV_SHA>\/ws-server && systemctl reset-failed ws-server\.service && systemctl start ws-server\.service/);
  assert.match(recovery, /readlink -f \/proc\/\$\(systemctl show ws-server\.service -p MainPID --value\)\/cwd/);
  // The manual rollback restarts only after the release check and the link switch succeeded.
  assert.match(recovery, /test -f \/opt\/ws-server\/releases\/<PREV_SHA>\/ws-server\/server\.mjs && ln -sfn [^`]* && systemctl reset-failed ws-server\.service && systemctl restart ws-server\.service/);
  assert.doesNotMatch(recovery, /; systemctl restart ws-server\.service/);
});

test("release runs own their hold: prepare refuses foreign holds and fails fast, resume/abort only release their own", async () => {
  const { prepare, prepareStep, resume, abort, readOperation } = await import("../infra/vps/ws-restart-gate.mjs");
  const gate = (line) => (line === "RESTART_SAFE" ? { safe: true, line } : { safe: false, line: `RESTART_BLOCKED ${line}` });
  // Wait only for running hands (one pot per hand) and transient work; any integrity reason stops at once.
  assert.equal(prepareStep("hold", gate("drain_inactive,loadedHandsInProgress=2,dbHandsInProgress=2,invalidAmounts=2,restart_not_safe")), "wait");
  assert.equal(prepareStep("hold", gate("drain_inactive,tableCommandsInFlight=1,restart_not_safe")), "drain");
  for (const line of [
    "drain_inactive,loadedHandsInProgress=1,dbHandsInProgress=1,invalidAmounts=2", "drain_inactive,invalidAmounts=1",
    "drain_inactive,loadedHandsInProgress=1,balanceMismatches=1", "drain_inactive,loadedHandsInProgress=1,unresolvedRequests=1",
    "drain_inactive,loadedHandsInProgress=1,dbVersionMismatches=1", "drain_inactive,loadedHandsInProgress=1,missingEscrow=1",
    "drain_inactive,loadedHandsInProgress=1,humanSeatsOpen=1", "closedWithEscrow=1", "dbHandsInProgress=unknown,financial_unverified",
    "http_503", "presence_unverified", "gate_error"
  ]) assert.equal(prepareStep("hold", gate(line)), "stop", line);
  assert.equal(prepareStep("drain", gate("RESTART_SAFE")), "ready");
  assert.equal(prepareStep("drain", gate("tableCommandsInFlight=1,restart_not_safe")), "wait");
  for (const line of ["loadedHandsInProgress=1,restart_not_safe", "invalidAmounts=1,restart_not_safe", "unresolvedRequests=1", "dbVersionMismatches=1", "drain_inactive"]) {
    assert.equal(prepareStep("drain", gate(line)), "stop", line);
  }

  const boundary = fs.mkdtempSync(`${os.tmpdir()}/ws-prepare-`);
  fs.chmodSync(boundary, 0o755);
  fs.mkdirSync(`${boundary}/ws-hold`, { mode: 0o755 });
  fs.chmodSync(`${boundary}/ws-hold`, 0o755);
  const holdFile = `${boundary}/ws-hold/new-hands`;
  const marker = `${boundary}/ws-hold/release-op`;
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
  const reset = (hold = null, op = null) => {
    for (const [file, content] of [[holdFile, hold], [marker, op]]) {
      fs.rmSync(file, { force: true });
      if (content !== null) fs.writeFileSync(file, content, { mode: 0o644 });
    }
  };
  let now = 0;
  const host = (lines, extra = {}) => ({
    holdFile, holdPath: { expectedUid: process.getuid(), boundary }, holdMs: 30, drainMs: 20, pollMs: 10,
    nowMs: () => now, sleep: async (ms) => { now += ms; }, mainPid: () => "100",
    gate: async () => {
      const line = lines.length > 1 ? lines.shift() : lines[0];
      if (line instanceof Error) throw line;
      return gate(line);
    },
    ...extra
  });

  // Own hold: hold → drain → PREPARED, marker bound to the run and the prepared process.
  reset();
  assert.equal((await prepare("7", host(["drain_inactive,loadedHandsInProgress=1,dbHandsInProgress=1,invalidAmounts=1", "drain_inactive", "stateWritesInFlight=1", "RESTART_SAFE"]))).line, "PREPARED");
  assert.deepEqual([read(holdFile), readOperation(holdFile)], ["drain\n", { op: "7", pid: "100" }]);
  // A rerun of the same run continues while the prepared process still runs; another run or a changed process is refused untouched.
  assert.equal((await prepare("7", host(["RESTART_SAFE"]))).line, "PREPARED");
  assert.equal((await prepare("8", host(["RESTART_SAFE"]))).line, "RESTART_BLOCKED hold_owned_by_other_operation");
  assert.equal((await prepare("7", host(["RESTART_SAFE"], { mainPid: () => "101" }))).line, "RESTART_BLOCKED operation_process_changed");
  assert.deepEqual([read(holdFile), read(marker)], ["drain\n", "op=7 pid=100\n"]);

  // An operator hold (any content, no marker) is never taken over or removed.
  for (const content of ["", "drain\n"]) {
    reset(content);
    assert.equal((await prepare("7", host(["RESTART_SAFE"]))).line, "RESTART_BLOCKED hold_owned_by_operator");
    assert.deepEqual([read(holdFile), read(marker)], [content, null]);
    assert.equal((await resume("7", "a".repeat(40), host(["RESTART_SAFE"]))).line, "RESUME_BLOCKED not_owned");
    assert.equal((await abort("7", host(["RESTART_SAFE"]))).line, "ABORT_BLOCKED not_owned");
    assert.equal(read(holdFile), content);
  }

  // Integrity reasons fail fast; timeouts and gate errors also remove only this run's own hold.
  for (const [lines, line] of [
    [["drain_inactive,loadedHandsInProgress=1,balanceMismatches=1"], "RESTART_BLOCKED prepare_hold_stopped,drain_inactive,loadedHandsInProgress=1,balanceMismatches=1"],
    [["drain_inactive,loadedHandsInProgress=1"], "RESTART_BLOCKED prepare_hold_timeout,drain_inactive,loadedHandsInProgress=1"],
    [["drain_inactive", "tableCommandsInFlight=1"], "RESTART_BLOCKED prepare_drain_timeout,tableCommandsInFlight=1"],
    [[new Error("unreachable")], "RESTART_BLOCKED prepare_hold_stopped,gate_error"]
  ]) {
    reset();
    assert.equal((await prepare("7", host(lines))).line, line);
    assert.deepEqual([read(holdFile), read(marker)], [null, null], line);
  }
  reset();
  assert.equal((await prepare("7", host(["RESTART_SAFE"], { mainPid: () => null }))).line, "RESTART_BLOCKED service_not_running");
  assert.equal((await prepare("x7", host(["RESTART_SAFE"]))).line, "RESTART_BLOCKED unexpected_arguments");

  // Resume reopens only after a restart into exactly the approved release; otherwise the hold stays (C7).
  const sha = "b".repeat(40);
  const releaseDir = `/r/${sha}/ws-server`;
  const restarted = {
    releasesDir: "/r", mainPid: () => "200", serviceState: () => "active", runningDir: () => releaseDir, currentDir: () => releaseDir,
    releaseSha: () => sha, healthz: async () => "ok\n"
  };
  for (const [extra, reason] of [
    [{ mainPid: () => "100" }, "not_restarted"],
    [{ runningDir: () => "/r/old/ws-server", currentDir: () => "/r/old/ws-server" }, "release_not_running"],
    [{ currentDir: () => "/r/old/ws-server" }, "release_not_running"],
    [{ releaseSha: () => "c".repeat(40) }, "release_metadata_mismatch"],
    [{ healthz: async () => "" }, "healthz"],
    [{ serviceState: () => "failed" }, "service_failed"]
  ]) {
    reset("drain\n", "op=7 pid=100\n");
    assert.equal((await resume("7", sha, host(["RESTART_SAFE"], { ...restarted, ...extra }))).line, `RESUME_BLOCKED ${reason}`);
    assert.equal(read(holdFile), "drain\n", reason);
  }
  assert.equal((await resume("7", sha, host(["humanSeatsOpen=1"], restarted))).line, "RESUME_BLOCKED humanSeatsOpen=1");
  assert.equal((await resume("8", sha, host(["RESTART_SAFE"], restarted))).line, "RESUME_BLOCKED not_owned");
  assert.equal((await resume("7", "short", host(["RESTART_SAFE"], restarted))).line, "RESUME_BLOCKED unexpected_arguments");
  assert.equal((await resume("7", sha, host(["RESTART_SAFE"], restarted))).line, "RESUMED");
  assert.deepEqual([read(holdFile), read(marker)], [null, null]);
  // Interrupted after the hold was removed: the rerun only clears its own marker.
  reset(null, "op=7 pid=100\n");
  assert.equal((await resume("7", sha, host(["RESTART_SAFE"], restarted))).line, "RESUMED");
  assert.equal(read(marker), null);

  // Abort only before any restart, while the prepared process still runs from the current link.
  const unchanged = { serviceState: () => "active", mainPid: () => "100", runningDir: () => "/r/old/ws-server", currentDir: () => "/r/old/ws-server" };
  for (const [extra, line] of [
    [{ mainPid: () => "200" }, "ABORT_BLOCKED process_changed"],
    [{ serviceState: () => "activating" }, "ABORT_BLOCKED process_changed"],
    [{ currentDir: () => releaseDir }, "ABORT_BLOCKED release_link_changed"]
  ]) {
    reset("drain\n", "op=7 pid=100\n");
    assert.equal((await abort("7", host(["RESTART_SAFE"], { ...unchanged, ...extra }))).line, line);
    assert.equal(read(holdFile), "drain\n", line);
  }
  assert.equal((await abort("7", host(["RESTART_SAFE"], unchanged))).line, "ABORTED");
  assert.deepEqual([read(holdFile), read(marker)], [null, null]);
  assert.equal((await abort("7", host(["RESTART_SAFE"], unchanged))).line, "ABORTED not_held");

  fs.chmodSync(`${boundary}/ws-hold`, 0o777);
  assert.equal((await prepare("7", host(["RESTART_SAFE"]))).line, "RESTART_BLOCKED hold_path_unprotected");
  fs.chmodSync(`${boundary}/ws-hold`, 0o755);
});
