import crypto from "node:crypto";
import { executeSql, klog } from "./supabase-admin.mjs";

const VALID_TX_TYPES = new Set([
  "MINT",
  "BURN",
  "BUY_IN",
  "CASH_OUT",
  "RAKE_FEE",
  "PRIZE_PAYOUT",
]);

const asInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

function badRequest(code, message) {
  const err = new Error(message || code);
  err.status = 400;
  err.code = code;
  return err;
}

const hashPayload = (input) =>
  crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");

async function getOrCreateUserAccount(userId) {
  const query = `
with existing as (
  select * from public.chips_accounts where user_id = $1 and account_type = 'USER' for update
),
inserted as (
  insert into public.chips_accounts (user_id, account_type, status)
  select $1, 'USER', 'active'
  where not exists (select 1 from existing)
  returning *
),
account as (
  select * from inserted
  union all
  select * from existing
  limit 1
)
select row_to_json(account) as account from account;
`;
  const result = await executeSql(query, [userId]);
  const account = result?.[0]?.account;
  if (!account) {
    throw new Error("Failed to prepare chips account");
  }
  return account;
}

async function fetchSystemAccounts(systemKeys = []) {
  if (!systemKeys.length) return [];
  const query = `
select id, system_key, account_type, status
from public.chips_accounts
where system_key = any($1::text[]);
`;
  const result = await executeSql(query, [systemKeys]);
  return Array.isArray(result) ? result : [];
}

async function getUserBalance(userId) {
  const account = await getOrCreateUserAccount(userId);
  return {
    accountId: account.id,
    balance: asInt(account.balance, 0),
    nextEntrySeq: asInt(account.next_entry_seq, 1),
    status: account.status,
  };
}

async function listUserLedger(userId, { afterSeq = null, limit = 50 } = {}) {
  const cappedLimit = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 50), 200);
  const account = await getOrCreateUserAccount(userId);
  const query = `
with entries as (
  select
    e.entry_seq,
    e.amount,
    e.metadata,
    e.created_at,
    t.tx_type,
    t.reference,
    t.description,
    t.idempotency_key,
    t.created_at as tx_created_at
  from public.chips_entries e
  join public.chips_transactions t on t.id = e.transaction_id
  where e.account_id = $1
    and ($2::bigint is null or e.entry_seq > $2)
  order by e.entry_seq asc
  limit $3
)
select * from entries;
`;
  const rows = await executeSql(query, [account.id, afterSeq, cappedLimit]);
  const expectedStart = afterSeq ? asInt(afterSeq, 0) + 1 : 1;
  let sequenceOk = true;
  let cursor = expectedStart;
  for (const row of rows || []) {
    if (asInt(row.entry_seq) !== cursor) {
      sequenceOk = false;
      break;
    }
    cursor += 1;
  }
  return { entries: rows || [], sequenceOk, nextExpectedSeq: cursor };
}

async function findTransactionByKey(idempotencyKey) {
  const query = `
select id, tx_type, payload_hash, idempotency_key, reference, description, created_at
from public.chips_transactions
where idempotency_key = $1
limit 1;
`;
  const rows = await executeSql(query, [idempotencyKey]);
  return rows?.[0] || null;
}

async function fetchTransactionSnapshot(idempotencyKey, accountId) {
  const query = `
with txn as (
  select * from public.chips_transactions where idempotency_key = $1
),
entries as (
  select e.*
  from public.chips_entries e
  where e.transaction_id = (select id from txn)
  order by e.entry_seq asc
),
account as (
  select id, balance, next_entry_seq from public.chips_accounts where id = $2
)
select
  (select row_to_json(txn) from txn) as transaction,
  (select coalesce(jsonb_agg(entries), '[]'::jsonb) from entries) as entries,
  (select row_to_json(account) from account) as account;
`;
  const rows = await executeSql(query, [idempotencyKey, accountId]);
  return rows?.[0] || null;
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw badRequest("missing_entries", "At least one entry is required");
  }
  const sanitized = [];
  let hasUserEntry = false;
  for (const entry of entries) {
    const amount = Number(entry?.amount);
    const kind = entry?.accountType || entry?.kind;
    const systemKey = entry?.systemKey;
    if (!Number.isInteger(amount) || amount === 0) {
      throw badRequest("invalid_entry_amount", "Entry amount must be a non-zero integer");
    }
    if (kind !== "USER" && kind !== "SYSTEM") {
      throw badRequest("unsupported_account_type", "Unsupported accountType in entry");
    }
    if (kind !== "USER" && !systemKey) {
      throw badRequest("missing_system_key", "System entries must provide systemKey");
    }
    if (kind === "USER") {
      hasUserEntry = true;
    }
    const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
    sanitized.push({ kind, systemKey, amount, metadata });
  }
  if (!hasUserEntry) {
    throw badRequest("missing_user_entry", "Transactions must include the user account");
  }
  return sanitized;
}

