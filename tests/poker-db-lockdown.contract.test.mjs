import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir);

function readMigration(label, requiredSubstring) {
  const matches = migrationFiles.filter((name) => name.includes(requiredSubstring));
  assert.equal(
    matches.length,
    1,
    `${label} expected exactly 1 migration matching "${requiredSubstring}", got ${matches.length}: ${matches.join(", ")}`
  );
  const file = matches[0];
  assert.ok(file.toLowerCase().includes("lockdown"), `${label} migration filename must include "lockdown"`);
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
    new RegExp(`revoke\\s+all\\s+on\\s+table\\s+${target}\\s+from\\s+public`, "i").test(sql),
    `${table} should revoke PUBLIC`
  );
  assert.ok(
    new RegExp(
      `grant\\s+select,\\s*insert,\\s*update,\\s*delete\\s+on\\s+table\\s+${target}\\s+to\\s+service_role`,
      "i"
    ).test(sql),
    `${table} should grant service_role`
  );
}

const pokerStateSql = readMigration("poker_state lockdown", "poker_state_lockdown");
const pokerHoleCardsSql = readMigration("poker_hole_cards lockdown", "poker_hole_cards_lockdown");

assertLockdown(pokerStateSql, "poker_state");
assertLockdown(pokerHoleCardsSql, "poker_hole_cards");

console.log("Poker DB lockdown contract tests passed");
