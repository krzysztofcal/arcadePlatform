import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

let lockdownFile = migrationFiles.find((file) => file.includes("poker_state_rls_lockdown")) || "";
let lockdownText = "";
if (lockdownFile) {
  lockdownText = fs.readFileSync(path.join(migrationsDir, lockdownFile), "utf8").toLowerCase();
} else {
  for (const file of migrationFiles) {
    const text = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    if (text.toLowerCase().includes("alter table public.poker_state enable row level security")) {
      lockdownFile = file;
      lockdownText = text.toLowerCase();
      break;
    }
  }
}

assert.ok(lockdownFile, "poker_state RLS migration not found in supabase/migrations");
assert.ok(
  lockdownText.includes("revoke all on table public.poker_state from anon"),
  "poker_state RLS migration should revoke anon grants"
);
assert.ok(
  lockdownText.includes("revoke all on table public.poker_state from authenticated"),
  "poker_state RLS migration should revoke authenticated grants"
);
assert.ok(
  lockdownText.includes("grant select, insert, update, delete on table public.poker_state to service_role"),
  "poker_state RLS migration should grant service_role access"
);
assert.ok(
  lockdownText.includes("from pg_policies") && lockdownText.includes("drop policy"),
  "poker_state RLS migration should drop existing policies"
);

for (const file of migrationFiles) {
  const text = fs.readFileSync(path.join(migrationsDir, file), "utf8").toLowerCase();
  const hasSelectPolicy = /create\s+policy[\s\S]*on\s+public\.poker_state[\s\S]*for\s+select/.test(text);
  const hasAllPolicy = /create\s+policy[\s\S]*on\s+public\.poker_state[\s\S]*for\s+all/.test(text);
  assert.equal(
    hasSelectPolicy || hasAllPolicy,
    false,
    `poker_state should not define select/all policies in migrations (found in ${file})`
  );
}
