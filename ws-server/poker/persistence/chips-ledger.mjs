import crypto from "node:crypto";
import { beginSql, klog } from "./sql-admin.mjs";

const VALID_TX_TYPE = "TABLE_BUY_IN";
const IDEMPOTENCY_CONSTRAINT = "chips_transactions_idempotency_key_unique";

function badRequest(code, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function hashPayload(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalizeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed === 0) {
    return null;
  }
  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateEntries(entries, payloadUserId) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw badRequest("invalid_entries", "TABLE_BUY_IN requires exactly two entries");
  }

  const normalized = entries.map((entry) => {
    const amount = normalizeAmount(entry?.amount);
    if (amount === null) {
      throw badRequest("invalid_amount", "Entry amount must be a non-zero integer");
    }
    const kind = String(entry?.accountType || entry?.kind || "").trim().toUpperCase();
    if (kind !== "USER" && kind !== "SYSTEM" && kind !== "ESCROW") {
      throw badRequest("invalid_account_type", "Unsupported account type");
    }
    const userId = kind === "USER" ? String(entry?.userId || payloadUserId || "").trim() : null;
    const systemKey = kind !== "USER" ? String(entry?.systemKey || "").trim() : null;
    if (kind === "USER" && !userId) {
      throw badRequest("invalid_entry_user", "USER entry userId is required");
    }
    if (kind !== "USER" && !systemKey) {
      throw badRequest("invalid_system_key", "SYSTEM/ESCROW entry systemKey is required");
    }
    return {
      kind,
      userId,
      systemKey,
      amount,
      metadata: isPlainObject(entry?.metadata) ? entry.metadata : {}
    };
  });

  const userEntries = normalized.filter((entry) => entry.kind === "USER");
  const systemEntries = normalized.filter((entry) => entry.kind === "SYSTEM");
  const escrowEntries = normalized.filter((entry) => entry.kind === "ESCROW");

  if (escrowEntries.length !== 1 || escrowEntries[0].amount <= 0) {
    throw badRequest("invalid_entries", "TABLE_BUY_IN requires one ESCROW credit");
  }
  if (userEntries.length > 1 || systemEntries.length > 1) {
    throw badRequest("invalid_entries", "TABLE_BUY_IN supports at most one USER debit or one SYSTEM debit");
  }
  if (userEntries.length === 1 && systemEntries.length === 1) {
    throw badRequest("invalid_entries", "TABLE_BUY_IN cannot debit USER and SYSTEM in the same transaction");
  }
  if (userEntries.length === 0 && systemEntries.length === 0) {
    throw badRequest("invalid_entries", "TABLE_BUY_IN requires a funding debit entry");
  }
  if (userEntries.length === 0) {
    if (systemEntries[0].amount >= 0 || systemEntries[0].systemKey === escrowEntries[0].systemKey) {
      throw badRequest("invalid_escrow_only_entries", "Escrow-only TABLE_BUY_IN requires SYSTEM(-) and ESCROW(+) strict shape");
    }
  }
  const total = normalized.reduce((sum, entry) => sum + entry.amount, 0);
  if (total !== 0) {
    throw badRequest("invalid_entries", "Transaction entries must balance to zero");
  }

  return normalized;
}

async function getOrCreateUserAccount(sqlTx, userId) {
  const result = await sqlTx.unsafe(
    `
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
  select i.* from inserted i
  union all
  select * from existing
  limit 1
)
select row_to_json(account) as account from account;
    `,
    [userId]
  );
  const account = result?.[0]?.account;
  if (!account?.id) {
    throw new Error("Failed to prepare chips account");
  }
  return account;
}

async function fetchSystemAccounts(sqlTx, systemKeys) {
  if (!systemKeys.length) {
    return [];
  }
  const result = await sqlTx.unsafe(
    `
select id, system_key, account_type, status
from public.chips_accounts
where system_key = any($1::text[]);
    `,
    [systemKeys]
  );
  return Array.isArray(result) ? result : [];
}

