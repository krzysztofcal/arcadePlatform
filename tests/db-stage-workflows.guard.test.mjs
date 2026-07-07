import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const MIGRATION_CHECK = ".github/workflows/db-migration-check.yml";
const STAGE_APPLY = ".github/workflows/db-stage-apply-pr.yml";
const STAGE_PREPARE = ".github/workflows/db-stage-prepare.yml";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("db migration check validates migration files without cloud mutation", () => {
  const text = read(MIGRATION_CHECK);

  assert.match(text, /^name: DB Migration Check/m);
  assert.match(text, /pull_request:/);
  assert.match(text, /"supabase\/\*\*"/);
  assert.match(text, /node scripts\/check-db-migrations\.mjs/);
  assert.doesNotMatch(text, /SUPABASE_STAGE_DB_URL/);
  assert.doesNotMatch(text, /stage-db-migrate\.mjs --apply/);
});

test("db stage apply PR is guarded to repo PRs and shared stage only", () => {
  const text = read(STAGE_APPLY);

  assert.match(text, /^name: DB Stage Apply PR/m);
  assert.match(text, /pull_request:/);
  assert.match(text, /"supabase\/migrations\/\*\*"/);
  assert.match(text, /group: db-stage/);
  assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(text, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
  assert.match(text, /SUPABASE_STAGE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_STAGE_PROJECT_REF \}\}/);
  assert.match(text, /SUPABASE_STAGE_DB_URL must target SUPABASE_STAGE_PROJECT_REF/);
  assert.match(text, /git diff --name-only "origin\/\$\{\{ github\.base_ref \}\}"\.\.\.HEAD -- supabase\/migrations/);
  assert.match(text, /node scripts\/check-db-migrations\.mjs/);
  assert.match(text, /node scripts\/stage-db-migrate\.mjs --apply --changed-from "origin\/\$\{\{ github\.base_ref \}\}"/);
  assert.doesNotMatch(text, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.doesNotMatch(text, /db reset|drop schema|drop database|supabase db reset/i);
});

test("db stage prepare is manual, ref-scoped, and non-destructive", () => {
  const text = read(STAGE_PREPARE);

  assert.match(text, /^name: DB Stage Prepare/m);
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /inputs:\n\s+ref:/);
  assert.match(text, /group: db-stage/);
  assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(text, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
  assert.match(text, /SUPABASE_STAGE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_STAGE_PROJECT_REF \}\}/);
  assert.match(text, /SUPABASE_STAGE_DB_URL must target SUPABASE_STAGE_PROJECT_REF/);
  assert.match(text, /node scripts\/check-db-migrations\.mjs/);
  assert.match(text, /node scripts\/stage-db-migrate\.mjs --apply/);
  assert.doesNotMatch(text, /pull_request:/);
  assert.doesNotMatch(text, /db reset|drop schema|drop database|supabase db reset/i);
});

test("stage migration helper refuses non-stage targets and unrelated remote migrations", () => {
  const text = read("scripts/stage-db-migrate.mjs");

  assert.match(text, /SUPABASE_STAGE_DB_URL is required/);
  assert.match(text, /SUPABASE_STAGE_PROJECT_REF is required/);
  assert.match(text, /does not contain SUPABASE_STAGE_PROJECT_REF/);
  assert.match(text, /Stage DB contains migration versions that are not present in this checkout/);
  assert.match(text, /Stage already has this migration version with different contents; bump timestamp or reset\/recreate stage/);
  assert.match(text, /--changed-from/);
  assert.match(text, /schema_migration_files/);
  assert.match(text, /Refusing to continue/);
  assert.doesNotMatch(text, /drop schema|drop database|truncate/i);
});
