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
    registry: new Map(),
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
    if (text.includes("from public.chips_transaction_idempotency")) {
      const record = state.registry.get(params[0]);
      return record ? [record] : [];
    }
    if (text.includes("from public.chips_accounts") && text.includes("where user_id")) {
      const account = [...state.accounts.values()].find((entry) => entry.user_id === params[0]);
      return account ? [{ id: account.id, balance: account.balance, next_entry_seq: account.next_entry_seq || 1 }] : [];
    }
    return [];
  };

  const beginSql = async (fn) => {
    const sqlTx = async (strings, ...values) => {
      const text = String(strings).toLowerCase();
      if (text.includes("insert into public.chips_transactions")) {
        const row = { id: `tx-${state.nextTxId++}`, tx_type: values[5], user_id: values[6], idempotency_key: values[3], payload_hash: values[4] };
        state.registry.set(row.idempotency_key, {
          idempotency_key: row.idempotency_key,
          transaction_id: row.id,
          payload_hash: row.payload_hash,
          tx_type: row.tx_type,
          user_id: row.user_id,
          transaction_created_at: null,
        });
        return [row];
      }
      if (text.includes("where id =")) {
        const account = state.accounts.get(values[0]);
        return account ? [{ id: account.id, balance: account.balance, next_entry_seq: account.next_entry_seq || 1 }] : [];
      }
      throw new Error(`Unhandled sql template: ${text}`);
    };
    sqlTx.unsafe = async (query, params = []) => {
      const text = String(query).toLowerCase();
      if (text.includes("system_key = any")) return executeSql(query, params);
      if (text.startsWith("savepoint") || text.startsWith("release savepoint") || text.startsWith("rollback to savepoint")) return [];
      if (text.includes("update public.chips_transaction_idempotency")) {
        const record = state.registry.get(params[0]);
        if (record) {
          record.replay_transaction = JSON.parse(params[1]);
          record.replay_entries = JSON.parse(params[2]);
          record.replay_completed_at = new Date().toISOString();
        }
        return record ? [record] : [];
      }
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
      if (text.includes("from public.chips_transaction_idempotency")) {
        const record = state.registry.get(params[0]);
        return record ? [record] : [];
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
  assert.equal(result.account?.id, `acct-user-${userId}`);
  assert.equal(state.userAccountsCreated, 1);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.some((entry) => entry.account_id === `acct-user-${userId}` && entry.amount === -100), true);
  const replay = await postTransaction({
    userId,
    txType: "TABLE_BUY_IN",
    idempotencyKey: "human-buyin-1",
    createdBy: userId,
    entries: [
      { accountType: "USER", amount: -100 },
      { accountType: "ESCROW", systemKey: "POKER_TABLE:test", amount: 100 },
    ],
  });
  assert.equal(replay.transaction.id, result.transaction.id);
  assert.deepEqual(replay.entries, []);
  assert.equal(replay.account, null);
  assert.equal(state.userAccountsCreated, 1);
  // #1042: canonical BURN uses the caller transaction and only USER -> GENESIS.
  state.accounts.set('acct-genesis', { id: 'acct-genesis', account_type: 'SYSTEM', system_key: 'GENESIS', status: 'active', balance: -1000 });
  const burn = { userId, txType: 'BURN', idempotencyKey: 'gift-burn-1', createdBy: userId,
    entries: [{ accountType: 'USER', userId, amount: -25 }, { accountType: 'SYSTEM', systemKey: 'GENESIS', amount: 25 }] };
  const beforeUser = state.accounts.get(`acct-user-${userId}`).balance;
  const beforeEscrow = state.accounts.get('acct-escrow').balance;
  const first = await beginSql((tx) => postTransaction({ ...burn, tx }));
  assert.equal(first.transaction.tx_type, 'BURN');
  assert.deepEqual(first.entries.map(entry => [entry.account_id, entry.amount]), [[`acct-user-${userId}`, -25], ['acct-genesis', 25]]);
  assert.equal(first.entries.reduce((sum, entry) => sum + entry.amount, 0), 0);
  assert.equal(state.accounts.get(`acct-user-${userId}`).balance, beforeUser - 25);
  assert.equal(state.accounts.get('acct-genesis').balance, -975);
  assert.equal(state.accounts.get('acct-escrow').balance, beforeEscrow);
};

const runSavepointIsolationTests = async () => {
  const { postTransaction: wsPostTransaction } = await import("../ws-server/poker/persistence/chips-ledger.mjs");
  const netlifyPostTransaction = loadPostTransaction({
    beginSql: async (fn) => fn({}),
    executeSql: async () => [],
    klog: () => {}
  });

  const createScopeHarness = () => {
    let nextTxId = 1;
    let savepoints = 0;
    const accounts = new Map([
      ["acct-human", { id: "acct-human", user_id: "00000000-0000-4000-8000-000000000999", account_type: "USER", status: "active", balance: 500, next_entry_seq: 1 }],
      ["acct-escrow", { id: "acct-escrow", system_key: "POKER_TABLE:sp-test", account_type: "ESCROW", status: "active", balance: 0, next_entry_seq: 1 }],
      ["acct-slow-bankroll", { id: "acct-slow-bankroll", system_key: "POKER_BOT_SLOW_BANKROLL_500", account_type: "SYSTEM", status: "active", balance: 0, next_entry_seq: 1 }],
    ]);
    const registry = new Map();

    const makeScope = (name) => {
      let scopeUncaughtError = null;
      const scopeSql = async (strings, ...values) => {
        const text = String(strings).toLowerCase();
        if (text.includes("insert into public.chips_transactions")) {
          const row = {
            id: `tx-${nextTxId++}`,
            tx_type: values[5],
            user_id: values[6],
            idempotency_key: values[3],
            payload_hash: values[4],
          };
          registry.set(row.idempotency_key, {
            idempotency_key: row.idempotency_key,
            transaction_id: row.id,
            payload_hash: row.payload_hash,
            tx_type: row.tx_type,
            user_id: row.user_id,
          });
          return [row];
        }
        if (text.includes("where id =")) {
          const account = accounts.get(values[0]);
          return account ? [{ id: account.id, balance: account.balance, next_entry_seq: 1 }] : [];
        }
        throw new Error(`Unhandled scopeSql template: ${text}`);
      };

      scopeSql.unsafe = async (query, params = []) => {
        const text = String(query).toLowerCase();
        if (text.startsWith("savepoint") || text.startsWith("release savepoint") || text.startsWith("rollback to savepoint")) return [];
        if (text.includes("system_key = any")) {
          const keys = params[0] || [];
          return [...accounts.values()].filter((a) => keys.includes(a.system_key));
        }
        if (text.includes("account_type = 'user'") && text.includes("for update")) {
          return [{ account: accounts.get("acct-human") }];
        }
        if (text.includes("insert into public.chips_transactions")) {
          const row = {
            id: `tx-${nextTxId++}`,
            tx_type: params[5],
            user_id: params[6],
            idempotency_key: params[3],
            payload_hash: params[4],
          };
          registry.set(row.idempotency_key, {
            idempotency_key: row.idempotency_key,
            transaction_id: row.id,
            payload_hash: row.payload_hash,
            tx_type: row.tx_type,
            user_id: row.user_id,
          });
          return [row];
        }
        if (text.includes("apply_balance")) {
          const records = JSON.parse(params[0]);
          for (const rec of records) {
            const account = accounts.get(rec.account_id);
            if (account && account.balance + Number(rec.amount) < 0) {
              const err = new Error("insufficient_funds");
              err.code = "P0001";
              scopeUncaughtError = scopeUncaughtError || err;
              throw err;
            }
          }
          for (const rec of records) {
            const account = accounts.get(rec.account_id);
            if (account) account.balance += Number(rec.amount);
          }
          return [{ updated_accounts: records.length, expected_accounts: records.length, guard_ok: true, guard_check: true }];
        }
        if (text.includes("insert into public.chips_entries")) {
          const payload = params[1] || params[0];
          const inserted = JSON.parse(payload).map((rec, index) => ({ account_id: rec.account_id, amount: rec.amount, entry_seq: index + 1 }));
          return [{ entries: inserted }];
        }
        if (text.includes("from public.chips_transaction_idempotency")) {
          const record = registry.get(params[0]);
          return record ? [record] : [];
        }
        if (text.includes("where user_id =") && text.includes("chips_accounts")) {
          const account = [...accounts.values()].find((entry) => entry.user_id === params[0]);
          return account ? [{ id: account.id, balance: account.balance, next_entry_seq: 1 }] : [];
        }
        if (text.includes("where id =") && text.includes("chips_accounts")) {
          const account = accounts.get(params[0]);
          return account ? [{ id: account.id, balance: account.balance, next_entry_seq: 1 }] : [];
        }
        if (text.includes("dummy_query_after_recovery")) {
          return [{ ok: true }];
        }
        throw new Error(`Unhandled scopeSql.unsafe: ${text}`);
      };

      scopeSql.savepoint = async (spName, fn) => {
        const childScope = makeScope("s" + savepoints++ + "_" + (spName || "sp"));
        return await childScope.execute(fn);
      };

      return {
        sql: scopeSql,
        execute: async (fn) => {
          let outcome;
          try {
            outcome = await fn(scopeSql);
            if (scopeUncaughtError) throw scopeUncaughtError;
          } catch (e) {
            throw e;
          }
          return outcome;
        },
        hasUncaughtError: () => Boolean(scopeUncaughtError)
      };
    };

    return {
      root: makeScope("root"),
      accounts,
      registry
    };
  };

  // Test 1: ws-server postTransaction savepoint isolation
  {
    const harness = createScopeHarness();
    let caughtError = null;

    const txResult = await harness.root.execute(async (tx) => {
      // 1. Human TABLE_BUY_IN succeeds
      await wsPostTransaction({
        userId: "00000000-0000-4000-8000-000000000999",
        txType: "TABLE_BUY_IN",
        idempotencyKey: "sp-human-buyin",
        entries: [
          { accountType: "USER", userId: "00000000-0000-4000-8000-000000000999", amount: -500 },
          { accountType: "ESCROW", systemKey: "POKER_TABLE:sp-test", amount: 500 }
        ],
        tx
      });

      // 2. Bot funding fails with insufficient_funds inside caller-owned savepoint
      try {
        await tx.savepoint("bot_funding_sp", async (spTx) => {
          await wsPostTransaction({
            userId: null,
            txType: "TABLE_BUY_IN",
            idempotencyKey: "sp-bot-buyin-fail",
            createdBy: "00000000-0000-4000-8000-000000000999",
            entries: [
              { accountType: "SYSTEM", systemKey: "POKER_BOT_SLOW_BANKROLL_500", amount: -500 },
              { accountType: "ESCROW", systemKey: "POKER_TABLE:sp-test", amount: 500 }
            ],
            tx: spTx
          });
        });
      } catch (err) {
        caughtError = err;
      }

      // 3. Caller continues on outer transaction after recovering from bot failure
      const subsequent = await tx.unsafe("select 1 as dummy_query_after_recovery;");
      assert.equal(subsequent?.[0]?.ok, true);

      return { ok: true };
    });

    assert.equal(txResult.ok, true);
    assert.equal(caughtError?.message?.includes("insufficient_funds"), true);
    assert.equal(harness.root.hasUncaughtError(), false, "root transaction scope has zero uncaughtError");
    assert.equal(harness.accounts.get("acct-human").balance, 0, "human balance correctly debited");
    assert.equal(harness.accounts.get("acct-escrow").balance, 500, "escrow balance correctly credited");
    assert.equal(harness.accounts.get("acct-slow-bankroll").balance, 0, "depleted bankroll remains 0");
  }

  // Test 2: netlify postTransaction savepoint isolation
  {
    const harness = createScopeHarness();
    let caughtError = null;

    const txResult = await harness.root.execute(async (tx) => {
      // 1. Human TABLE_BUY_IN succeeds
      await netlifyPostTransaction({
        userId: "00000000-0000-4000-8000-000000000999",
        txType: "TABLE_BUY_IN",
        idempotencyKey: "sp-netlify-human-buyin",
        entries: [
          { accountType: "USER", userId: "00000000-0000-4000-8000-000000000999", amount: -500 },
          { accountType: "ESCROW", systemKey: "POKER_TABLE:sp-test", amount: 500 }
        ],
        tx
      });

      // 2. Bot funding fails with insufficient_funds inside caller-owned savepoint
      try {
        await tx.savepoint("bot_funding_sp", async (spTx) => {
          await netlifyPostTransaction({
            userId: null,
            txType: "TABLE_BUY_IN",
            idempotencyKey: "sp-netlify-bot-buyin-fail",
            createdBy: "00000000-0000-4000-8000-000000000999",
            entries: [
              { accountType: "SYSTEM", systemKey: "POKER_BOT_SLOW_BANKROLL_500", amount: -500 },
              { accountType: "ESCROW", systemKey: "POKER_TABLE:sp-test", amount: 500 }
            ],
            tx: spTx
          });
        });
      } catch (err) {
        caughtError = err;
      }

      // 3. Caller continues on outer transaction after recovering from bot failure
      const subsequent = await tx.unsafe("select 1 as dummy_query_after_recovery;");
      assert.equal(subsequent?.[0]?.ok, true);

      return { ok: true };
    });

    assert.equal(txResult.ok, true);
    assert.equal(caughtError?.message?.includes("insufficient_funds"), true);
    assert.equal(harness.root.hasUncaughtError(), false, "root transaction scope has zero uncaughtError");
    assert.equal(harness.accounts.get("acct-human").balance, 0, "human balance correctly debited");
    assert.equal(harness.accounts.get("acct-escrow").balance, 500, "escrow balance correctly credited");
    assert.equal(harness.accounts.get("acct-slow-bankroll").balance, 0, "depleted bankroll remains 0");
  }
};

run()
  .then(() => runSavepointIsolationTests())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
