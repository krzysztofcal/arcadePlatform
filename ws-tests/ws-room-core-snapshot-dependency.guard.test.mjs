import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROOM_CORE_FILE = "ws-server/poker/read-model/room-core-snapshot.mjs";
const TABLE_MANAGER_FILE = "ws-server/poker/table/table-manager.mjs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("room-core snapshot read-model does not depend on netlify shared runtime files", () => {
  const text = read(ROOM_CORE_FILE);
  assert.doesNotMatch(text, /netlify\/functions\/_shared/);
  assert.doesNotMatch(text, /from\s+["'][.]{3,}\//);
});

test("table manager room-core snapshot import stays inside ws-server runtime boundary", () => {
  const text = read(TABLE_MANAGER_FILE);
  assert.match(text, /from\s+["']\.\.\/read-model\/room-core-snapshot\.mjs["']/);
  assert.doesNotMatch(text, /netlify\/functions\/_shared/);
});
