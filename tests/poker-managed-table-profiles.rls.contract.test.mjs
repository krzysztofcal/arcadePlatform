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

