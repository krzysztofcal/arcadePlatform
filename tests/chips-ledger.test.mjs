import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLog = vi.fn();

const mockDb = {
  accounts: new Map(),
  transactions: new Map(),
  entries: [],
  nextAccountId: 1,
  nextTransactionId: 1,
  nextEntryId: 1,
  clockMs: Date.parse("2026-02-06T19:00:00.000Z"),
};

const createId = (prefix, counter) => `${prefix}-${counter}`;

function resetMockDb() {
  mockDb.accounts.clear();
  mockDb.transactions.clear();
  mockDb.entries.length = 0;
  mockDb.nextAccountId = 1;
  mockDb.nextTransactionId = 1;
  mockDb.nextEntryId = 1;
  mockDb.clockMs = Date.parse("2026-02-06T19:00:00.000Z");
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

function normalizeSql(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function handleLedgerQuery(query, params = []) {
  const text = normalizeSql(normalizeQueryText(query));

  if (text.includes("from public.chips_accounts") && text.includes("account_type = 'user'") && text.includes("user_id")) {
    const userId = params[0];
    const account = ensureUserAccount(userId);
    return [{ account }];
  }

  if (text.includes("from public.chips_accounts") && text.includes("system_key = any")) {
    const keys = params[0] || [];
    return [...mockDb.accounts.values()].filter(acc => keys.includes(acc.system_key));
  }

  if (text.includes("from public.chips_transactions") && text.includes("idempotency_key")) {
    const key = params[0];
    const existing = [...mockDb.transactions.values()].find(tx => tx.idempotency_key === key);
    return existing ? [existing] : [];
  }

  if (text.includes("from public.chips_entries") && text.includes("join public.chips_transactions")) {
    const [accountId, cursorCreatedAt, cursorEntrySeq, limit] = params;
    const entries = mockDb.entries
      .filter(entry => {
        if (entry.account_id !== accountId) return false;
        if (!cursorCreatedAt) return true;
        const createdAt = new Date(entry.created_at);
        const cursorTime = new Date(cursorCreatedAt);
        if (createdAt.getTime() === cursorTime.getTime()) {
          return entry.entry_seq < cursorEntrySeq;
        }
        return createdAt.getTime() < cursorTime.getTime();
      })
      .sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA === timeB) return b.entry_seq - a.entry_seq;
        return timeB - timeA;
      })
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
  if (!Array.isArray(records) || records.length === 0) {
    const empty = new Error("empty_entries");
    empty.code = "empty_entries";
    empty.status = 400;
    throw empty;
  }
  const deltas = new Map();
  let totalDelta = 0;
  for (const record of records) {
    const amt = Number(record.amount);
    if (!Number.isFinite(amt) || Math.trunc(amt) !== amt) {
      const invalid = new Error("invalid_amount");
      invalid.code = "invalid_amount";
      invalid.status = 400;
      throw invalid;
    }
    const current = deltas.get(record.account_id) || 0;
    deltas.set(record.account_id, current + amt);
    totalDelta += amt;
  }

  if (totalDelta !== 0) {
    const unbalanced = new Error("unbalanced_entries");
    unbalanced.code = "unbalanced_entries";
    unbalanced.status = 400;
    throw unbalanced;
  }

  for (const [accountId, delta] of deltas.entries()) {
    const account = mockDb.accounts.get(accountId);
    if (!account) {
      const missing = new Error("missing_account");
      missing.code = "missing_account";
      missing.status = 400;
      throw missing;
    }
    const enforceGuard = account.account_type === "USER";
    if (enforceGuard && account.balance + delta < 0) {
      const insufficient = new Error("insufficient_funds");
      insufficient.code = "insufficient_funds";
      insufficient.status = 400;
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
      id: mockDb.nextEntryId++,
      transaction_id: transactionId,
      account_id: record.account_id,
      amount: Number(record.amount),
      metadata: record.metadata ?? {},
      system_key: record.system_key ?? null,
      entry_seq: entrySeq,
      created_at: new Date(mockDb.clockMs).toISOString(),
    };
    account.next_entry_seq = entrySeq + 1;
    mockDb.clockMs += 1000;
    mockDb.entries.push(entry);
    inserted.push(entry);
  }
  return inserted;
}

