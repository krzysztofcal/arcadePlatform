import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const MIGRATION_RE = /^(\d{14})_([a-z0-9][a-z0-9_]*).sql$/;

function fail(message) {
  console.error(message);
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
if (JSON.stringify(files) !== JSON.stringify(sorted)) {
  fail("Migration directory listing is not lexicographically sorted.");
}

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

console.log(`Validated ${sorted.length} migration files.`);
