import assert from "node:assert/strict";
import { hasActiveHumanGuardSql, tableIdleCutoffExprSql } from "../netlify/functions/_shared/poker-table-lifecycle.mjs";

const run = async () => {
  const canonicalIdle = tableIdleCutoffExprSql({ tableAlias: "t" });
  assert.equal(canonicalIdle.includes("coalesce(t.last_activity_at, t.created_at)"), true);

  const trimmedIdle = tableIdleCutoffExprSql({ tableAlias: "  t  " });
  assert.equal(trimmedIdle, canonicalIdle);

  const injectedIdle = tableIdleCutoffExprSql({ tableAlias: "t;drop table x;--" });
  assert.equal(injectedIdle.toLowerCase().includes("drop table"), false);
  assert.equal(injectedIdle.includes("coalesce(t.last_activity_at, t.created_at)"), true);

  const dottedIdle = tableIdleCutoffExprSql({ tableAlias: "t.id" });
  assert.equal(dottedIdle.includes("t.id.last_activity_at"), false);
  assert.equal(dottedIdle.includes("coalesce(t.last_activity_at, t.created_at)"), true);

  const canonicalGuard = hasActiveHumanGuardSql({ tableAlias: "t" });
  const dottedGuard = hasActiveHumanGuardSql({ tableAlias: "t.id" });
  assert.equal(dottedGuard.includes("hs.table_id = t.id"), true);
  assert.equal(dottedGuard.includes("hs.table_id = t.id.id"), false);
  assert.equal(dottedGuard.includes("coalesce(hs.is_bot, false) = false"), true);
  assert.equal(canonicalGuard.includes("hs.table_id = t.id"), true);

  const injectedGuard = hasActiveHumanGuardSql({ tableAlias: "t; drop table poker_tables;--" });
  assert.equal(injectedGuard.toLowerCase().includes("drop table"), false);
  assert.equal(injectedGuard.includes("hs.table_id = t.id"), true);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