async function runTableBuyIn(sqlTx, {
  userId,
  txType,
  idempotencyKey,
  reference = null,
  description = null,
  metadata = {},
  entries = [],
  createdBy = null
}) {
  if (txType !== VALID_TX_TYPE) {
    throw badRequest("invalid_tx_type", "Invalid transaction type");
  }
  if (!idempotencyKey) {
    throw badRequest("missing_idempotency_key", "Idempotency key is required");
  }
  if (!isPlainObject(metadata)) {
    throw badRequest("invalid_metadata", "Metadata must be a plain JSON object");
  }

  const payloadUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
  const normalizedEntries = validateEntries(entries, payloadUserId);
  const uniqueSystemKeys = [...new Set(normalizedEntries.filter((entry) => entry.kind !== "USER").map((entry) => entry.systemKey))];
  const systemAccounts = await fetchSystemAccounts(sqlTx, uniqueSystemKeys);
  const systemMap = new Map(systemAccounts.map((account) => [account.system_key, account]));

  for (const systemKey of uniqueSystemKeys) {
    const account = systemMap.get(systemKey);
    if (!account) {
      throw badRequest("system_account_missing", `System account ${systemKey} not found`);
    }
    if (account.status !== "active") {
      throw badRequest("system_account_inactive", `System account ${systemKey} is not active`);
    }
  }

  const userIds = [...new Set(normalizedEntries.filter((entry) => entry.kind === "USER").map((entry) => entry.userId))];
  const userAccountById = new Map();
  for (const accountUserId of userIds) {
    userAccountById.set(accountUserId, await getOrCreateUserAccount(sqlTx, accountUserId));
  }

  const hashableEntries = normalizedEntries.map((entry) => ({
    kind: entry.kind,
    userId: entry.kind === "USER" ? entry.userId : null,
    systemKey: entry.systemKey ?? null,
    amount: entry.amount,
    metadata: entry.metadata
  }));
  const payloadHash = hashPayload({ userId: payloadUserId, txType, idempotencyKey, reference, description, metadata, entries: hashableEntries });

  const entryRecords = normalizedEntries.map((entry) => {
    if (entry.kind === "USER") {
      return { account_id: userAccountById.get(entry.userId)?.id, amount: entry.amount, metadata: entry.metadata };
    }
    return { account_id: systemMap.get(entry.systemKey)?.id, amount: entry.amount, metadata: entry.metadata };
  });

  if (entryRecords.some((entry) => !entry.account_id)) {
    throw badRequest("missing_account", "Missing account for entry");
  }

  const safeMetadataJson = JSON.stringify(metadata);
  const entriesPayload = JSON.stringify(entryRecords);

  const txRows = await sqlTx.unsafe(
    `
insert into public.chips_transactions (reference, description, metadata, idempotency_key, payload_hash, tx_type, user_id, created_by)
values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
returning *;
    `,
    [reference, description, safeMetadataJson, idempotencyKey, payloadHash, txType, payloadUserId, createdBy]
  );
  const transactionRow = txRows?.[0];
  if (!transactionRow) {
    throw new Error("Failed to insert transaction row");
  }

  const applyResult = await sqlTx.unsafe(
    `
with input_entries as (
  select v.account_id, v.amount, coalesce(v.metadata, '{}'::jsonb) as metadata
  from jsonb_to_recordset(($1::text)::jsonb) as v(account_id uuid, amount bigint, metadata jsonb)
),
deltas as (
  select account_id, sum(amount)::bigint as delta
  from input_entries
  group by account_id
),
locked_accounts as (
  select a.id, a.balance, a.account_type, a.system_key
  from public.chips_accounts a
  join deltas d on d.account_id = a.id
  for update
),
guard as (
  select not exists (
    select 1
    from locked_accounts a
    join deltas d on d.account_id = a.id
    where (a.balance + d.delta) < 0
      and not (a.account_type = 'SYSTEM' and a.system_key = 'GENESIS')
  ) as ok
),
raise_if as (
  select case when not (select ok from guard)
    then public.raise_insufficient_funds()
  end as ok
),
apply_balance as (
  update public.chips_accounts a
  set balance = a.balance + d.delta
  from deltas d
  where a.id = d.account_id
    and (select ok from guard)
  returning a.id
),
expected as (
  select count(*) as expected_accounts from deltas
)
select
  (select count(*) from apply_balance) as updated_accounts,
  (select expected_accounts from expected) as expected_accounts,
  (select ok from guard) as guard_ok,
  (select ok from raise_if) as guard_check;
    `,
    [entriesPayload]
  );

  const updatedAccounts = Number(applyResult?.[0]?.updated_accounts || 0);
  const expectedAccounts = Number(applyResult?.[0]?.expected_accounts || 0);
  if (updatedAccounts === 0 && expectedAccounts > 0) {
    const error = new Error("Failed to apply any account balances");
    error.code = "chips_apply_failed";
    throw error;
  }
  if (updatedAccounts !== expectedAccounts) {
    klog("chips_apply_mismatch", { expectedAccounts, updatedAccounts, idempotencyKey, txType });
    const error = new Error("Failed to apply expected account balances");
    error.code = "chips_apply_mismatch";
    throw error;
  }

  const entryRows = await sqlTx.unsafe(
    `
with input_entries as (
  select v.account_id, v.amount, coalesce(v.metadata, '{}'::jsonb) as metadata
  from jsonb_to_recordset(($2::text)::jsonb) as v(account_id uuid, amount bigint, metadata jsonb)
),
inserted as (
  insert into public.chips_entries (transaction_id, account_id, amount, metadata)
  select $1, i.account_id, i.amount, i.metadata
  from input_entries i
  returning *
)
select coalesce(jsonb_agg(i order by i.entry_seq), '[]'::jsonb) as entries
from inserted i;
    `,
    [transactionRow.id, entriesPayload]
  );

  const insertedEntries = Array.isArray(entryRows?.[0]?.entries) ? entryRows[0].entries : [];
  if (insertedEntries.length !== entryRecords.length) {
    const error = new Error("Inserted entries count mismatch");
    error.code = "chips_entries_mismatch";
    throw error;
  }

  return {
    transaction: transactionRow,
    entries: insertedEntries,
    constraint: IDEMPOTENCY_CONSTRAINT
  };
}

export async function postTransaction(payload) {
  const sqlTx = payload?.tx;
  if (sqlTx) {
    return runTableBuyIn(sqlTx, payload);
  }
  return beginSql((tx) => runTableBuyIn(tx, payload));
}