async function postTransaction({
  userId,
  txType,
  idempotencyKey,
  reference = null,
  description = null,
  metadata = {},
  entries = [],
  createdBy = null,
}) {
  if (!VALID_TX_TYPES.has(txType)) {
    throw badRequest("invalid_tx_type", "Invalid transaction type");
  }
  if (!idempotencyKey) {
    throw badRequest("missing_idempotency_key", "Idempotency key is required");
  }

  const normalizedEntries = validateEntries(entries);
  const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const payloadHash = hashPayload({ userId, txType, idempotencyKey, entries: normalizedEntries, reference, description, metadata: safeMetadata });

  const existing = await findTransactionByKey(idempotencyKey);
  if (existing) {
    if (existing.payload_hash !== payloadHash || existing.tx_type !== txType) {
      const error = new Error("Idempotency key already used with different payload");
      error.status = 409;
      throw error;
    }
  }

  const userAccount = await getOrCreateUserAccount(userId);
  const neededSystemKeys = normalizedEntries
    .filter(entry => entry.kind !== "USER" && entry.systemKey)
    .map(entry => entry.systemKey);
  const uniqueSystemKeys = [...new Set(neededSystemKeys)];
  const systemAccounts = await fetchSystemAccounts(uniqueSystemKeys);
  const systemMap = new Map(systemAccounts.map(acc => [acc.system_key, acc]));

  for (const key of uniqueSystemKeys) {
    const account = systemMap.get(key);
    if (!account) {
      throw badRequest("system_account_missing", `System account ${key} not found`);
    }
    if (account.status !== "active") {
      throw badRequest("system_account_inactive", `System account ${key} is not active`);
    }
  }

  if (existing) {
    const snapshot = await fetchTransactionSnapshot(idempotencyKey, userAccount.id);
    if (!snapshot?.transaction) {
      const error = new Error("Failed to load existing transaction");
      error.status = 500;
      throw error;
    }
    return snapshot;
  }

  const entryRecords = normalizedEntries.map(entry => {
    if (entry.kind === "USER") {
      return { account_id: userAccount.id, amount: entry.amount, metadata: entry.metadata };
    }
    const account = systemMap.get(entry.systemKey);
    return { account_id: account?.id, amount: entry.amount, metadata: entry.metadata, system_key: entry.systemKey };
  });

  for (const rec of entryRecords) {
    if (!rec.account_id) {
      throw badRequest("missing_account", "Missing account for entry");
    }
  }

const insertQuery = `
with insert_txn as (
  insert into public.chips_transactions (reference, description, metadata, idempotency_key, payload_hash, tx_type, created_by)
  values ($1, $2, coalesce($3::jsonb, '{}'::jsonb), $4, $5, $6, $7)
  returning *
),
input_entries as (
  select
    v.account_id,
    v.amount,
    coalesce(v.metadata, '{}'::jsonb) as metadata
  from jsonb_to_recordset(($8::text)::jsonb) as v(account_id uuid, amount bigint, metadata jsonb)
),
deltas as (
  select account_id, sum(amount)::bigint as delta
  from input_entries
  group by account_id
),
locked_accounts as (
  select a.id, a.balance
  from public.chips_accounts a
  join deltas d on d.account_id = a.id
  for update
),
guard as (
  select case when exists (
    select 1
    from locked_accounts a
    join deltas d on d.account_id = a.id
    where (a.balance + d.delta) < 0
  )
  then public.raise_insufficient_funds()
  else null
  end as ok
),
apply_balance as (
  update public.chips_accounts a
  set balance = a.balance + d.delta
  from deltas d
  where a.id = d.account_id
  returning 1 as ok
),
entries as (
  insert into public.chips_entries (transaction_id, account_id, amount, metadata)
  select insert_txn.id, i.account_id, i.amount, i.metadata
  from insert_txn
  join guard on true
  join input_entries i on true
  where exists (select 1 from apply_balance)
  returning *
),
account as (
  select id, balance, next_entry_seq
  from public.chips_accounts
  where id = $9
)
select
  (select row_to_json(insert_txn) from insert_txn) as transaction,
  (select coalesce(jsonb_agg(entries order by entry_seq), '[]'::jsonb) from entries) as entries,
  (select row_to_json(account) from account) as account;
`;
  let result;
  try {
    result = await executeSql(insertQuery, [
      reference,
      description,
      safeMetadata,
      idempotencyKey,
      payloadHash,
      txType,
      createdBy,
      JSON.stringify(entryRecords),
      userAccount.id,
    ]);
  } catch (error) {
    const combined = `${error.message || ""} ${error.details || ""}`.toLowerCase();
    const is23505 = combined.includes("23505");
    const mentionsIdempotency =
      combined.includes("idempotency") ||
      combined.includes("idempotency_key") ||
      combined.includes("chips_transactions_idempotency_key_uidx");
    const looksUnique =
      combined.includes("duplicate key value violates") || combined.includes("duplicate") || combined.includes("unique");
    const isIdempotencyUnique = (is23505 && mentionsIdempotency) || (looksUnique && mentionsIdempotency);
    if (isIdempotencyUnique) {
      const existingTx = await findTransactionByKey(idempotencyKey);
      if (existingTx) {
        if (existingTx.payload_hash !== payloadHash || existingTx.tx_type !== txType) {
          const conflict = new Error("Idempotency key already used with different payload");
          conflict.status = 409;
          throw conflict;
        }
        const snapshot = await fetchTransactionSnapshot(idempotencyKey, userAccount.id);
        if (snapshot?.transaction) {
          return snapshot;
        }
      }
      const conflict = new Error("Idempotency key conflict");
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }

  if (!result?.[0]?.transaction) {
    klog("chips_tx_missing_rows", { idempotencyKey });
    throw new Error("Failed to record transaction");
  }

  return result[0];
}

export {
  VALID_TX_TYPES,
  getUserBalance,
  listUserLedger,
  postTransaction,
};
