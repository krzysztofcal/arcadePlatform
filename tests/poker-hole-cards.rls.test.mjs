import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir);
const migrationFile = migrationFiles.find((file) => file.includes("poker_hole_cards"));

assert.ok(migrationFile, "poker_hole_cards migration file should exist");

const migrationSrc = fs.readFileSync(path.join(migrationsDir, migrationFile), "utf8");

assert.ok(/create\s+table\s+public\.poker_hole_cards/i.test(migrationSrc), "migration should create poker_hole_cards");
assert.ok(/enable\s+row\s+level\s+security/i.test(migrationSrc), "migration should enable RLS");
assert.ok(/revoke\s+all\s+on\s+table\s+public\.poker_hole_cards\s+from\s+anon/i.test(migrationSrc), "revoke anon");
assert.ok(
  /revoke\s+all\s+on\s+table\s+public\.poker_hole_cards\s+from\s+authenticated/i.test(migrationSrc),
  "revoke authenticated"
);
assert.ok(
  /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+public\.poker_hole_cards\s+to\s+service_role/i.test(
    migrationSrc
  ),
  "grant service_role"
);

const hasUniqueConstraint = /unique\s*\(\s*table_id\s*,\s*hand_id\s*,\s*user_id\s*\)/i.test(migrationSrc);
const hasUniqueIndex = /create\s+unique\s+index[\s\S]*table_id[\s\S]*hand_id[\s\S]*user_id/i.test(migrationSrc);
assert.ok(hasUniqueConstraint || hasUniqueIndex, "migration should enforce uniqueness on (table_id, hand_id, user_id)");
