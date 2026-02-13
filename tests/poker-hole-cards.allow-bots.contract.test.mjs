import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir).sort();

const migrationTexts = migrationFiles.map((name) => ({
  name,
  sql: fs.readFileSync(path.join(migrationsDir, name), "utf8"),
}));

const hasDropConstraintMigration = migrationTexts.some(({ sql }) => {
  const normalized = sql.toLowerCase();
  const targetsHoleCards = normalized.includes("public.poker_hole_cards");
  const dropsConstraint = normalized.includes("drop constraint");
  const referencesAuthUsers = normalized.includes("auth") && normalized.includes("users");
  return targetsHoleCards && dropsConstraint && referencesAuthUsers;
});

assert.equal(
  hasDropConstraintMigration,
  true,
  "expected a migration that drops/relaxes public.poker_hole_cards(user_id) FK to auth.users"
);

const latestIntentContainsAuthUsersFk = migrationTexts.some(({ sql }) => {
  const normalized = sql.toLowerCase();
  const createsHoleCards = normalized.includes("create table public.poker_hole_cards");
  const explicitUserFk = normalized.includes("user_id uuid not null references auth.users");
  return createsHoleCards && explicitUserFk;
});

assert.equal(latestIntentContainsAuthUsersFk, true, "baseline schema should contain original FK before relaxation migration");
console.log("poker_hole_cards bot-id migration contract test passed");
