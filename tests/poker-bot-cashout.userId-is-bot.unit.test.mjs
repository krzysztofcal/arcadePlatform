import assert from "node:assert/strict";
import {
  executeTerminalPokerCloseInTx,
  postTerminalBotCashout,
  resolveBotFundingSource,
} from "../shared/poker-domain/terminal-close.mjs";

const tableId = "99999999-9999-4999-8999-999999999999";
const oldBotUserId = "11111111-1111-4111-8111-111111111111";
const replacementBotUserId = "22222222-2222-4222-8222-222222222222";
const sourceAccountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherSourceAccountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function verifyStrictSystemCashout() {
  const calls = [];
  await postTerminalBotCashout({
    postTransaction: async (payload) => {
      calls.push(payload);
      return { transaction: { id: "tx-cashout" } };
    },
    tx: { unsafe: async () => [] },
    tableId,
    toStateVersion: 8,
    botUserId: replacementBotUserId,
    seatNo: 2,
    amount: 100,
    sourceAccountId,
    sourceSystemKey: "TREASURY",
    fundingTransactionIds: ["tx-seed", "tx-replacement"],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, null);
  assert.equal(calls[0].idempotencyKey, `poker:bot-terminal-cashout:v1:${tableId}:8:2:${replacementBotUserId}`);
  assert.deepEqual(calls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -100 },
    { accountType: "SYSTEM", systemKey: "TREASURY", amount: 100 },
  ]);
  assert.equal(calls[0].entries.some((entry) => entry.accountType === "USER"), false);
}

function verifyReplacementLineage() {
  const rows = [
    {
      kind: "seed",
      transactionId: "tx-seed",
      botUserId: oldBotUserId,
      seatNo: 2,
      sourceAccountId,
      sourceSystemKey: "TREASURY",
    },
    {
      kind: "replacement",
      transactionId: "tx-replacement",
      oldBotUserId,
      replacementBotUserId,
      oldStack: 1,
      seatNo: 2,
      sourceAccountId,
      sourceSystemKey: "TREASURY",
    },
  ];
  const resolved = resolveBotFundingSource({ botUserId: replacementBotUserId, seatNo: 2, rows });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.sourceAccountId, sourceAccountId);
  assert.equal(resolved.sourceSystemKey, "TREASURY");
  assert.deepEqual(resolved.fundingTransactionIds, ["tx-replacement", "tx-seed"]);

  const mixed = resolveBotFundingSource({
    botUserId: replacementBotUserId,
    seatNo: 2,
    rows: [rows[0], { ...rows[1], sourceAccountId: otherSourceAccountId, sourceSystemKey: "OTHER_SYSTEM" }],
  });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.code, "terminal_accounting_invariant_failed");
  assert.equal(mixed.reason, "bot_provenance_mixed");

  const missing = resolveBotFundingSource({ botUserId: replacementBotUserId, seatNo: 2, rows: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "terminal_accounting_invariant_failed");
  assert.equal(missing.reason, "bot_provenance_missing");
}

async function verifyClaimsMismatchFailsBeforeMutation() {
  const postCalls = [];
  const mutationQueries = [];
  const humanUserId = "33333333-3333-4333-8333-333333333333";
  const escrowAccountId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const tx = {
    unsafe: async (query) => {
      const sql = String(query).toLowerCase();
      if (sql.startsWith("select id, status from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
      if (sql.startsWith("select version, state from public.poker_state")) {
        return [{ version: 7, state: { seats: [{ userId: humanUserId, seatNo: 1 }], stacks: { [humanUserId]: 10 } } }];
      }
      if (sql.startsWith("select user_id, seat_no, status, is_bot, stack from public.poker_seats")) {
        return [{ user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 10 }];
      }
      if (sql.startsWith("select id, account_type, system_key, status, balance from public.chips_accounts")) {
        return [{ id: escrowAccountId, account_type: "ESCROW", system_key: `POKER_TABLE:${tableId}`, status: "active", balance: 11 }];
      }
      if (sql.startsWith("update") || sql.startsWith("insert") || sql.startsWith("delete")) mutationQueries.push(sql);
      return [];
    },
  };

  const result = await executeTerminalPokerCloseInTx({
    tx,
    tableId,
    postTransaction: async (payload) => postCalls.push(payload),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "terminal_accounting_invariant_failed");
  assert.equal(result.reason, "terminal_claims_mismatch");
  assert.equal(postCalls.length, 0);
  assert.equal(mutationQueries.length, 0);
}

await verifyStrictSystemCashout();
verifyReplacementLineage();
await verifyClaimsMismatchFailsBeforeMutation();
