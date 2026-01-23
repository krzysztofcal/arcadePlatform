import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));

const byName = migrationFiles.find((file) => file.includes("poker_hole_cards"));
let targetFile = byName || "";
let content = "";
if (targetFile) {
  content = fs.readFileSync(path.join(migrationsDir, targetFile), "utf8");
} else {
  for (const file of migrationFiles) {
    const text = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    if (text.toLowerCase().includes("create table public.poker_hole_cards")) {
      targetFile = file;
      content = text;
      break;
    }
  }
}

assert.ok(targetFile, "poker_hole_cards migration not found in supabase/migrations");
const normalized = content.toLowerCase();
assert.ok(normalized.includes("create table public.poker_hole_cards"), "migration should create poker_hole_cards table");
assert.ok(normalized.includes("enable row level security"), "migration should enable row level security");
assert.ok(
  /create\s+policy[\s\S]*for\s+select[\s\S]*auth\.uid\(\)\s*=\s*user_id/.test(normalized),
  "migration should include select policy scoped to auth.uid() = user_id"
);
const hasUniqueConstraint = normalized.includes("unique (table_id, hand_id, user_id)");
const hasUniqueIndex = /unique\s+index[\s\S]*\(\s*table_id\s*,\s*hand_id\s*,\s*user_id\s*\)/.test(normalized);
assert.ok(hasUniqueConstraint || hasUniqueIndex, "migration should enforce unique table_id/hand_id/user_id");
