import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = path.resolve("scripts/ops/ch-economy-network-maintenance.sh");
const STAGE_REF = "krydukthwdvccggbyjfw";
const PROD_REF = "otbqfijerkieoxwpxjnm";
const ORIGINAL = { dbAllowedCidrs: ["198.51.100.8/32"], dbAllowedCidrsV6: ["2001:db8::8/128"] };
const DESIRED = { dbAllowedCidrs: ["203.0.113.10/32"], dbAllowedCidrsV6: [] };

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, { mode: 0o700 });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ch-network-maintenance-"));
  const stateDir = path.join(root, "state");
  const apiState = path.join(root, "api.json");
  const cliLog = path.join(root, "cli.log");
  fs.writeFileSync(apiState, JSON.stringify({ entitlement: "allowed", status: "applied", config: ORIGINAL }));

  const cli = path.join(root, "supabase-fake.mjs");
  writeExecutable(cli, `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("2.109.1\\n"); process.exit(0); }
fs.appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify(args) + "\\n");
if (args[0] !== "network-restrictions") process.exit(9);
if (args[1] === "get") {
  const value = JSON.parse(fs.readFileSync(process.env.FAKE_API_STATE, "utf8"));
  if (value.pendingConfig) {
    if (Number(value.remainingGets || 0) > 0) {
      value.remainingGets -= 1;
      fs.writeFileSync(process.env.FAKE_API_STATE, JSON.stringify(value));
      process.stdout.write(JSON.stringify({ entitlement: "allowed", status: "pending", config: value.config }));
      process.exit(0);
    }
    const applied = { entitlement: "allowed", status: "applied", config: value.pendingConfig };
    fs.writeFileSync(process.env.FAKE_API_STATE, JSON.stringify(applied));
    process.stdout.write(JSON.stringify(applied)); process.exit(0);
  }
  process.stdout.write(JSON.stringify(value)); process.exit(0);
}
if (args[1] === "update") {
  const cidrs = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === "--db-allow-cidr") cidrs.push(args[i + 1]);
  const config = { dbAllowedCidrs: cidrs.filter((x) => !x.includes(":")), dbAllowedCidrsV6: cidrs.filter((x) => x.includes(":")) };
  if (process.env.FAKE_DELAYED_UPDATE === "1") {
    const previous = JSON.parse(fs.readFileSync(process.env.FAKE_API_STATE, "utf8"));
    fs.writeFileSync(process.env.FAKE_API_STATE, JSON.stringify({ entitlement: "allowed", status: "pending", config: previous.config, pendingConfig: config, remainingGets: 1 }));
  } else {
    fs.writeFileSync(process.env.FAKE_API_STATE, JSON.stringify({ entitlement: "allowed", status: process.env.FAKE_UPDATE_STATUS || "applied", config }));
  }
  process.stdout.write("{}\\n"); process.exit(0);
}
process.exit(9);
`);

  const curl = path.join(root, "curl-fake.sh");
  writeExecutable(curl, "#!/usr/bin/env bash\nif [[ \"$*\" == *api64.ipify.org* ]]; then printf '2001:db8::10'; else printf '203.0.113.10'; fi\n");
  const systemctl = path.join(root, "systemctl-fake.sh");
  writeExecutable(systemctl, "#!/usr/bin/env bash\nprintf '%s\\n' \"${FAKE_SYSTEMCTL_STATE:-inactive}\"\nprintf '%s\\n' \"$*\" >> \"$FAKE_SYSTEMCTL_LOG\"\n");

  const env = {
    ...process.env,
    RESET_TARGET: "stage",
    SUPABASE_STAGE_DB_URL: `postgresql://postgres.${STAGE_REF}:secret@aws-0-eu.pooler.supabase.com:6543/postgres`,
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: STAGE_REF,
    SUPABASE_PROD_DB_URL: `postgresql://postgres.${PROD_REF}:secret@aws-0-eu.pooler.supabase.com:6543/postgres`,
    EXPECTED_SUPABASE_PROD_PROJECT_REF: PROD_REF,
    VPS_IPV4_CIDR: "203.0.113.10/32",
    CH_ECONOMY_NETWORK_STATE_DIR: stateDir,
    SUPABASE_CLI_BIN: cli,
    NETWORK_MAINTENANCE_CURL_BIN: curl,
    NETWORK_MAINTENANCE_SYSTEMCTL_BIN: systemctl,
    NETWORK_RESTRICTIONS_POLL_INTERVAL_SECONDS: "0",
    NETWORK_RESTRICTIONS_APPLY_TIMEOUT_SECONDS: "2",
    NETWORK_MAINTENANCE_TEST_MODE: "1",
    FAKE_API_STATE: apiState,
    FAKE_CLI_LOG: cliLog,
    FAKE_SYSTEMCTL_LOG: path.join(root, "systemctl.log"),
    FAKE_SYSTEMCTL_STATE: "inactive"
  };
  return { root, stateDir, apiState, cliLog, env };
}

