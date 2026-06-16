import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

const adminHtml = await readFile(path.join(repoRoot, "admin.html"), "utf8");

test("admin page includes admin CSS and JS once", () => {
  assert.equal((adminHtml.match(/href="css\/admin\.css"/g) || []).length, 1);
  assert.equal((adminHtml.match(/src="js\/admin-page\.js"/g) || []).length, 1);
});

test("admin page exposes required admin tabs", () => {
  assert.match(adminHtml, /data-admin-tab="users"/);
  assert.match(adminHtml, /data-admin-tab="tables"/);
  assert.match(adminHtml, /data-admin-tab="ledger"/);
  assert.match(adminHtml, /data-admin-tab="ops"/);
  assert.match(adminHtml, /data-admin-panel="users"/);
  assert.match(adminHtml, /data-admin-panel="tables"/);
  assert.match(adminHtml, /data-admin-panel="ledger"/);
  assert.match(adminHtml, /data-admin-panel="ops"/);
});
