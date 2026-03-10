import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function hasSupabaseAdminImportFromSnapshot() {
  const snapshot = read("ws-server/poker/table/table-snapshot.mjs");
  return snapshot.includes('from "../../../netlify/functions/_shared/supabase-admin.mjs"');
}

function supabaseAdminImportsPostgres() {
  const admin = read("netlify/functions/_shared/supabase-admin.mjs");
  return admin.includes('import postgres from "postgres"');
}

test("ws-server package declares postgres when table snapshot import chain requires it", () => {
  const pkg = JSON.parse(read("ws-server/package.json"));
  const requiresPostgres = hasSupabaseAdminImportFromSnapshot() && supabaseAdminImportsPostgres();
  if (!requiresPostgres) return;

  const depVersion = pkg?.dependencies?.postgres;
  assert.equal(typeof depVersion, "string", "Packaging contract: ws-server/package.json must declare dependencies.postgres for clean npm ci --prefix ws-server startup path");
  assert.ok(depVersion.trim().length > 0, "Packaging contract: dependencies.postgres must be a non-empty version string");
});