function makeTxRunner() {
  const runQuery = async (query, params = []) => {
    const text = normalizeSql(normalizeQueryText(query));

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
  const corsHeaders = (origin) => {
    if (!origin) return null;
    return { ...baseHeaders(), "access-control-allow-origin": origin };
  };
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
    await postTransaction({
      userId: "user-1",
      txType: "MINT",
      idempotencyKey: "seed-user-1",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -100 },
        { accountType: "USER", amount: 100 },
      ],
    });
    const payload = {
      userId: "user-1",
      txType: "BUY_IN",
      idempotencyKey: "idem-1",
      entries: [
        { accountType: "USER", amount: -50 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 50 },
      ],
    };

    const first = await postTransaction(payload);
    const second = await postTransaction(payload);

    expect(first.transaction.id).toBeDefined();
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.entries).toHaveLength(first.entries.length);

    const admin = await import("../netlify/functions/_shared/supabase-admin.mjs");
    const userAccount = [...admin.__mockDb.accounts.values()].find(acc => acc.user_id === "user-1");
    expect(userAccount.balance).toBe(50);
  });

  it("rejects conflicting payloads for the same idempotency key", async () => {
    const { postTransaction } = await loadLedger();
    await postTransaction({
      userId: "user-1",
      txType: "MINT",
      idempotencyKey: "seed-user-1-b",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -100 },
        { accountType: "USER", amount: 100 },
      ],
    });
    const base = {
      userId: "user-1",
      txType: "BUY_IN",
      idempotencyKey: "idem-conflict",
      entries: [
        { accountType: "USER", amount: -30 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 30 },
      ],
    };

    await postTransaction(base);
    await expect(
      postTransaction({
        ...base,
        entries: [
          { accountType: "USER", amount: -40 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: 40 },
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

  it("requires balanced double-entry amounts", async () => {
    const { postTransaction } = await loadLedger();
    await expect(
      postTransaction({
        userId: "user-2",
        txType: "MINT",
        idempotencyKey: "unbalanced",
        entries: [
          { accountType: "USER", amount: 10 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: -5 },
        ],
      }),
    ).rejects.toMatchObject({ code: "unbalanced_entries", status: 400 });
  });

  it("accepts string amounts while applying balance guards", async () => {
    const { postTransaction } = await loadLedger();
    await postTransaction({
      userId: "user-strings",
      txType: "MINT",
      idempotencyKey: "seed-user-strings",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: "-20" },
        { accountType: "USER", amount: "20" },
      ],
    });

    const result = await postTransaction({
      userId: "user-strings",
      txType: "BUY_IN",
      idempotencyKey: "strings-buy",
      entries: [
        { accountType: "USER", amount: "-10" },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: "10" },
      ],
    });

    expect(result.transaction.id).toBeDefined();
    const admin = await import("../netlify/functions/_shared/supabase-admin.mjs");
    const userAccount = [...admin.__mockDb.accounts.values()].find(acc => acc.user_id === "user-strings");
    expect(userAccount.balance).toBe(10);
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
    ).rejects.toMatchObject({ code: "insufficient_funds", status: 400 });
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
    const { postTransaction } = await loadLedger();
    await postTransaction({
      userId: "user-a",
      txType: "MINT",
      idempotencyKey: "seed-auth-a",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -50 },
        { accountType: "USER", amount: 50 },
      ],
    });
    await postTransaction({
      userId: "user-b",
      txType: "MINT",
      idempotencyKey: "seed-auth-b",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -50 },
        { accountType: "USER", amount: 50 },
      ],
    });
    const { handler } = await loadTxHandler();
    const body = {
      txType: "BUY_IN",
      idempotencyKey: "auth-isolation-key",
      amount: 10,
      entries: [
        { accountType: "USER", amount: -10 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 10 },
      ],
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
    const conflictError = JSON.parse(conflict.body).error;
    expect(conflictError).toBeTruthy();
    expect(String(conflictError)).toMatch(/idempotency|conflict/i);
  });

  it("rejects mismatched payloads for the same idempotency key", async () => {
    const { handler } = await loadTxHandler();
    const { postTransaction } = await loadLedger();
    await postTransaction({
      userId: "user-c",
      txType: "MINT",
      idempotencyKey: "seed-auth-c",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -50 },
        { accountType: "USER", amount: 50 },
      ],
    });
    const baseBody = {
      txType: "BUY_IN",
      amount: 10,
      idempotencyKey: "idem-body",
      entries: [
        { accountType: "USER", amount: -10 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 10 },
      ],
    };

    const first = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer user-c", origin: "https://arcade.test" },
      body: JSON.stringify(baseBody),
    });
    expect(first.statusCode).toBe(200);

    const conflict = await handler({
      httpMethod: "POST",
      headers: { authorization: "Bearer user-c", origin: "https://arcade.test" },
      body: JSON.stringify({
        ...baseBody,
        amount: 11,
        entries: [
          { accountType: "USER", amount: -11 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: 11 },
        ],
      }),
    });
    expect(conflict.statusCode).toBe(409);
    const conflictError = JSON.parse(conflict.body).error;
    expect(conflictError).toBeTruthy();
    expect(String(conflictError)).toMatch(/idempotency|conflict/i);
  });
});

