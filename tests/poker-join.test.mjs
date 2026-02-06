import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const joinSrc = read("netlify/functions/poker-join.mjs");

assert.ok(
  /insert into public\.poker_seats[\s\S]*?stack\)[\s\S]*?values \(\$1, \$2, \$3, 'ACTIVE', now\(\), now\(\), \$4\);/.test(joinSrc),
  "join should insert seat stack as buyIn"
);
assert.ok(
  joinSrc.includes("stack = coalesce(stack, $3)"),
  "join should only fill stack on rejoin when null"
);
assert.ok(
  joinSrc.includes("poker_join_stack_persisted"),
  "join should log poker_join_stack_persisted after seat upsert"
);
assert.ok(
  joinSrc.includes("isStateStorageValid"),
  "join should validate poker_state before persisting updates"
);
assert.ok(
  joinSrc.includes("updatePokerStateLocked"),
  "join should use locked state updates for left-flag clearing"
);
assert.ok(
  joinSrc.includes("patchLeftTableByUserId"),
  "join should patch leftTableByUserId using shared helper"
);
