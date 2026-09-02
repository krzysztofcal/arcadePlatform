import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  assert.match(text, /PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(text, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(text, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(text, /fetch-depth: 1/);
  assert.match(text, /git fetch --no-tags --prune --unshallow origin/);
  assert.match(text, /\+\$PR_BASE_SHA:refs\/remotes\/origin\/pr-base/);
  assert.match(text, /\+\$PR_HEAD_SHA:refs\/remotes\/origin\/pr-head/);
  assert.match(text, /git merge-base "\$PR_BASE_SHA" "\$PR_HEAD_SHA"/);
  assert.match(text, /git diff --name-only "\$PR_BASE_SHA\.\.\.\$PR_HEAD_SHA" -- supabase\/migrations/);
  assert.match(text, /node scripts\/check-db-migrations\.mjs/);
  assert.match(text, /node scripts\/stage-db-migrate\.mjs --apply --changed-from "\$PR_BASE_SHA"/);
  assert.match(text, /if: \$\{\{ steps\.changed\.outputs\.count != '0' \}\}/);
  assert.match(text, /if: \$\{\{ steps\.changed\.outputs\.count == '0' \}\}/);
  assert.match(text, /No supabase\/migrations changes detected; stage DB apply skipped\./);
  assert.doesNotMatch(text, /pull_request_target:/);
  assert.doesNotMatch(text, /github\.base_ref/);
  assert.doesNotMatch(text, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.doesNotMatch(text, /db reset|drop schema|drop database|supabase db reset/i);
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("db stage apply materializes base/head history from a shallow checkout", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "db-stage-apply-pr-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const shallow = path.join(root, "shallow");
  fs.mkdirSync(seed);

  git(seed, ["init", "-b", "main"]);
  git(seed, ["config", "user.email", "workflow-test@example.invalid"]);
  git(seed, ["config", "user.name", "workflow-test"]);
  fs.mkdirSync(path.join(seed, "supabase", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(seed, "README.md"), "base\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "base"]);
  const baseSha = git(seed, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(seed, "supabase", "migrations", "20260101000000_fixture.sql"), "select 1;\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "migration"]);
  const headSha = git(seed, ["rev-parse", "HEAD"]);

  git(root, ["init", "--bare", origin]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "origin", "main"]);

  git(root, ["clone", "--depth=1", "file://" + origin, "--branch", "main", shallow]);
  assert.equal(git(shallow, ["rev-parse", "--is-shallow-repository"]), "true");
  assert.equal(git(shallow, ["rev-parse", "HEAD"]), headSha);

  git(shallow, [
    "fetch", "--no-tags", "--prune", "--unshallow", "origin",
    "+" + baseSha + ":refs/remotes/origin/pr-base",
    "+" + headSha + ":refs/remotes/origin/pr-head",
  ]);
  assert.equal(git(shallow, ["rev-parse", "refs/remotes/origin/pr-base"]), baseSha);
  assert.equal(git(shallow, ["rev-parse", "refs/remotes/origin/pr-head"]), headSha);
  assert.equal(git(shallow, ["merge-base", baseSha, headSha]), baseSha);
  assert.equal(
    git(shallow, ["diff", "--name-only", baseSha + "..." + headSha, "--", "supabase/migrations"]),
    "supabase/migrations/20260101000000_fixture.sql",
  );
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
  assert.match(text, /Stage already has this migration version but no recorded contents hash; bump timestamp or reset\/recreate stage/);
  assert.match(text, /Stage already has this migration version with different contents; bump timestamp or reset\/recreate stage/);
  assert.match(text, /--changed-from/);
  assert.match(text, /schema_migration_files/);
  assert.match(text, /Refusing to continue/);
  assert.doesNotMatch(text, /drop schema|drop database|truncate/i);
});
