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
  const userId = "11111111-1111-4111-8111-111111111111";
  const state = {
    accounts: new Map([
      ["acct-escrow", { id: "acct-escrow", account_type: "ESCROW", system_key: "POKER_TABLE:test", status: "active", balance: 0 }],
    ]),
    userAccountsCreated: 0,
    nextTxId: 1,
  };

  const ensureUser = (id) => {
    const key = `acct-user-${id}`;
    if (!state.accounts.has(key)) {
      state.userAccountsCreated += 1;
      state.accounts.set(key, { id: key, account_type: "USER", user_id: id, status: "active", balance: 500, next_entry_seq: 1 });
    }
    return state.accounts.get(key);
  };

  const executeSql = async (query, params = []) => {
    const text = String(query).toLowerCase();
    if (text.includes("system_key = any")) {
      const keys = params[0] || [];
      return [...state.accounts.values()].filter((a) => keys.includes(a.system_key));
    }
    return [];
  };

  const beginSql = async (fn) => {
    const sqlTx = async (strings, ...values) => {
      const text = String(strings).toLowerCase();
      if (text.includes("insert into public.chips_transactions")) {
        return [{ id: `tx-${state.nextTxId++}`, tx_type: values[5], user_id: values[6], idempotency_key: values[3] }];
      }
      if (text.includes("where id =")) {
        const account = state.accounts.get(values[0]);
        return account ? [{ id: account.id, balance: account.balance, next_entry_seq: account.next_entry_seq || 1 }] : [];
      }
      throw new Error(`Unhandled sql template: ${text}`);
    };
    sqlTx.unsafe = async (query, params = []) => {
      const text = String(query).toLowerCase();
      if (text.includes("account_type = 'user'") && text.includes("for update")) {
        return [{ account: ensureUser(params[0]) }];
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
        const [, payload] = params;
        const inserted = JSON.parse(payload).map((rec, index) => ({ account_id: rec.account_id, amount: rec.amount, entry_seq: index + 1, metadata: rec.metadata || {} }));
        return [{ entries: inserted }];
      }
      throw new Error(`Unhandled sqlTx.unsafe: ${text}`);
    };
    return fn(sqlTx);
  };

  const postTransaction = loadPostTransaction({ beginSql, executeSql, klog: () => {} });
  const result = await postTransaction({
    userId,
    txType: "TABLE_BUY_IN",
    idempotencyKey: "human-buyin-1",
    createdBy: userId,
    entries: [
      { accountType: "USER", amount: -100 },
      { accountType: "ESCROW", systemKey: "POKER_TABLE:test", amount: 100 },
    ],
  });

  assert.equal(result.transaction.user_id, userId);
  assert.equal(state.userAccountsCreated, 1);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.some((entry) => entry.account_id === `acct-user-${userId}` && entry.amount === -100), true);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
