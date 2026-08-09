import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => (
  file.includes("poker_managed_table_profiles") && file.includes("enable_rls")
));

assert.equal(
  migrationFiles.length,
  1,
  `expected one managed-table-profile RLS migration, got ${migrationFiles.join(", ")}`
);

const migrationSql = fs.readFileSync(path.join(migrationsDir, migrationFiles[0]), "utf8");
assert.match(
  migrationSql,
  /alter\s+table\s+public\.poker_managed_table_profiles\s+enable\s+row\s+level\s+security\s*;/i
);
assert.doesNotMatch(migrationSql, /create\s+policy/i, "backend-only profile must not gain a client policy");
assert.doesNotMatch(migrationSql, /grant[\s\S]+\b(anon|authenticated)\b/i);

const canonicalMigrationFiles = fs.readdirSync(migrationsDir).filter((file) => (
  file.includes("poker_managed_table_profiles") && file.includes("canonical_stakes")
));
assert.equal(canonicalMigrationFiles.length, 1, "expected one managed-table-profile canonical-stakes migration");
const canonicalMigrationSql = fs.readFileSync(path.join(migrationsDir, canonicalMigrationFiles[0]), "utf8");
assert.match(canonicalMigrationSql, /update\s+public\.poker_managed_table_profiles/i);
assert.match(canonicalMigrationSql, /set[\s\S]*small_blind\s*=\s*1[\s,\S]*big_blind\s*=\s*2/i);
assert.match(canonicalMigrationSql, /where[\s\S]*profile_key\s*=\s*'CONTINUOUS_BOT_DEFAULT'/i);
assert.doesNotMatch(canonicalMigrationSql, /\benabled\s*=|desired_table_count\s*=/i, "stakes correction must preserve profile state");
