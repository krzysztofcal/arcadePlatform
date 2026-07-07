import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const MIGRATION_RE = /^(\d{14})_([a-z0-9][a-z0-9_]*).sql$/;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runPsql(dbUrl, args, options = {}) {
  const result = spawnSync("psql", ["--no-psqlrc", ...args, dbUrl], {
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`psql failed with exit ${result.status}`);
  }
  return result.stdout || "";
}

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail("git failed with exit " + result.status);
  }
  return result.stdout || "";
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadLocalMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) fail(`Missing migrations directory: ${MIGRATIONS_DIR}`);
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = file.match(MIGRATION_RE);
      if (!match) fail(`Invalid migration filename: ${file}`);
      return {
        file,
        version: match[1],
        name: match[2],
        path: path.join(MIGRATIONS_DIR, file)
      };
    });
}

function ensureStageTarget(dbUrl, stageRef) {
  if (!dbUrl) fail("SUPABASE_STAGE_DB_URL is required.");
  if (!stageRef) fail("SUPABASE_STAGE_PROJECT_REF is required.");
  if (!dbUrl.includes(stageRef)) {
    fail("Refusing to migrate: SUPABASE_STAGE_DB_URL does not contain SUPABASE_STAGE_PROJECT_REF.");
  }
}

function ensureMigrationTable(dbUrl) {
  runPsql(dbUrl, [
    "-v", "ON_ERROR_STOP=1",
    "-c",
    [
      "create schema if not exists supabase_migrations;",
      "create table if not exists supabase_migrations.schema_migrations (",
      "  version text primary key,",
      "  statements text[],",
      "  name text",
      ");"
    ].join("\n")
  ]);
}

function readRemoteVersions(dbUrl) {
  const output = runPsql(dbUrl, [
    "-v", "ON_ERROR_STOP=1",
    "-At",
    "-c",
    "select version from supabase_migrations.schema_migrations order by version;"
  ]);
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function readChangedMigrationVersions(diffBase) {
  if (!diffBase) return [];

  const output = runGit([
    "diff",
    "--name-only",
    diffBase + "...HEAD",
    "--",
    "supabase/migrations"
  ]);

  return output.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"))
    .map((line) => path.basename(line))
    .map((file) => {
      const match = file.match(MIGRATION_RE);
      if (!match) fail("Invalid migration filename in PR diff: " + file);
      return { file, version: match[1] };
    });
}

function runSmokeChecks(dbUrl) {
  const smokeSql = [
    "do $$",
    "begin",
    "  if to_regclass('public.chips_accounts') is null then raise exception 'missing public.chips_accounts'; end if;",
    "  if to_regclass('public.chips_transactions') is null then raise exception 'missing public.chips_transactions'; end if;",
    "  if to_regclass('public.chips_entries') is null then raise exception 'missing public.chips_entries'; end if;",
    "  if not exists (select 1 from pg_type where typname = 'chips_tx_type') then raise exception 'missing public.chips_tx_type'; end if;",
    "  if not exists (select 1 from public.chips_accounts where user_id = 'SYSTEM/GENESIS') then raise exception 'missing SYSTEM/GENESIS account'; end if;",
    "end",
    "$$;"
  ].join("\n");
  runPsql(dbUrl, ["-v", "ON_ERROR_STOP=1", "-c", smokeSql]);
}

const apply = hasArg("--apply");
const changedFrom = argValue("--changed-from");
const dbUrl = argValue("--db-url") || process.env.SUPABASE_STAGE_DB_URL || "";
const stageRef = argValue("--stage-ref") || process.env.SUPABASE_STAGE_PROJECT_REF || "";

ensureStageTarget(dbUrl, stageRef);

const localMigrations = loadLocalMigrations();
const localByVersion = new Map(localMigrations.map((migration) => [migration.version, migration]));

ensureMigrationTable(dbUrl);
const remoteVersions = readRemoteVersions(dbUrl);
const unknownRemote = remoteVersions.filter((version) => !localByVersion.has(version));
if (unknownRemote.length) {
  fail([
    "Stage DB contains migration versions that are not present in this checkout:",
    ...unknownRemote.map((version) => `- ${version}`),
    "Refusing to continue. Recreate/reset stage, or run against the branch that owns these migrations."
  ].join("\n"));
}

const remoteSet = new Set(remoteVersions);
const changedAlreadyApplied = readChangedMigrationVersions(changedFrom)
  .filter((migration) => remoteSet.has(migration.version));
if (changedAlreadyApplied.length) {
  fail([
    "Stage already has this migration version; bump timestamp or reset/recreate stage.",
    ...changedAlreadyApplied.map((migration) => "- " + migration.file + " (" + migration.version + ")")
  ].join("\n"));
}

const pending = localMigrations.filter((migration) => !remoteSet.has(migration.version));

console.log(`Stage migration status: ${remoteVersions.length} applied, ${pending.length} pending.`);
for (const migration of pending) {
  console.log(`pending ${migration.file}`);
}

if (!apply) {
  runSmokeChecks(dbUrl);
  process.exit(0);
}

for (const migration of pending) {
  console.log(`Applying ${migration.file}`);
  runPsql(dbUrl, ["-v", "ON_ERROR_STOP=1", "-f", migration.path], { stdio: "inherit" });
  runPsql(dbUrl, [
    "-v", "ON_ERROR_STOP=1",
    "-c",
    [
      "insert into supabase_migrations.schema_migrations(version, name, statements)",
      `values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, '{}'::text[])`,
      "on conflict (version) do nothing;"
    ].join("\n")
  ]);
}

runSmokeChecks(dbUrl);
console.log("Stage DB migrations are applied and smoke checks passed.");
