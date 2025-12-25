import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLog = vi.fn();

const mockDb = {
  accounts: new Map(),
  transactions: new Map(),
  entries: [],
  nextAccountId: 1,
  nextTransactionId: 1,
};

const createId = (prefix, counter) => `${prefix}-${counter}`;

function resetMockDb() {
  mockDb.accounts.clear();
  mockDb.transactions.clear();
  mockDb.entries.length = 0;
  mockDb.nextAccountId = 1;
  mockDb.nextTransactionId = 1;
  // bootstrap a treasury system account to satisfy ledger posts
  const treasury = {
    id: createId("acct", mockDb.nextAccountId++),
    account_type: "SYSTEM",
    system_key: "TREASURY",
    status: "active",
    balance: 0,
    next_entry_seq: 1,
  };
  mockDb.accounts.set(treasury.id, treasury);
}

resetMockDb();

const ensureUserAccount = (userId) => {
  for (const account of mockDb.accounts.values()) {
    if (account.account_type === "USER" && account.user_id === userId) {
      return account;
    }
  }
  const account = {
    id: createId("acct", mockDb.nextAccountId++),
    account_type: "USER",
    user_id: userId,
    status: "active",
    balance: 0,
    next_entry_seq: 1,
  };
  mockDb.accounts.set(account.id, account);
  return account;
};

function normalizeQueryText(query) {
  if (typeof query === "string") return query;
  if (Array.isArray(query)) return query.join("");
  if (query?.raw) return String.raw(query);
  return String(query);
}

function handleLedgerQuery(query, params = []) {
  const text = normalizeQueryText(query);

  if (text.includes("chips_accounts where user_id") && text.includes("account_type = 'USER'")) {
    const userId = params[0];
    const account = ensureUserAccount(userId);
    return [{ account }];
  }

  if (text.includes("system_key = any")) {
    const keys = params[0] || [];
    return [...mockDb.accounts.values()].filter(acc => keys.includes(acc.system_key));
  }

  if (text.includes("chips_transactions where idempotency_key")) {
    const key = params[0];
    const existing = [...mockDb.transactions.values()].find(tx => tx.idempotency_key === key);
    return existing ? [existing] : [];
  }

  if (text.includes("from public.chips_entries e") && text.includes("chips_transactions")) {
    const [accountId, afterSeq, limit] = params;
    const entries = mockDb.entries
      .filter(entry => entry.account_id === accountId && (afterSeq == null || entry.entry_seq > afterSeq))
      .sort((a, b) => a.entry_seq - b.entry_seq)
      .slice(0, limit ?? 50)
      .map(entry => {
        const tx = mockDb.transactions.get(entry.transaction_id);
        return {
          entry_seq: entry.entry_seq,
          amount: entry.amount,
          metadata: entry.metadata,
          created_at: entry.created_at,
          tx_type: tx?.tx_type ?? null,
          reference: tx?.reference ?? null,
          description: tx?.description ?? null,
          idempotency_key: tx?.idempotency_key ?? null,
          tx_created_at: tx?.created_at ?? null,
        };
      });
    return entries;
  }

  if (text.includes("with txn as") && text.includes("chips_entries")) {
    const [txId, userId] = params;
    const transaction = mockDb.transactions.get(txId) || null;
    const entries = mockDb.entries
      .filter(entry => entry.transaction_id === txId)
      .sort((a, b) => a.entry_seq - b.entry_seq);
    let account = null;
    if (userId) {
      account = [...mockDb.accounts.values()].find(acc => acc.user_id === userId && acc.account_type === "USER") || null;
    } else if (transaction?.user_id) {
      account = [...mockDb.accounts.values()].find(
        acc => acc.user_id === transaction.user_id && acc.account_type === "USER",
      ) || null;
    }
    return [{ transaction, entries, account }];
  }

  if (text.includes("from public.chips_accounts") && text.includes("where id =")) {
    const accountId = params[0];
    const account = mockDb.accounts.get(accountId);
    return account ? [{ id: account.id, balance: account.balance, next_entry_seq: account.next_entry_seq }] : [];
  }

  throw new Error(`Unhandled query in mock: ${text}`);
}

