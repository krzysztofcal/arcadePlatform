import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("ws table snapshot runtime stays inside ws-server package boundary", () => {
  const snapshot = read("ws-server/poker/table/table-snapshot.mjs");
  assert.equal(
    snapshot.includes('from "../../../netlify/functions/_shared/supabase-admin.mjs"'),
    false,
    "WS runtime boundary: table-snapshot must not import repo-root netlify/functions/_shared/supabase-admin.mjs"
  );

  assert.equal(
    snapshot.includes('from "../persistence/sql-admin.mjs"'),
    true,
    "WS runtime boundary: table-snapshot must import ws-server local sql-admin helper"
  );
});
