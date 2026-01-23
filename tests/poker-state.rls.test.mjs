import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));

let targetFile = "";
let content = "";
for (const file of migrationFiles) {
  const text = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  if (text.toLowerCase().includes("alter table public.poker_state enable row level security")) {
    targetFile = file;
    content = text;
    break;
  }
}

assert.ok(targetFile, "poker_state RLS migration not found in supabase/migrations");
const normalized = content.toLowerCase();
assert.equal(
  /create\s+policy[\s\S]*for\s+select[\s\S]*public\.poker_state/.test(normalized),
  false,
  "poker_state RLS migration should not add select policies"
);