function applyEntries(entriesPayload) {
  const records = JSON.parse(entriesPayload);
  const deltas = new Map();
  for (const record of records) {
    const current = deltas.get(record.account_id) || 0;
    deltas.set(record.account_id, current + Number(record.amount || 0));
  }

  for (const [accountId, delta] of deltas.entries()) {
    const account = mockDb.accounts.get(accountId);
    if (!account) {
      const missing = new Error("missing_account");
      missing.code = "missing_account";
      missing.status = 400;
      throw missing;
    }
    const isGenesis = account.account_type === "SYSTEM" && account.system_key === "GENESIS";
    if (!isGenesis && account.balance + delta < 0) {
      const insufficient = new Error("insufficient_funds");
      insufficient.code = "P0001";
      throw insufficient;
    }
  }

  for (const [accountId, delta] of deltas.entries()) {
    const account = mockDb.accounts.get(accountId);
    account.balance += delta;
  }

  return { updated_accounts: deltas.size, expected_accounts: deltas.size, guard_ok: true, guard_check: true };
}

function insertEntries(transactionId, entriesPayload) {
  const records = JSON.parse(entriesPayload);
  const inserted = [];
  for (const record of records) {
    const account = mockDb.accounts.get(record.account_id);
    const entrySeq = account.next_entry_seq || 1;
    const entry = {
      transaction_id: transactionId,
      account_id: record.account_id,
      amount: Number(record.amount),
      metadata: record.metadata ?? {},
      system_key: record.system_key ?? null,
      entry_seq: entrySeq,
      created_at: new Date().toISOString(),
    };
    account.next_entry_seq = entrySeq + 1;
    mockDb.entries.push(entry);
    inserted.push(entry);
  }
  return inserted;
}

function makeTxRunner() {
  const runQuery = async (query, params = []) => {
    const text = normalizeQueryText(query);

    if (text.includes("insert into public.chips_transactions")) {
      const [reference, description, metadataJson, idempotencyKey, payloadHash, txType, userId, createdBy] = params;
      const existing = [...mockDb.transactions.values()].find(tx => tx.idempotency_key === idempotencyKey);
      if (existing) {
        const duplicate = new Error("duplicate key value violates unique constraint\n");
        duplicate.code = "23505";
        duplicate.constraint = "chips_transactions_idempotency_key_uidx";
        throw duplicate;
      }
      const txRow = {
        id: createId("tx", mockDb.nextTransactionId++),
        reference,
        description,
        metadata: metadataJson,
        idempotency_key: idempotencyKey,
        payload_hash: payloadHash,
        tx_type: txType,
        user_id: userId,
        created_by: createdBy,
        created_at: new Date().toISOString(),
      };
      mockDb.transactions.set(txRow.id, txRow);
      return [txRow];
    }

    if (text.includes("update public.chips_accounts a") && text.includes("apply_balance")) {
      const result = applyEntries(params[0]);
      return [result];
    }

    if (text.includes("insert into public.chips_entries")) {
      const inserted = insertEntries(params[0], params[1]);
      return [{ entries: inserted }];
    }

    return handleLedgerQuery(text, params);
  };

  const tx = (...args) => runQuery(...args);
  tx.unsafe = runQuery;
  return tx;
}

vi.mock("../netlify/functions/_shared/supabase-admin.mjs", () => {
  const baseHeaders = () => ({ "content-type": "application/json" });
  const corsHeaders = () => baseHeaders();
  const extractBearerToken = headers => {
    const headerValue = headers?.authorization || headers?.Authorization;
    if (!headerValue || typeof headerValue !== "string") return null;
    const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
    return match ? match[1] : null;
  };
  const verifySupabaseJwt = vi.fn(async (token) => {
    if (!token) return { provided: false, valid: false, userId: null, reason: "missing_token" };
    return { provided: true, valid: true, userId: token, reason: "ok" };
  });

  const beginSql = async (fn) => fn(makeTxRunner());
  const executeSql = async (query, params) => handleLedgerQuery(query, params);

  return {
    baseHeaders,
    corsHeaders,
    extractBearerToken,
    verifySupabaseJwt,
    beginSql,
    executeSql,
    klog: mockLog,
    __mockDb: mockDb,
    __resetMockDb: resetMockDb,
  };
});

async function loadLedger() {
  const mod = await import("../netlify/functions/_shared/chips-ledger.mjs");
  return { postTransaction: mod.postTransaction, listUserLedger: mod.listUserLedger };
}

async function loadTxHandler() {
  const mod = await import("../netlify/functions/chips-tx.mjs");
  return { handler: mod.handler };
}

