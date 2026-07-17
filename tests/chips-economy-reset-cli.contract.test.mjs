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
  assert.match(resetSql, /tg\.tgname = 'chips_entries_balanced_transaction'[\s\S]*tg\.tgdeferrable and tg\.tginitdeferred/);
  assert.ok(resetSql.indexOf("delete from public.chips_entries;") < resetSql.indexOf("set constraints chips_entries_balanced_transaction immediate;"));
  assert.ok(resetSql.indexOf("set constraints chips_entries_balanced_transaction immediate;") < resetSql.indexOf("alter table public.chips_entries enable trigger chips_entries_block_deletes;"));
  assert.ok(resetSql.indexOf("reset_guard_invalid_confirmation") < resetSql.indexOf("-- Fail before printing counts"));
  assert.ok(resetSql.indexOf("reset_guard_invalid_confirmation") < resetSql.indexOf("begin;"));
});

test("runbook pins the stage confirmation token and exact success marker", () => {
  assert.match(runbook, /-v confirm_reset=RESET_STAGE_CH_ECONOMY/);
  assert.match(runbook, /grep -Fxq 'RESET COMMITTED AND POST-COMMIT BASELINE VERIFIED FOR: stage'/);
  assert.match(runbook, /APPLY_EXIT=\$\{PIPESTATUS\[0\]\}/);
  assert.match(runbook, /RESET_APPLY_VERIFIED=0\s+if \(\s+set -o pipefail/);
  assert.match(runbook, /RESET_APPLY_VERIFIED=1/);
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

test("PostgreSQL 16 drains deferred ledger events before both delete blockers are re-enabled", { skip: !testDbUrl }, () => {
  requireLocalTestDatabase(testDbUrl);
  const fixture = runPsql(["-c", `
    drop schema if exists reset_trigger_contract cascade;
    create schema reset_trigger_contract;
    set search_path to reset_trigger_contract;
    create table chips_transactions (id uuid primary key);
    create table chips_entries (
      id bigint generated always as identity primary key,
      transaction_id uuid not null references chips_transactions(id) on delete cascade,
      amount bigint not null
    );
    create function chips_reject_ledger_mutations() returns trigger language plpgsql as
      'begin raise exception ''Ledger rows are append-only''; end';
    create trigger chips_entries_block_deletes before delete on chips_entries
      for each row execute function chips_reject_ledger_mutations();
    create trigger chips_transactions_block_deletes before delete on chips_transactions
      for each row execute function chips_reject_ledger_mutations();
    create function chips_assert_balanced_transaction() returns trigger language plpgsql as
      'declare total bigint; begin select coalesce(sum(amount), 0) into total from chips_entries where transaction_id = coalesce(new.transaction_id, old.transaction_id); if total <> 0 then raise exception ''unbalanced''; end if; return null; end';
    create constraint trigger chips_entries_balanced_transaction
      after insert or update or delete on chips_entries deferrable initially deferred
      for each row execute function chips_assert_balanced_transaction();
    insert into chips_transactions values ('00000000-0000-0000-0000-000000000001');
    insert into chips_entries (transaction_id, amount) values
      ('00000000-0000-0000-0000-000000000001', -100),
      ('00000000-0000-0000-0000-000000000001', 100);
  `]);
  assert.equal(fixture.status, 0, combinedOutput(fixture));

  const oldFlow = runPsql(["-c", `
    set search_path to reset_trigger_contract;
    begin;
    alter table chips_entries disable trigger chips_entries_block_deletes;
    delete from chips_entries;
    alter table chips_entries enable trigger chips_entries_block_deletes;
    commit;
  `]);
  assert.equal(oldFlow.status, 1, combinedOutput(oldFlow));
  assert.match(combinedOutput(oldFlow), /cannot ALTER TABLE "chips_entries" because it has pending trigger events/);

  const reset = runPsql(["-c", `
    set search_path to reset_trigger_contract;
    begin;
    alter table chips_entries disable trigger chips_entries_block_deletes;
    alter table chips_transactions disable trigger chips_transactions_block_deletes;
    delete from chips_entries;
    set constraints chips_entries_balanced_transaction immediate;
    delete from chips_transactions;
    alter table chips_entries enable trigger chips_entries_block_deletes;
    alter table chips_transactions enable trigger chips_transactions_block_deletes;
    commit;
  `]);
  assert.equal(reset.status, 0, combinedOutput(reset));

  const verify = runPsql(["-At", "-F", "|", "-c", `
    select
      (select count(*) from reset_trigger_contract.chips_entries),
      (select count(*) from reset_trigger_contract.chips_transactions),
      string_agg(c.relname || ':' || t.tgname || ':' || t.tgenabled::text, ',' order by c.relname, t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'reset_trigger_contract'
      and t.tgname in ('chips_entries_block_deletes', 'chips_transactions_block_deletes', 'chips_entries_balanced_transaction');
  `]);
  assert.equal(verify.status, 0, combinedOutput(verify));
  assert.equal(
    verify.stdout.trim(),
    "0|0|chips_entries:chips_entries_balanced_transaction:O,chips_entries:chips_entries_block_deletes:O,chips_transactions:chips_transactions_block_deletes:O"
  );
});