function run(command, env, extra = {}) {
  return spawnSync("bash", [SCRIPT, command], { encoding: "utf8", env: { ...env, ...extra } });
}

function output(result) { return `${result.stdout || ""}\n${result.stderr || ""}`; }
function recoveryPath(f, target = "stage") { return path.join(f.stateDir, `${target}-network-restrictions.json`); }
function readRecovery(f, target = "stage") { return JSON.parse(fs.readFileSync(recoveryPath(f, target), "utf8")); }
function readApi(f) { return JSON.parse(fs.readFileSync(f.apiState, "utf8")); }
function setApi(f, status, config) { fs.writeFileSync(f.apiState, JSON.stringify({ entitlement: "allowed", status, config })); }

test("target is anchored to versioned canonical refs and rejects a complete pair swap", () => {
  const f = fixture();
  const swapped = {
    ...f.env,
    SUPABASE_PROD_DB_URL: f.env.SUPABASE_STAGE_DB_URL,
    EXPECTED_SUPABASE_PROD_PROJECT_REF: STAGE_REF,
    SUPABASE_STAGE_DB_URL: f.env.SUPABASE_PROD_DB_URL,
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: PROD_REF
  };
  for (const target of ["stage", "prod"]) {
    const result = run("status", { ...swapped, RESET_TARGET: target });
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), /expected ref does not match the versioned canonical (?:stage|production) ref/);
  }
  assert.equal(fs.existsSync(f.cliLog), false, "validation must fail before Management API access");
});

test("both expected refs are independently anchored even when the selected pair is correct", () => {
  const f = fixture();
  const wrongOpposite = { ...f.env, EXPECTED_SUPABASE_PROD_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa" };
  const result = run("status", wrongOpposite);
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /production expected ref/);
  assert.equal(fs.existsSync(f.cliLog), false);
});

test("missing target-specific input fails before CLI access", () => {
  const f = fixture();
  const missing = { ...f.env, RESET_TARGET: "prod" };
  delete missing.SUPABASE_PROD_DB_URL;
  const result = run("status", missing);
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /SUPABASE_PROD_DB_URL is required/);
  assert.equal(fs.existsSync(f.cliLog), false);
});

test("stage preflight writes captured recovery and cancel archives it without update", () => {
  const f = fixture();
  const preflight = run("preflight", f.env);
  assert.equal(preflight.status, 0, output(preflight));
  assert.equal(readRecovery(f).phase, "captured");
  assert.equal(fs.statSync(recoveryPath(f)).mode & 0o777, 0o600);

  const cancel = run("cancel", f.env);
  assert.equal(cancel.status, 0, output(cancel));
  assert.equal(fs.existsSync(recoveryPath(f)), false);
  assert.deepEqual(readApi(f).config, ORIGINAL);
  assert.doesNotMatch(fs.readFileSync(f.cliLog, "utf8"), /"update"/);
  assert.equal(fs.readdirSync(f.stateDir).some((name) => name.startsWith("stage-network-restrictions.json.cancelled-")), true);
});

test("interruption before API update leaves restricting recovery that can be cancelled", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  const interrupted = run("restrict", f.env, { NETWORK_MAINTENANCE_TEST_MODE: "1", NETWORK_MAINTENANCE_TEST_STOP_AFTER: "phase-restricting" });
  assert.equal(interrupted.status, 86, output(interrupted));
  assert.equal(readRecovery(f).phase, "restricting");
  assert.deepEqual(readApi(f).config, ORIGINAL);
  assert.equal(run("cancel", f.env).status, 0);
});

