import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const PRODUCTION_MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "production-migrations");
const MIGRATION_RE = /^(\d{14})_([a-z0-9][a-z0-9_]*).sql$/;
const PRODUCTION_MANIFEST = path.join(PRODUCTION_MIGRATIONS_DIR, "manifest.json");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  fail(`Missing migrations directory: ${MIGRATIONS_DIR}`);
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
if (files.length === 0) {
  fail("No SQL migrations found.");
}

const sorted = files.slice().sort();
const seenVersions = new Set();
const seenNames = new Set();

for (const file of sorted) {
  const match = file.match(MIGRATION_RE);
  if (!match) {
    fail(`Invalid migration filename: ${file}. Expected 14 digits, underscore, snake_case name, .sql`);
  }

  const [, version, name] = match;
  if (seenVersions.has(version)) {
    fail(`Duplicate migration version: ${version}`);
  }
  seenVersions.add(version);

  if (seenNames.has(name)) {
    fail(`Duplicate migration name: ${name}`);
  }
  seenNames.add(name);

  const fullPath = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(fullPath, "utf8");
  if (!sql.trim()) {
    fail(`Empty migration file: ${file}`);
  }
  if (/\r/.test(sql)) {
    fail(`Migration uses CRLF line endings: ${file}`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateProductionManifest() {
  if (!fs.existsSync(PRODUCTION_MANIFEST)) fail(`Missing Production migration manifest: ${PRODUCTION_MANIFEST}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(PRODUCTION_MANIFEST, "utf8"));
  } catch (error) {
    fail(`Invalid Production migration manifest: ${error.message}`);
  }
  if (manifest.source_main_commit !== "f7983d78333b51a393c0e9a6d3dfe48ce1224c74") {
    fail("Production migration manifest must be tied to the reviewed main commit");
  }
  if (manifest.production_target?.project_ref !== "otbqfijerkieoxwpxjnm"
    || manifest.production_target?.system_identifier !== "7575202818581710058") {
    fail("Production migration manifest has the wrong canonical identity");
  }
  const baseline = Array.isArray(manifest.baseline_applied) ? manifest.baseline_applied : [];
  const missing = Array.isArray(manifest.missing) ? manifest.missing : [];
  if (baseline.length !== 54 || missing.length !== 43) fail("Production migration manifest must contain 54 baseline and 43 missing entries");
  const expectedSourceFiles = [...sorted];
  const manifestSourceFiles = [...baseline, ...missing].map((entry) => entry?.file).sort();
  if (JSON.stringify(manifestSourceFiles) !== JSON.stringify(expectedSourceFiles)) {
    fail("Production migration manifest is not exhaustive for supabase/migrations");
  }
  const expectedBaseline = sorted.slice(0, 54);
  if (JSON.stringify(baseline.map((entry) => entry.file)) !== JSON.stringify(expectedBaseline)) {
    fail("Production migration manifest baseline does not match the first 54 Production migrations");
  }
  const categories = new Set(["shared-safe", "stage-only", "needs-production-equivalent"]);
  const seen = new Set();
  for (const entry of [...baseline.map((value) => ({ ...value, category: "baseline-applied" })), ...missing]) {
    if (!entry || typeof entry.file !== "string" || seen.has(entry.file)) fail("Production migration manifest contains a duplicate or invalid source file");
    seen.add(entry.file);
    const sourcePath = path.join(MIGRATIONS_DIR, entry.file);
    if (!fs.existsSync(sourcePath) || entry.sha256 !== sha256(sourcePath)) fail(`Production migration source hash mismatch: ${entry.file}`);
    if (!/^\d{14}$/.test(entry.version) || entry.version !== entry.file.slice(0, 14)) fail(`Invalid Production migration source version: ${entry.file}`);
    if (entry.category !== "baseline-applied" && !categories.has(entry.category)) fail(`Invalid Production migration category: ${entry.file}`);
  }
  const counts = Object.fromEntries([...categories].map((category) => [category, missing.filter((entry) => entry.category === category).length]));
  if (counts["shared-safe"] !== 18 || counts["stage-only"] !== 3 || counts["needs-production-equivalent"] !== 22) {
    fail(`Production migration categories must be 18/3/22, got ${JSON.stringify(counts)}`);
  }
  const productionFiles = fs.existsSync(PRODUCTION_MIGRATIONS_DIR)
    ? fs.readdirSync(PRODUCTION_MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()
    : [];
  if (productionFiles.length !== 2) fail("Production migration directory must contain exactly E1 and E2");
  const replacementNames = new Set(productionFiles);
  for (const required of [
    "20260914090000_chips_ledger_production_retention_contract.sql",
    "20260914091000_chips_ledger_production_table_fence_activation.sql",
  ]) {
    if (!replacementNames.has(required)) fail(`Missing Production replacement migration: ${required}`);
    const match = required.match(MIGRATION_RE);
    if (!match) fail(`Invalid Production replacement migration filename: ${required}`);
    const sql = fs.readFileSync(path.join(PRODUCTION_MIGRATIONS_DIR, required), "utf8");
    if (!sql.trim() || /\r/.test(sql)) fail(`Invalid Production replacement migration content: ${required}`);
  }
  const replacements = Array.isArray(manifest.replacement_migrations) ? manifest.replacement_migrations : [];
  for (const required of productionFiles) {
    const replacement = replacements.find((entry) => entry?.file === required);
    if (!replacement || replacement.sha256 !== sha256(path.join(PRODUCTION_MIGRATIONS_DIR, required))) {
      fail(`Production replacement hash is missing or stale: ${required}`);
    }
  }
  process.stdout.write(`Validated ${sorted.length} migration files and ${productionFiles.length} Production replacements.\n`);
}

validateProductionManifest();