describe("chips ledger paging", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.mockClear();
    resetMockDb();
    process.env.CHIPS_ENABLED = "1";
  });

  it("returns newest entries first with a stable cursor tie-breaker", async () => {
    const { postTransaction, listUserLedger } = await loadLedger();
    await postTransaction({
      userId: "user-4",
      txType: "MINT",
      idempotencyKey: "seed-user-4",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -20 },
        { accountType: "USER", amount: 20 },
      ],
    });
    await postTransaction({
      userId: "user-4",
      txType: "BUY_IN",
      idempotencyKey: "seq-1",
      entries: [
        { accountType: "USER", amount: -5 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 5 },
      ],
    });
    await postTransaction({
      userId: "user-4",
      txType: "BUY_IN",
      idempotencyKey: "seq-2",
      entries: [
        { accountType: "USER", amount: -7 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 7 },
      ],
    });

    const { items } = await listUserLedger("user-4");
    expect(items).toHaveLength(3);
    expect(items[0].created_at >= items[1].created_at).toBe(true);
    expect(items[1].created_at >= items[2].created_at).toBe(true);
    expect(items[0].entry_seq >= items[1].entry_seq).toBe(true);
  });

  it("rejects invalid cursor values and clamps limits", async () => {
    const { postTransaction, listUserLedger } = await loadLedger();
    await postTransaction({
      userId: "user-6",
      txType: "MINT",
      idempotencyKey: "seed-user-6",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -300 },
        { accountType: "USER", amount: 300 },
      ],
    });
    await postTransaction({
      userId: "user-6",
      txType: "BUY_IN",
      idempotencyKey: "cursor-1",
      entries: [
        { accountType: "USER", amount: -1 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 1 },
      ],
    });

    for (let i = 0; i < 201; i += 1) {
      // create enough entries to exercise the limit cap
      // eslint-disable-next-line no-await-in-loop
      await postTransaction({
        userId: "user-6",
        txType: "BUY_IN",
        idempotencyKey: `cursor-${i + 2}`,
        entries: [
          { accountType: "USER", amount: -1 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: 1 },
        ],
      });
    }

    await expect(listUserLedger("user-6", { cursor: "abc" })).rejects.toMatchObject({
      code: "invalid_cursor",
      status: 400,
    });
    await expect(listUserLedger("user-6", { cursor: "%%" })).rejects.toMatchObject({
      code: "invalid_cursor",
      status: 400,
    });
    await expect(
      listUserLedger("user-6", { cursor: Buffer.from("{not_json").toString("base64") }),
    ).rejects.toMatchObject({
      code: "invalid_cursor",
      status: 400,
    });
    await expect(
      listUserLedger("user-6", { cursor: Buffer.from(JSON.stringify({ createdAt: "2026-02-06T19:00:00Z" })).toString("base64") }),
    ).rejects.toMatchObject({
      code: "invalid_cursor",
      status: 400,
    });

    const limited = await listUserLedger("user-6", { cursor: null, limit: 0 });
    expect(limited.items).toHaveLength(1);

    const many = await listUserLedger("user-6", { cursor: null, limit: 9999 });
    expect(many.items.length).toBeLessThanOrEqual(200);
  });

  it("pages by cursor without overlap", async () => {
    const { postTransaction, listUserLedger } = await loadLedger();
    await postTransaction({
      userId: "user-5",
      txType: "MINT",
      idempotencyKey: "seed-user-5",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -10 },
        { accountType: "USER", amount: 10 },
      ],
    });
    await postTransaction({
      userId: "user-5",
      txType: "BUY_IN",
      idempotencyKey: "after-1",
      entries: [
        { accountType: "USER", amount: -3 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 3 },
      ],
    });
    await postTransaction({
      userId: "user-5",
      txType: "BUY_IN",
      idempotencyKey: "after-2",
      entries: [
        { accountType: "USER", amount: -4 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 4 },
      ],
    });

    const first = await listUserLedger("user-5", { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();

    const second = await listUserLedger("user-5", { limit: 2, cursor: first.nextCursor });
    expect(second.items.length).toBeGreaterThanOrEqual(1);
    expect(second.items[0].entry_seq).not.toBe(first.items[0].entry_seq);
    if (second.items.length > 1) {
      expect(second.items[0].created_at >= second.items[1].created_at).toBe(true);
    }
    if (first.items.length === 1) {
      expect(first.nextCursor).toBeTruthy();
    }
  });

  it("continues paging when last entry has an invalid entry_seq", async () => {
    const { postTransaction, listUserLedger } = await loadLedger();
    await postTransaction({
      userId: "user-7",
      txType: "MINT",
      idempotencyKey: "seed-user-7",
      entries: [
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -15 },
        { accountType: "USER", amount: 15 },
      ],
    });
    await postTransaction({
      userId: "user-7",
      txType: "BUY_IN",
      idempotencyKey: "cursor-7-1",
      entries: [
        { accountType: "USER", amount: -3 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 3 },
      ],
    });
    await postTransaction({
      userId: "user-7",
      txType: "BUY_IN",
      idempotencyKey: "cursor-7-2",
      entries: [
        { accountType: "USER", amount: -4 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: 4 },
      ],
    });

    const admin = await import("../netlify/functions/_shared/supabase-admin.mjs");
    const userAccount = [...admin.__mockDb.accounts.values()].find(acc => acc.user_id === "user-7");
    const userEntries = admin.__mockDb.entries.filter(entry => entry.account_id === userAccount.id);
    userEntries[userEntries.length - 1].entry_seq = null;

    const first = await listUserLedger("user-7", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await listUserLedger("user-7", { limit: 2, cursor: first.nextCursor });
    expect(second.items.length).toBeGreaterThanOrEqual(1);
    expect(second.items[0].entry_seq).not.toBe(first.items[0].entry_seq);
  });
});

