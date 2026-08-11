import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const loadPostTransaction = ({ beginSql, executeSql, klog }) => {
  const source = fs.readFileSync(path.join(process.cwd(), "netlify/functions/_shared/chips-ledger.mjs"), "utf8");
  const strippedImports = source.replace(/^\s*import[^;]+;\s*$/gm, "");
  const rewrittenExports = strippedImports.replace(/export\s*\{[\s\S]*?\};?\s*$/m, "");
  const factory = new Function("crypto", "beginSql", "executeSql", "klog", `"use strict";\n${rewrittenExports}\nreturn { postTransaction };`);
  return factory(crypto, beginSql, executeSql, klog).postTransaction;
};

const run = async () => {
  const state = {
    accounts: new Map([
      ["acct-system", { id: "acct-system", account_type: "SYSTEM", system_key: "TREASURY", status: "active", balance: 10000 }],
      ["acct-escrow", { id: "acct-escrow", account_type: "ESCROW", system_key: "POKER_TABLE:test", status: "active", balance: 0 }],
    ]),
    transactions: [],
    entries: [],
    nextTxId: 1,
    userLookups: 0,
  };

  const executeSql = async (query, params = []) => {
    const text = String(query).toLowerCase();
    if (text.includes("system_key = any")) {
      const keys = params[0] || [];
      return [...state.accounts.values()].filter((a) => keys.includes(a.system_key));
    }
    if (text.includes("from public.chips_transactions") && text.includes("idempotency_key")) {
      const existing = state.transactions.find((tx) => tx.idempotency_key === params[0]);
      return existing ? [existing] : [];
    }
    if (text.includes("with txn as") && text.includes("chips_entries")) {
      const transaction = state.transactions.find((tx) => tx.id === params[0]) || null;
      return [{ transaction, entries: state.entries.filter((entry) => entry.transaction_id === params[0]), account: null }];
    }
    return [];
  };

  const beginSql = async (fn) => {
    const sqlTx = async (strings, ...values) => {
      const text = String(strings).toLowerCase();
      if (text.includes("insert into public.chips_transactions")) {
        if (state.transactions.some((transaction) => transaction.idempotency_key === values[3])) {
          const error = new Error("duplicate key value violates unique constraint chips_transactions_idempotency_key_unique");
          error.code = "23505";
          error.constraint = "chips_transactions_idempotency_key_unique";
          throw error;
        }
        const row = { id: `tx-${state.nextTxId++}`, tx_type: values[5], user_id: values[6], idempotency_key: values[3], payload_hash: values[4] };
        state.transactions.push(row);
        return [row];
      }
      if (text.includes("where id =")) return [];
      throw new Error(`Unhandled sql template: ${text}`);
    };
    sqlTx.unsafe = async (query, params = []) => {
      const text = String(query).toLowerCase();
      if (text.includes("account_type = 'user'") && text.includes("for update")) {
        state.userLookups += 1;
        throw new Error("user account lookup should not run for null user");
      }
      if (text.includes("apply_balance")) {
        const records = JSON.parse(params[0]);
        const deltas = new Map();
        for (const rec of records) deltas.set(rec.account_id, (deltas.get(rec.account_id) || 0) + Number(rec.amount));
        for (const [accountId, delta] of deltas.entries()) {
          const account = state.accounts.get(accountId);
          account.balance += delta;
        }
        return [{ updated_accounts: deltas.size, expected_accounts: deltas.size, guard_ok: true, guard_check: true }];
      }
      if (text.includes("insert into public.chips_entries")) {
        const [transactionId, payload] = params;
        const inserted = JSON.parse(payload).map((rec, index) => ({ transaction_id: transactionId, account_id: rec.account_id, amount: rec.amount, metadata: rec.metadata || {}, entry_seq: index + 1 }));
        state.entries.push(...inserted);
        return [{ entries: inserted }];
      }
      throw new Error(`Unhandled sqlTx.unsafe: ${text}`);
    };
    return fn(sqlTx);
  };

  const postTransaction = loadPostTransaction({ beginSql, executeSql, klog: () => {} });
  const result = await postTransaction({
    userId: null,
    txType: "TABLE_BUY_IN",
    idempotencyKey: "null-user-escrow-only-1",
    createdBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    entries: [
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -200 },
      { accountType: "ESCROW", systemKey: "POKER_TABLE:test", amount: 200 },
    ],
  });

  assert.equal(result.transaction.tx_type, "TABLE_BUY_IN");
  assert.equal(result.transaction.user_id, null);
  assert.equal(result.account, null);
  assert.equal(state.userLookups, 0);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.account_id).sort(), ["acct-escrow", "acct-system"]);

  const cashoutPayload = {
    userId: null,
    txType: "TABLE_CASH_OUT",
    idempotencyKey: "poker:bot-terminal-cashout:v1:test:2:3:bot",
    entries: [
      { accountType: "ESCROW", systemKey: "POKER_TABLE:test", amount: -200 },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: 200 },
    ],
  };
  const cashout = await postTransaction(cashoutPayload);
  const replay = await postTransaction(cashoutPayload);
  assert.equal(cashout.transaction.tx_type, "TABLE_CASH_OUT");
  assert.equal(cashout.transaction.user_id, null);
  assert.equal(replay.transaction.id, cashout.transaction.id);
  assert.equal(state.accounts.get("acct-escrow").balance, 0);
  assert.equal(state.accounts.get("acct-system").balance, 10000);
  assert.equal(state.userLookups, 0);
  assert.equal(cashout.entries.some((entry) => state.accounts.get(entry.account_id)?.account_type === "USER"), false);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