test("interruption after API update retains intent and restore returns exact snapshot", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  const interrupted = run("restrict", f.env, {
    NETWORK_MAINTENANCE_TEST_MODE: "1",
    NETWORK_MAINTENANCE_TEST_STOP_AFTER: "api-update",
    FAKE_UPDATE_STATUS: "pending"
  });
  assert.equal(interrupted.status, 86, output(interrupted));
  assert.equal(readRecovery(f).phase, "restricting");
  assert.equal(readApi(f).status, "pending");
  assert.deepEqual(readApi(f).config, DESIRED);

  const restored = run("restore", f.env);
  assert.equal(restored.status, 0, output(restored));
  assert.deepEqual(readApi(f), { entitlement: "allowed", status: "applied", config: ORIGINAL });
  assert.equal(fs.existsSync(recoveryPath(f)), false);
});

test("interruption after convergence finalizes without duplicate update", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  const interrupted = run("restrict", f.env, { NETWORK_MAINTENANCE_TEST_MODE: "1", NETWORK_MAINTENANCE_TEST_STOP_AFTER: "convergence" });
  assert.equal(interrupted.status, 86, output(interrupted));
  assert.equal(readRecovery(f).phase, "restricting");
  assert.deepEqual(readApi(f).config, DESIRED);
  const updatesBefore = fs.readFileSync(f.cliLog, "utf8").split("\n").filter((line) => line.includes('"update"')).length;

  const resumed = run("restrict", f.env);
  assert.equal(resumed.status, 0, output(resumed));
  assert.equal(readRecovery(f).phase, "restricted");
  const updatesAfter = fs.readFileSync(f.cliLog, "utf8").split("\n").filter((line) => line.includes('"update"')).length;
  assert.equal(updatesAfter, updatesBefore);
});

test("restrict and restore tolerate only the saved source config during API convergence", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  const restrict = run("restrict", f.env, { FAKE_DELAYED_UPDATE: "1" });
  assert.equal(restrict.status, 0, output(restrict));
  assert.equal(readRecovery(f).phase, "restricted");
  assert.deepEqual(readApi(f).config, DESIRED);

  const restore = run("restore", f.env, { FAKE_DELAYED_UPDATE: "1" });
  assert.equal(restore.status, 0, output(restore));
  assert.deepEqual(readApi(f).config, ORIGINAL);
});

test("production binds ws-server service, requires confirmation, and restores unrestricted mode", () => {
  const f = fixture();
  const prodEnv = { ...f.env, RESET_TARGET: "prod" };
  setApi(f, "applied", { dbAllowedCidrs: ["0.0.0.0/0"], dbAllowedCidrsV6: ["::/0"] });
  assert.equal(run("preflight", prodEnv).status, 0);
  const denied = run("restrict", prodEnv);
  assert.notEqual(denied.status, 0, output(denied));
  assert.match(output(denied), /confirmation/);

  const confirmed = run("restrict", prodEnv, { NETWORK_MAINTENANCE_CONFIRM: `RESTRICT_PROD_${PROD_REF}` });
  assert.equal(confirmed.status, 0, output(confirmed));
  assert.match(fs.readFileSync(prodEnv.FAKE_SYSTEMCTL_LOG, "utf8"), /is-active ws-server\.service/);
  const restore = run("restore", prodEnv);
  assert.equal(restore.status, 0, output(restore));
  assert.deepEqual(readApi(f).config, { dbAllowedCidrs: ["0.0.0.0/0"], dbAllowedCidrsV6: ["::/0"] });
  assert.doesNotMatch(fs.readFileSync(f.cliLog, "utf8"), /--append/);
});

test("restrict fails closed while the target WS service is active", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  const result = run("restrict", f.env, { FAKE_SYSTEMCTL_STATE: "active" });
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /ws-server-preview\.service/);
  assert.equal(readRecovery(f).phase, "captured");
});

test("status reports controlled mode without recovery and malformed API responses fail closed", () => {
  const f = fixture();
  const result = run("status", f.env);
  assert.equal(result.status, 0, output(result));
  const status = JSON.parse(result.stdout);
  assert.equal(status.target, "stage");
  assert.equal(status.projectRef, STAGE_REF);
  assert.equal(status.status, "applied");
  assert.equal(status.mode, "restricted-untracked");
  assert.equal(status.recoveryPhase, "none");

  fs.writeFileSync(f.apiState, JSON.stringify({ status: "applied" }));
  const malformed = run("status", f.env);
  assert.notEqual(malformed.status, 0, output(malformed));
});

test("changed restrictions block cancel and preserve recovery", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  setApi(f, "applied", DESIRED);
  const result = run("cancel", f.env);
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /differ from captured snapshot/);
  assert.equal(fs.existsSync(recoveryPath(f)), true);
});

