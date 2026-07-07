import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadLocalMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) fail(`Missing migrations directory: ${MIGRATIONS_DIR}`);
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = file.match(MIGRATION_RE);
      if (!match) fail(`Invalid migration filename: ${file}`);
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, "utf8");
      return {
        file,
        version: match[1],
        name: match[2],
        path: fullPath,
        sha256: sha256(sql)
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
      ");",
      "create table if not exists supabase_migrations.schema_migration_files (",
      "  version text primary key,",
      "  name text,",
      "  file text,",
      "  sha256 text not null,",
      "  recorded_at timestamptz not null default timezone('utc', now())",
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

function readRemoteMigrationHashes(dbUrl) {
  const output = runPsql(dbUrl, [
    "-v", "ON_ERROR_STOP=1",
    "-At",
    "-F", "\t",
    "-c",
    "select version, sha256 from supabase_migrations.schema_migration_files order by version;"
  ]);
  const hashes = new Map();
  for (const line of output.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
    const [version, hash] = line.split("\t");
    if (version && hash) hashes.set(version, hash);
  }
  return hashes;
}

function recordMigrationHashes(dbUrl, migrations, { updateExisting = false } = {}) {
  for (const migration of migrations) {
    const conflictSql = updateExisting
      ? [
          "on conflict (version) do update set",
          "  name = excluded.name,",
          "  file = excluded.file,",
          "  sha256 = excluded.sha256,",
          "  recorded_at = timezone('utc', now());"
        ].join("\n")
      : "on conflict (version) do nothing;";
    runPsql(dbUrl, [
      "-v", "ON_ERROR_STOP=1",
      "-c",
      [
        "insert into supabase_migrations.schema_migration_files(version, name, file, sha256)",
        `values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(migration.file)}, ${sqlLiteral(migration.sha256)})`,
        conflictSql
      ].join("\n")
    ]);
  }
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
    "  if not exists (select 1 from public.chips_accounts where account_type = 'SYSTEM' and system_key = 'GENESIS') then raise exception 'missing SYSTEM/GENESIS account'; end if;",
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
let remoteHashes = readRemoteMigrationHashes(dbUrl);
const changedAppliedMigrations = readChangedMigrationVersions(changedFrom)
  .filter((migration) => remoteSet.has(migration.version))
  .map((migration) => localByVersion.get(migration.version) || migration);
const changedAppliedMissingHashes = changedAppliedMigrations
  .filter((migration) => !remoteHashes.has(migration.version));
if (changedAppliedMissingHashes.length) {
  fail([
    "Stage already has this migration version but no recorded contents hash; bump timestamp or reset/recreate stage.",
    ...changedAppliedMissingHashes.map((migration) => "- " + migration.file + " (" + migration.version + ")")
  ].join("\n"));
}

const missingHashMigrations = remoteVersions
  .filter((version) => localByVersion.has(version) && !remoteHashes.has(version))
  .map((version) => localByVersion.get(version));
if (missingHashMigrations.length) {
  console.log(`Recording hashes for ${missingHashMigrations.length} already-applied migration(s).`);
  recordMigrationHashes(dbUrl, missingHashMigrations);
  remoteHashes = readRemoteMigrationHashes(dbUrl);
}

const changedAppliedMismatches = changedAppliedMigrations
  .filter((migration) => remoteHashes.has(migration.version) && remoteHashes.get(migration.version) !== migration.sha256);
if (changedAppliedMismatches.length) {
  fail([
    "Stage already has this migration version with different contents; bump timestamp or reset/recreate stage.",
    ...changedAppliedMismatches.map((migration) => "- " + migration.file + " (" + migration.version + ")")
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
  recordMigrationHashes(dbUrl, [migration], { updateExisting: true });
}

runSmokeChecks(dbUrl);
console.log("Stage DB migrations are applied and smoke checks passed.");
