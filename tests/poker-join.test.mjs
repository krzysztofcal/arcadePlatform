import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const joinSrc = read("netlify/functions/poker-join.mjs");
const sharedJoinSrc = read("shared/poker-domain/join.mjs");
const wsJoinAdapterSrc = read("ws-server/poker/persistence/authoritative-join-adapter.mjs");

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
assert.ok(
  sharedJoinSrc.includes("loadStateForUpdate"),
  "shared join core should require injected locked state load helper"
);
assert.ok(
  sharedJoinSrc.includes("updateStateLocked"),
  "shared join core should require injected locked state update helper"
);
assert.ok(
  sharedJoinSrc.includes("validateStateForStorage"),
  "shared join core should require injected storage state validation helper"
);
assert.ok(
  sharedJoinSrc.includes('throw makeError("temporarily_unavailable")'),
  "shared join core should fail closed when locked helpers are missing"
);
assert.ok(
  !sharedJoinSrc.includes('update public.poker_state set state = $2::jsonb where table_id = $1;'),
  "shared join core must not introduce a raw poker_state update contract"
);
assert.ok(
  wsJoinAdapterSrc.includes('isStateStorageValid'),
  "WS authoritative join adapter should reuse the runtime state validator"
);
assert.ok(
  wsJoinAdapterSrc.includes('requireNoDeck: true'),
  "WS authoritative join adapter should use the production storage-validation contract"
);
assert.ok(
  !wsJoinAdapterSrc.includes('validateStateForStorage: () => true'),
  "WS production adapter must not use a no-op state validator"
);
