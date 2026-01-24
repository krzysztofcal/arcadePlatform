import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir);

function readMigration(label, matchers) {
  const file = matchers
    .map((matcher) => migrationFiles.find((name) => name.includes(matcher)))
    .find(Boolean);
  assert.ok(file, `${label} migration file should exist`);
  return fs.readFileSync(path.join(migrationsDir, file), "utf8");
}

function assertLockdown(sql, table) {
  const target = `public.${table}`;
  assert.ok(/enable\s+row\s+level\s+security/i.test(sql), `${table} should enable RLS`);
  assert.ok(
    new RegExp(`revoke\\s+all\\s+on\\s+table\\s+${target}\\s+from\\s+anon(\\s*,\\s*authenticated)?`, "i").test(
      sql
    ),
    `${table} should revoke anon`
  );
  assert.ok(
    new RegExp(
      `revoke\\s+all\\s+on\\s+table\\s+${target}\\s+from\\s+(anon\\s*,\\s*authenticated|authenticated)`,
      "i"
    ).test(sql),
    `${table} should revoke authenticated`
  );
  assert.ok(
    new RegExp(
      `grant\\s+select,\\s*insert,\\s*update,\\s*delete\\s+on\\s+table\\s+${target}\\s+to\\s+service_role`,
      "i"
    ).test(sql),
    `${table} should grant service_role`
  );
}

const pokerStateSql = readMigration("poker_state lockdown", ["poker_state_lockdown", "poker_state"]);
const pokerHoleCardsSql = readMigration("poker_hole_cards lockdown", [
  "poker_hole_cards_lockdown",
  "poker_hole_cards",
]);

assertLockdown(pokerStateSql, "poker_state");
assertLockdown(pokerHoleCardsSql, "poker_hole_cards");

console.log("Poker DB lockdown contract tests passed");
