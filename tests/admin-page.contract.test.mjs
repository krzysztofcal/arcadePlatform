import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

const adminHtml = await readFile(path.join(repoRoot, "admin.html"), "utf8");
const adminCss = await readFile(path.join(repoRoot, "css", "admin.css"), "utf8");
const adminJs = await readFile(path.join(repoRoot, "js", "admin-page.js"), "utf8");

test("admin page includes admin CSS and JS once", () => {
  assert.equal((adminHtml.match(/href="css\/admin\.css"/g) || []).length, 1);
  assert.equal((adminHtml.match(/src="js\/admin-page\.js"/g) || []).length, 1);
});

test("admin page exposes required admin tabs", () => {
  assert.match(adminHtml, /data-admin-tab="users"/);
  assert.match(adminHtml, /data-admin-tab="tables"/);
  assert.match(adminHtml, /data-admin-tab="ledger"/);
  assert.match(adminHtml, /data-admin-tab="bonusCampaigns"/);
  assert.match(adminHtml, /data-admin-tab="pokerAudit"/);
  assert.match(adminHtml, /data-admin-tab="ops"/);
  assert.match(adminHtml, /data-admin-panel="users"/);
  assert.match(adminHtml, /data-admin-panel="tables"/);
  assert.match(adminHtml, /data-admin-panel="ledger"/);
  assert.match(adminHtml, /data-admin-panel="bonusCampaigns"/);
  assert.match(adminHtml, /data-admin-panel="pokerAudit"/);
  assert.match(adminHtml, /data-admin-panel="ops"/);
});

test("admin ops exposes the WS Preview bot reaction control", () => {
  assert.match(adminHtml, /id="adminOpsBotReactionSummary"/);
  assert.match(adminHtml, /id="adminOpsBotReactionForm"/);
  assert.match(adminHtml, /id="adminOpsBotReactionDelay"[^>]+min="100"[^>]+max="10000"/);
  assert.match(adminHtml, /id="adminOpsBotReactionApply"/);
  assert.match(adminHtml, /id="adminOpsBotReactionDefault"/);
  assert.match(adminHtml, />WS Preview</);
});

test("admin ops exposes bounded poker DEBUG controls without a log viewer", () => {
  assert.match(adminHtml, /id="adminOpsPokerLogScope"/);
  assert.match(adminHtml, />Table DEBUG</);
  assert.match(adminHtml, />Category DEBUG</);
  assert.match(adminHtml, />Global DEBUG</);
  assert.match(adminHtml, /id="adminOpsPokerLogTable"/);
  assert.match(adminHtml, /id="adminOpsPokerLogManualTable"/);
  assert.match(adminHtml, /id="adminOpsPokerLogTablesRefresh"/);
  assert.match(adminHtml, /id="adminOpsPokerLogTtlPresets"/);
  assert.match(adminHtml, /id="adminOpsPokerLogOverrides"/);
  assert.match(adminHtml, /Active overrides/);
  assert.doesNotMatch(adminHtml, /journalctl/);
});

test("admin ops exposes continuous maintenance and cleanup controls", () => {
  assert.match(adminHtml, /id="adminOpsMaintenance"/);
  assert.match(adminHtml, /id="adminOpsMaintenanceTitle"/);
  assert.match(adminHtml, /Disabling maintenance does not interrupt an active human hand/);
  assert.match(adminJs, /Run cleanup now/);
  assert.match(adminJs, /Reconcile now/);
  assert.match(adminJs, /Next cleanup batch · ordinary rows/);
  assert.match(adminJs, /Next cleanup batch · HAND_SETTLED/);
});

test("admin bonus campaign form exposes campaign type suggestions", () => {
  assert.match(adminHtml, /name="campaignType"[^>]+list="adminBonusCampaignTypeOptions"/);
  assert.match(adminHtml, /<datalist id="adminBonusCampaignTypeOptions">/);
  assert.match(adminHtml, /<option value="daily"><\/option>/);
  assert.match(adminHtml, /<option value="anniversary"><\/option>/);
  assert.match(adminHtml, /<option value="retention"><\/option>/);
  assert.match(adminHtml, /<option value="compensation"><\/option>/);
  assert.match(adminHtml, /<option value="event"><\/option>/);
});

test("admin bonus campaign form exposes draft templates and policy hint", () => {
  assert.match(adminHtml, /data-bonus-template="welcome"/);
  assert.match(adminHtml, /data-bonus-template="daily"/);
  assert.match(adminHtml, /data-bonus-template="anniversary"/);
  assert.match(adminHtml, /data-bonus-template="compensation"/);
  assert.match(adminHtml, /Daily means once per UTC day/);
});

test("admin bonus campaign form constrains code input and keeps save actions reachable", () => {
  assert.match(adminHtml, /name="code"[^>]+pattern="\[a-z0-9\]\[a-z0-9_-\]\*"/);
  assert.match(adminHtml, /name="code"[^>]+autocomplete="off"/);
  assert.match(adminHtml, /admin-form-actions/);
  assert.match(adminCss, /\.admin-card--detail[^}]*max-height:calc\(100dvh/);
  assert.match(adminCss, /\.admin-card--detail[^}]*overflow-y:auto/);
  assert.match(adminCss, /\.admin-form-actions[^}]*position:sticky/);
});
