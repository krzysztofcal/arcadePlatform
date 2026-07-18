import test from "node:test";
import assert from "node:assert/strict";
import { hashActionCommand, normalizeActionCommand, projectDurableActionResult } from "./action-command.mjs";

const base = { tableId: " table-1 ", userId: " user-1 ", handId: " hand-1 ", action: "raise", amount: 20 };

test("action payload hash excludes request identity and changes with command payload", () => {
  const hash = hashActionCommand(base);
  assert.equal(hash.length, 64);
  assert.equal(hashActionCommand({ ...base, requestId: "request-a" }), hashActionCommand({ ...base, requestId: "request-b" }));
  assert.notEqual(hashActionCommand({ ...base, amount: 21 }), hash);
  assert.notEqual(hashActionCommand({ ...base, action: "BET" }), hash);
  assert.notEqual(hashActionCommand({ ...base, handId: "hand-2" }), hash);
});

test("action normalization removes irrelevant amounts and rejects invalid amount actions", () => {
  assert.deepEqual(normalizeActionCommand({ ...base, action: "CHECK", amount: 999 }), {
    kind: "ACT",
    tableId: "table-1",
    userId: "user-1",
    handId: "hand-1",
    action: "CHECK",
    amount: null
  });
  assert.equal(normalizeActionCommand({ ...base, amount: 1.5 }), null);
  assert.equal(normalizeActionCommand({ ...base, action: "ALL_IN" }), null);
});

test("durable result projection keeps only the accepted result allowlist", () => {
  assert.deepEqual(projectDurableActionResult({ status: "accepted", handId: "h1", stateVersion: 4, ignored: "secret" }), {
    status: "accepted",
    reason: null,
    handId: "h1",
    stateVersion: 4
  });
  assert.equal(projectDurableActionResult({ status: "rejected", handId: "h1", stateVersion: 4 }), null);
});
