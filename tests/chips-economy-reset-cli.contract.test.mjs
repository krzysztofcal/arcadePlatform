import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const RESET_SQL_PATH = "supabase/manual/chips-economy-test-reset.sql";
const RUNBOOK_PATH = "docs/ch-economy-reset-runbook.md";
const resetSql = fs.readFileSync(RESET_SQL_PATH, "utf8");
const runbook = fs.readFileSync(RUNBOOK_PATH, "utf8");
const testDbUrl = String(process.env.CHIPS_RESET_CLI_TEST_DB_URL || "").trim();

function combinedOutput(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function requireLocalTestDatabase(urlText) {
  const url = new URL(urlText);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "CLI contract DB must be local");
}

function runPsql(args) {
  return spawnSync("psql", [testDbUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env: process.env
  });
}

function assertSentinelUnchanged() {
  const result = runPsql(["-At", "-c", "select count(*) from public.reset_cli_sentinel where marker = 'unchanged'"]);
  assert.equal(result.status, 0, combinedOutput(result));
  assert.equal(result.stdout.trim(), "1");
}

function resetArgs(confirmReset) {
  const args = [
    "-v", "reset_target=stage",
    "-v", "expected_project_ref=localcontractref",
    "-v", "reset_apply=1"
  ];
  if (confirmReset !== undefined) args.push("-v", `confirm_reset=${confirmReset}`);
  args.push("-f", RESET_SQL_PATH);
  return args;
}

test("reset SQL uses SQL exceptions instead of unsupported psql quit status arguments", () => {
  assert.doesNotMatch(resetSql, /\\quit(?:\s+\S+)?/);
  assert.match(resetSql, /raise exception 'reset_guard_missing_reset_target'/);
  assert.match(resetSql, /raise exception 'reset_guard_missing_expected_project_ref'/);
  assert.match(resetSql, /raise exception 'reset_guard_invalid_reset_target'/);
  assert.match(resetSql, /raise exception 'reset_guard_empty_expected_project_ref'/);
  assert.match(resetSql, /raise exception 'reset_guard_invalid_reset_apply'/);
  assert.match(resetSql, /raise exception 'reset_guard_invalid_confirmation'/);
  assert.match(resetSql, /raise exception 'reset_preflight_missing_relations:/);
  assert.match(resetSql, /raise exception 'reset_preflight_required_trigger_missing_or_disabled'/);
  assert.match(resetSql, /raise exception 'reset_preflight_unexpected_fk:/);
  assert.match(resetSql, /raise exception 'reset_preflight_invalid_poker_cascade'/);
  assert.ok(resetSql.indexOf("reset_guard_invalid_confirmation") < resetSql.indexOf("-- Fail before printing counts"));
  assert.ok(resetSql.indexOf("reset_guard_invalid_confirmation") < resetSql.indexOf("begin;"));
});

test("runbook pins the stage confirmation token and exact success marker", () => {
  assert.match(runbook, /-v confirm_reset=RESET_STAGE_CH_ECONOMY/);
  assert.match(runbook, /grep -Fxq 'RESET COMMITTED AND POST-COMMIT BASELINE VERIFIED FOR: stage'/);
  assert.match(runbook, /APPLY_EXIT=\$\{PIPESTATUS\[0\]\}/);
});

test("psql 16 rejects missing and invalid apply confirmation without mutation", { skip: !testDbUrl }, () => {
  requireLocalTestDatabase(testDbUrl);
  const setup = runPsql(["-c", "drop table if exists public.reset_cli_sentinel; create table public.reset_cli_sentinel(marker text primary key); insert into public.reset_cli_sentinel values ('unchanged');"]);
  assert.equal(setup.status, 0, combinedOutput(setup));

  for (const token of [undefined, "WRONG_TOKEN"]) {
    const result = runPsql(resetArgs(token));
    const output = combinedOutput(result);
    assert.equal(result.status, 3, output);
    assert.match(output, /reset_guard_invalid_confirmation/);
    assert.doesNotMatch(output, /APPLY CONFIRMED/);
    assert.doesNotMatch(output, /RESET COMMITTED AND POST-COMMIT BASELINE VERIFIED/);
    assertSentinelUnchanged();
  }
});

test("psql 16 accepts the exact token and advances to schema preflight", { skip: !testDbUrl }, () => {
  requireLocalTestDatabase(testDbUrl);
  const result = runPsql(resetArgs("RESET_STAGE_CH_ECONOMY"));
  const output = combinedOutput(result);
  assert.equal(result.status, 3, output);
  assert.match(output, /APPLY CONFIRMED\. Running fail-closed schema preflight for: stage/);
  assert.match(output, /reset_preflight_missing_relations/);
  assert.doesNotMatch(output, /reset_guard_invalid_confirmation/);
  assert.doesNotMatch(output, /RESET COMMITTED AND POST-COMMIT BASELINE VERIFIED/);
  assertSentinelUnchanged();
});