describe("chips handlers security and gating", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.mockClear();
    resetMockDb();
  });

  it("returns 404 when chips are disabled", async () => {
    process.env.CHIPS_ENABLED = "0";
    const { handler: txHandler } = await loadTxHandler();
    const { handler: ledgerHandler } = await import("../netlify/functions/chips-ledger.mjs");

    const txResult = await txHandler({ httpMethod: "POST", headers: {}, body: "{}" });
    expect(txResult.statusCode).toBe(404);
    expect(JSON.parse(txResult.body).error).toBe("not_found");

    const ledgerResult = await ledgerHandler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
    expect(ledgerResult.statusCode).toBe(404);
    expect(JSON.parse(ledgerResult.body).error).toBe("not_found");
  });

  it("requires authorization headers", async () => {
    process.env.CHIPS_ENABLED = "1";
    const { handler: txHandler } = await loadTxHandler();
    const { handler: ledgerHandler } = await import("../netlify/functions/chips-ledger.mjs");

    const txResult = await txHandler({ httpMethod: "POST", headers: { origin: "https://arcade.test" }, body: "{}" });
    expect(txResult.statusCode).toBe(401);
    expect(JSON.parse(txResult.body).error).toBeTruthy();

    const ledgerResult = await ledgerHandler({ httpMethod: "GET", headers: { origin: "https://arcade.test" }, queryStringParameters: {} });
    expect(ledgerResult.statusCode).toBe(401);
    expect(JSON.parse(ledgerResult.body).error).toBeTruthy();
  });
});