describe("chips ledger idempotency and validation", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.mockClear();
    resetMockDb();
    process.env.CHIPS_ENABLED = "1";
  });

  it("reuses the same transaction on idempotent replay", async () => {
    const { postTransaction } = await loadLedger();
    const payload = {
      userId: "user-1",
      txType: "BUY_IN",
      idempotencyKey: "idem-1",
      entries: [
        { accountType: "USER", amount: 50 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -50 },
      ],
    };

    const first = await postTransaction(payload);
    const second = await postTransaction(payload);

    expect(first.transaction.id).toBeDefined();
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.entries).toHaveLength(first.entries.length);
  });

  it("rejects conflicting payloads for the same idempotency key", async () => {
    const { postTransaction } = await loadLedger();
    const base = {
      userId: "user-1",
      txType: "BUY_IN",
      idempotencyKey: "idem-conflict",
      entries: [
        { accountType: "USER", amount: 30 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -30 },
      ],
    };

    await postTransaction(base);
    await expect(
      postTransaction({
        ...base,
        entries: [
          { accountType: "USER", amount: 40 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: -40 },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("enforces user involvement in double-entry batches", async () => {
    const { postTransaction } = await loadLedger();
    await expect(
      postTransaction({
        userId: "user-2",
        txType: "MINT",
        idempotencyKey: "missing-user-entry",
        entries: [{ accountType: "SYSTEM", systemKey: "TREASURY", amount: 10 }],
      }),
    ).rejects.toMatchObject({ code: "missing_user_entry", status: 400 });
  });

  it("prevents user balances from going negative", async () => {
    const { postTransaction } = await loadLedger();
    await expect(
      postTransaction({
        userId: "user-3",
        txType: "CASH_OUT",
        idempotencyKey: "guard-negative",
        entries: [
          { accountType: "USER", amount: -25 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: 25 },
        ],
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });
});

describe("chips auth isolation and idempotency per identity", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.mockClear();
    resetMockDb();
    process.env.CHIPS_ENABLED = "1";
  });

  it("replays idempotent calls for the same user but blocks cross-user reuse", async () => {
    const { handler } = await loadTxHandler();
    const body = {
      txType: "BUY_IN",
      amount: 10,
      idempotencyKey: "auth-isolation-key",
    };

    const first = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer user-a", origin: "https://arcade.test" },
      body: JSON.stringify(body),
    });
    const replay = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer user-a", origin: "https://arcade.test" },
      body: JSON.stringify(body),
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    const parsedFirst = JSON.parse(first.body);
    const parsedReplay = JSON.parse(replay.body);
    expect(parsedReplay.transaction.id).toBe(parsedFirst.transaction.id);

    const conflict = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer user-b", origin: "https://arcade.test" },
      body: JSON.stringify(body),
    });
    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body).error).toBe("idempotency_conflict");
  });
});

describe("chips ledger sequencing", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.mockClear();
    resetMockDb();
    process.env.CHIPS_ENABLED = "1";
  });

  it("reports contiguous sequences and highlights gaps", async () => {
    const { postTransaction, listUserLedger } = await loadLedger();
    await postTransaction({
      userId: "user-4",
      txType: "BUY_IN",
      idempotencyKey: "seq-1",
      entries: [
        { accountType: "USER", amount: 5 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -5 },
      ],
    });
    await postTransaction({
      userId: "user-4",
      txType: "BUY_IN",
      idempotencyKey: "seq-2",
      entries: [
        { accountType: "USER", amount: 7 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -7 },
      ],
    });

    const { entries, sequenceOk, nextExpectedSeq } = await listUserLedger("user-4");
    expect(sequenceOk).toBe(true);
    expect(entries[0].entry_seq).toBe(1);
    expect(entries[1].entry_seq).toBe(2);
    expect(nextExpectedSeq).toBe(3);

    const admin = await import("../netlify/functions/_shared/supabase-admin.mjs");
    const userAccount = [...admin.__mockDb.accounts.values()].find(acc => acc.user_id === "user-4");
    const userEntries = admin.__mockDb.entries.filter(entry => entry.account_id === userAccount.id);
    userEntries[1].entry_seq = 3;

    const withGap = await listUserLedger("user-4");
    expect(withGap.sequenceOk).toBe(false);
    expect(withGap.nextExpectedSeq).toBe(2);
  });

  it("advances the expected sequence when starting after a cursor", async () => {
    const { postTransaction, listUserLedger } = await loadLedger();
    await postTransaction({
      userId: "user-5",
      txType: "BUY_IN",
      idempotencyKey: "after-1",
      entries: [
        { accountType: "USER", amount: 3 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -3 },
      ],
    });

    const page = await listUserLedger("user-5", { afterSeq: 5, limit: 10 });
    expect(page.sequenceOk).toBe(true);
    expect(page.entries).toHaveLength(0);
    expect(page.nextExpectedSeq).toBe(6);
  });
});