test("cross-target recovery is never consumed by the other target", () => {
  const f = fixture();
  assert.equal(run("preflight", f.env).status, 0);
  const prod = run("restore", { ...f.env, RESET_TARGET: "prod" });
  assert.notEqual(prod.status, 0, output(prod));
  assert.match(output(prod), /recovery file is missing/);
  assert.equal(fs.existsSync(recoveryPath(f)), true);
});

test("active legacy and unknown recovery fail closed while restored archives do not block", () => {
  const f = fixture();
  fs.mkdirSync(f.stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${recoveryPath(f)}.restored-20260717T000000Z`, "{}\n", { mode: 0o600 });
  assert.equal(run("preflight", f.env).status, 0);
  fs.unlinkSync(recoveryPath(f));
  fs.writeFileSync(recoveryPath(f), JSON.stringify({ schemaVersion: 99 }), { mode: 0o600 });
  const result = run("status", f.env);
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /legacy, malformed/);
  assert.equal(fs.existsSync(recoveryPath(f)), true);
});

test("explicit stage legacy migration is read-only and never adopts legacy evidence for production", () => {
  const f = fixture();
  fs.mkdirSync(f.stateDir, { recursive: true, mode: 0o700 });
  const legacy = {
    schemaVersion: 1,
    projectRef: STAGE_REF,
    capturedAt: "2026-07-17T00:00:00.000Z",
    supabaseCliVersion: "2.109.1",
    config: ORIGINAL
  };
  fs.writeFileSync(recoveryPath(f), JSON.stringify(legacy), { mode: 0o600 });
  const resolved = run("migrate-recovery", f.env);
  assert.equal(resolved.status, 0, output(resolved));
  assert.deepEqual(readApi(f).config, ORIGINAL);
  assert.doesNotMatch(fs.readFileSync(f.cliLog, "utf8"), /"update"/);

  fs.writeFileSync(recoveryPath(f), JSON.stringify(legacy), { mode: 0o600 });
  const prod = run("migrate-recovery", { ...f.env, RESET_TARGET: "prod" });
  assert.notEqual(prod.status, 0, output(prod));
  assert.match(output(prod), /stage-only/);
  assert.equal(fs.existsSync(recoveryPath(f)), true);

  const restrictedFixture = fixture();
  fs.mkdirSync(restrictedFixture.stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(recoveryPath(restrictedFixture), JSON.stringify(legacy), { mode: 0o600 });
  setApi(restrictedFixture, "applied", DESIRED);
  const migrated = run("migrate-recovery", restrictedFixture.env);
  assert.equal(migrated.status, 0, output(migrated));
  assert.equal(readRecovery(restrictedFixture).phase, "restricted");
  assert.deepEqual(readRecovery(restrictedFixture).previousConfig, ORIGINAL);
  assert.deepEqual(readRecovery(restrictedFixture).desiredConfig, DESIRED);
  assert.doesNotMatch(fs.readFileSync(restrictedFixture.cliLog, "utf8"), /"update"/);
});

test("global lock serializes stage and production commands", () => {
  const f = fixture();
  fs.mkdirSync(f.stateDir, { recursive: true, mode: 0o700 });
  const lock = path.join(f.stateDir, "ch-economy-network-maintenance.lock");
  const holder = spawnSync("bash", ["-c", `exec 8>\"${lock}\"; flock -n 8; RESET_TARGET=prod bash \"${SCRIPT}\" status`], {
    encoding: "utf8",
    env: { ...f.env, RESET_TARGET: "prod" }
  });
  assert.notEqual(holder.status, 0, output(holder));
  assert.match(output(holder), /another CH economy network maintenance operation/);
});

test("script and docs retire executable references to stage-only tooling", () => {
  const sources = [
    fs.readFileSync(SCRIPT, "utf8"),
    fs.readFileSync("docs/ch-economy-reset-runbook.md", "utf8"),
    fs.readFileSync("docs/ch-economy-reset-and-escrow-monitoring-plan.md", "utf8")
  ].join("\n");
  assert.doesNotMatch(sources, /scripts\/ops\/stage-network-maintenance\.sh/);
  assert.match(fs.readFileSync("netlify/functions/_shared/supabase-admin.mjs", "utf8"), /connect_timeout:\s*10/);
  assert.match(fs.readFileSync("netlify/functions/admin-ops-summary.mjs", "utf8"), /statusCode:\s*500[\s\S]*error:\s*"server_error"/);
});
