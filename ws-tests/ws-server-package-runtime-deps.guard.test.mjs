import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("ws table snapshot runtime stays inside ws-server package boundary", () => {
  const snapshot = read("ws-server/poker/table/table-snapshot.mjs");

  assert.doesNotMatch(
    snapshot,
    /from\s+["']\.\.\.\/\.\.\.\/\.\.\.\/netlify\/functions\/_shared\/[^"']+["']/,
    "WS runtime boundary: table-snapshot must not import repo-root netlify/functions/_shared modules"
  );

  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-deal-deterministic\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local deterministic deal helper"
  );
  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-cards-utils\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local card identity helper"
  );
  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-hole-cards-store\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local hole cards store helper"
  );
  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-legal-actions\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local legal actions helper"
  );
  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-state-utils\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local state utils helper"
  );
  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-state-write\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local optimistic state write helper"
  );
  assert.match(
    snapshot,
    /from\s+"\.\.\/snapshot-runtime\/poker-turn-timeout\.mjs"/,
    "WS runtime boundary: table-snapshot must import ws-server local turn-timeout helper"
  );

  assert.equal(
    snapshot.includes('from "../persistence/sql-admin.mjs"'),
    true,
    "WS runtime boundary: table-snapshot must import ws-server local sql-admin helper"
  );
});
