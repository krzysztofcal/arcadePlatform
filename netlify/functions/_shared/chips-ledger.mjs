import crypto from "node:crypto";
import { beginSql, executeSql, klog } from "./supabase-admin.mjs";

const VALID_TX_TYPES = new Set([
  "MINT",
  "BURN",
  "BUY_IN",
  "CASH_OUT",
  "TABLE_BUY_IN",
  "TABLE_CASH_OUT",
  "HAND_SETTLEMENT",
  "RAKE_FEE",
  "PRIZE_PAYOUT",
]);

// Loose integer parsing for non-sequence fields only (balances, etc.).
const asLooseInt = (value, fallback = 0) => {
  if (value == null) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const parsePositiveInt = (value) => {
  if (value == null) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (Math.trunc(parsed) !== parsed) return null;
  if (parsed <= 0) return null;
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
};

const parseWholeInt = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (Math.trunc(parsed) !== parsed) return null;
  if (parsed === 0) return null;
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
};

const parsePositiveIntString = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === "string" ? value.trim() : String(value);
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  if (normalized === "0") return null;
  return normalized;
};

const asIso = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  if (typeof value !== "string") return null;
  let normalized = value.trim();
  if (!normalized) return null;
  const spaceIndex = normalized.indexOf(" ");
  if (spaceIndex !== -1) {
    normalized = normalized.slice(0, spaceIndex) + "T" + normalized.slice(spaceIndex + 1);
  }
  normalized = normalized.replace(/([+-]\\d{2})(\\d{2})$/, "$1:$2");
  normalized = normalized.replace(/\\+00$/, "Z");
  if (!/[Zz]|[+-]\\d{2}:?\\d{2}$/.test(normalized)) {
    normalized += "Z";
  }
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const resolveDisplayCreatedAt = (row, context) => {
  const fromEntry = asIso(row?.created_at);
  if (fromEntry) return fromEntry;
  const fromTx = asIso(row?.tx_created_at);
  if (fromTx) return fromTx;
  klog("chips:ledger_missing_display_created_at", {
    entry_seq: context?.entry_seq ?? null,
    sort_id: context?.sort_id ?? null,
    tx_type: context?.tx_type ?? null,
    idempotency_key: context?.idempotency_key ?? null,
    created_at: row?.created_at ?? null,
    tx_created_at: row?.tx_created_at ?? null,
    display_created_at: row?.display_created_at ?? null,
  });
  return null;
};

function badRequest(code, message) {
  const err = new Error(message || code);
  err.status = 400;
  err.code = code;
  return err;
}

const hashPayload = (input) =>
  crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const assertPlainObjectOrNull = (value, code) => {
  if (value == null) return;
  if (!isPlainObject(value)) {
    throw badRequest(code, "Metadata must be a plain JSON object");
  }
};

async function getOrCreateUserAccount(userId, tx = null) {
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
  select i.* from inserted i
  union all
  select * from existing
  limit 1
)
select row_to_json(account) as account from account;
`;
  const runner = tx ? (q, params) => tx.unsafe(q, params) : executeSql;
  const result = await runner(query, [userId]);
  const account = result?.[0]?.account;
  if (!account) {
    throw new Error("Failed to prepare chips account");
  }
  return account;
}

async function fetchSystemAccounts(systemKeys = [], tx = null) {
  if (!systemKeys.length) return [];
  const query = `
select id, system_key, account_type, status
from public.chips_accounts
where system_key = any($1::text[]);
`;
  const runner = tx ? (q, params) => tx.unsafe(q, params) : executeSql;
  const result = await runner(query, [systemKeys]);
  return Array.isArray(result) ? result : [];
}

async function getUserBalance(userId) {
  const account = await getOrCreateUserAccount(userId);
  return {
    accountId: account.id,
    balance: asLooseInt(account.balance, 0),
    nextEntrySeq: asLooseInt(account.next_entry_seq, 1),
    status: account.status,
  };
}

function decodeLedgerCursor(cursor) {
  if (cursor === null || cursor === undefined) return null;
  if (typeof cursor !== "string" || cursor.trim() === "") {
    throw badRequest("invalid_cursor", "Invalid cursor");
  }
  let decoded = null;
  try {
    decoded = Buffer.from(cursor, "base64").toString("utf8");
  } catch (_err) {
    throw badRequest("invalid_cursor", "Invalid cursor");
  }
  let payload = null;
  try {
    payload = JSON.parse(decoded);
  } catch (_err) {
    throw badRequest("invalid_cursor", "Invalid cursor");
  }
  const hasSortKey = payload?.sortId != null || payload?.sort_id != null;
  const hasSeqKey = payload?.entrySeq != null || payload?.entry_seq != null;
  if (hasSortKey) {
    const sortId = parsePositiveIntString(payload?.sortId ?? payload?.sort_id);
    if (!sortId) {
      throw badRequest("invalid_cursor", "Invalid cursor");
    }
    return { sortId, mode: "sort_id" };
  }
  if (hasSeqKey) {
    const createdAt = payload?.displayCreatedAt || payload?.display_created_at || payload?.createdAt || payload?.created_at;
    const parsedCreated = createdAt ? new Date(createdAt) : null;
    if (!parsedCreated || Number.isNaN(parsedCreated.getTime())) {
      throw badRequest("invalid_cursor", "Invalid cursor");
    }
    const entrySeq = parsePositiveInt(payload?.entrySeq ?? payload?.entry_seq);
    if (entrySeq === null) {
      throw badRequest("invalid_cursor", "Invalid cursor");
    }
    return { createdAt: parsedCreated.toISOString(), entrySeq, mode: "entry_seq" };
  }
  const timestampOnly = payload?.displayCreatedAt || payload?.display_created_at || payload?.createdAt || payload?.created_at;
  if (timestampOnly) {
    klog("chips:ledger_timestamp_only_cursor", {
      has_displayCreatedAt: payload?.displayCreatedAt != null,
      has_display_created_at: payload?.display_created_at != null,
      has_createdAt: payload?.createdAt != null,
      has_created_at: payload?.created_at != null,
    });
    return null;
  }
  throw badRequest("invalid_cursor", "Invalid cursor");
}

function encodeLedgerCursor(sortId) {
  if (typeof sortId !== "string" || !/^\d+$/.test(sortId) || sortId === "0") return null;
  try {
    const payload = JSON.stringify({ sortId });
    return Buffer.from(payload, "utf8").toString("base64");
  } catch (_err) {
    return null;
  }
}

function findLastCursorCandidate(entries) {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const sortId = parsePositiveIntString(entry?.sort_id);
    if (sortId !== null) {
      return { sortId };
    }
  }
  return null;
}

async function listUserLedgerAfterSeq(userId, { afterSeq = null, limit = 50 } = {}) {
  const cappedLimit = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 50), 200);
  const account = await getOrCreateUserAccount(userId);
  const hasAfter = afterSeq !== null && afterSeq !== undefined && !(typeof afterSeq === "string" && afterSeq.trim() === "");
  const parsedAfterSeq = parsePositiveInt(afterSeq);
  if (hasAfter && parsedAfterSeq === null) {
    throw badRequest("invalid_after_seq", "Invalid after sequence");
  }
  const query = `
with entries as (
  select
    e.entry_seq,
    e.id as sort_id,
    e.amount,
    e.metadata,
    e.created_at,
    t.tx_type,
    t.reference,
    t.description,
    t.idempotency_key,
    t.created_at as tx_created_at,
    coalesce(e.created_at, t.created_at) as display_created_at
  from public.chips_entries e
  join public.chips_transactions t on t.id = e.transaction_id
  where e.account_id = $1
    and ($2::bigint is null or e.entry_seq > $2)
  order by e.entry_seq asc
  limit $3
)
select * from entries;
`;
  const rows = await executeSql(query, [account.id, parsedAfterSeq, cappedLimit]);
  const expectedStart = parsedAfterSeq ? parsedAfterSeq + 1 : 1;
  let sequenceOk = true;
  let cursor = expectedStart;
  let mismatchLogged = false;
  for (const row of rows || []) {
    const parsedSeq = parsePositiveInt(row?.entry_seq);
    if (parsedSeq !== cursor) {
      sequenceOk = false;
      if (!mismatchLogged) {
        klog("chips:ledger_sequence_mismatch", {
          after_seq: parsedAfterSeq || 0,
          expected_seq: cursor,
          actual_seq: parsedSeq,
          raw_entry_seq: row?.entry_seq,
          tx_type: row?.tx_type ?? null,
          idempotency_key: row?.idempotency_key ?? null,
          reason: parsedSeq === null ? "invalid_entry_seq" : "non_contiguous_seq",
        });
        mismatchLogged = true;
      }
      break;
    }
    cursor += 1;
  }
  const normalizedEntries = (rows || []).map(row => {
    const parsedEntrySeq = parsePositiveInt(row?.entry_seq);
    const entrySeq = parsedEntrySeq;
    if (parsedEntrySeq === null) {
      klog("chips:ledger_invalid_entry_seq", {
        raw_entry_seq: row?.entry_seq,
        tx_type: row?.tx_type,
        idempotency_key: row?.idempotency_key,
      });
    }

    const parsedAmount = parseWholeInt(row?.amount);
    const createdAt = asIso(row?.created_at);
    const txCreatedAt = asIso(row?.tx_created_at);
    const displayCreatedAt = resolveDisplayCreatedAt(row, {
      entry_seq: entrySeq,
      sort_id: row?.sort_id ?? null,
      tx_type: row?.tx_type ?? null,
      idempotency_key: row?.idempotency_key ?? null,
    });
    const sortId = parsePositiveIntString(row?.sort_id);

    if (parsedAmount === null && row?.amount != null) {
      klog("chips:ledger_invalid_amount", {
        entry_seq: entrySeq,
        raw_amount: row?.amount == null ? null : String(row.amount),
        tx_type: row?.tx_type,
      });
    }

    return {
      entry_seq: entrySeq,
      amount: parsedAmount,
      raw_amount: row?.amount == null ? null : String(row.amount),
      metadata: row?.metadata ?? null,
      created_at: createdAt,
      display_created_at: displayCreatedAt,
      sort_id: sortId,
      tx_type: row?.tx_type ?? null,
      reference: row?.reference ?? null,
      description: row?.description ?? null,
      idempotency_key: row?.idempotency_key ?? null,
      tx_created_at: txCreatedAt,
    };
  });

  return { entries: normalizedEntries, sequenceOk, nextExpectedSeq: cursor };
}

async function listUserLedger(userId, { cursor = null, limit = 50 } = {}) {
  const cappedLimit = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 50), 200);
  const account = await getOrCreateUserAccount(userId);
  const parsedCursor = decodeLedgerCursor(cursor);
  const cursorSortId = parsedCursor?.mode === "sort_id" ? parsedCursor.sortId : null;
  const cursorEntrySeq = parsedCursor?.mode === "entry_seq" ? parsedCursor.entrySeq : null;
  const sortQuery = `
with entries as (
  select
    e.entry_seq,
    e.id as sort_id,
    e.amount,
    e.metadata,
    e.created_at,
    t.tx_type,
    t.reference,
    t.description,
    t.idempotency_key,
    t.created_at as tx_created_at,
    coalesce(e.created_at, t.created_at) as display_created_at
  from public.chips_entries e
  join public.chips_transactions t on t.id = e.transaction_id
  where e.account_id = $1
    and (
      $2::bigint is null
      or e.id < $2::bigint
    )
  order by e.id desc
  limit $3
)
select * from entries;
`;
  const legacyQuery = `
with entries as (
  select
    e.entry_seq,
    e.id as sort_id,
    e.amount,
    e.metadata,
    e.created_at,
    t.tx_type,
    t.reference,
    t.description,
    t.idempotency_key,
    t.created_at as tx_created_at,
    coalesce(e.created_at, t.created_at) as display_created_at
  from public.chips_entries e
  join public.chips_transactions t on t.id = e.transaction_id
  where e.account_id = $1
    and (
      $2::timestamptz is null
      or (coalesce(e.created_at, t.created_at), e.entry_seq) < ($2::timestamptz, $3::bigint)
    )
  order by display_created_at desc nulls last, e.entry_seq desc
  limit $4
)
select * from entries;
`;
  const useLegacy = parsedCursor?.mode === "entry_seq";
  const rows = await executeSql(
    useLegacy ? legacyQuery : sortQuery,
    useLegacy
      ? [account.id, parsedCursor?.createdAt || null, cursorEntrySeq, cappedLimit]
      : [account.id, cursorSortId, cappedLimit],
  );
  const rowList = Array.isArray(rows) ? rows : [];
  const hasFullPage = rowList.length === cappedLimit;
  const normalizedEntries = rowList.map(row => {
    const parsedEntrySeq = parsePositiveInt(row?.entry_seq);
    const entrySeq = parsedEntrySeq;
    if (parsedEntrySeq === null) {
      klog("chips:ledger_invalid_entry_seq", {
        raw_entry_seq: row?.entry_seq,
        tx_type: row?.tx_type,
        idempotency_key: row?.idempotency_key,
      });
    }

    const parsedAmount = parseWholeInt(row?.amount);
    const createdAt = asIso(row?.created_at);
    const txCreatedAt = asIso(row?.tx_created_at);
    const displayCreatedAt = resolveDisplayCreatedAt(row, {
      entry_seq: entrySeq,
      sort_id: row?.sort_id ?? null,
      tx_type: row?.tx_type ?? null,
      idempotency_key: row?.idempotency_key ?? null,
    });
    const sortId = parsePositiveIntString(row?.sort_id);

    if (parsedAmount === null && row?.amount != null) {
      klog("chips:ledger_invalid_amount", {
        entry_seq: entrySeq,
        raw_amount: row?.amount == null ? null : String(row.amount),
        tx_type: row?.tx_type,
      });
    }

    return {
      entry_seq: entrySeq,
      amount: parsedAmount,
      raw_amount: row?.amount == null ? null : String(row.amount),
      metadata: row?.metadata ?? null,
      created_at: createdAt,
      display_created_at: displayCreatedAt,
      sort_id: sortId,
      tx_type: row?.tx_type ?? null,
      reference: row?.reference ?? null,
      description: row?.description ?? null,
      idempotency_key: row?.idempotency_key ?? null,
      tx_created_at: txCreatedAt,
    };
  });
  const cursorCandidate = hasFullPage ? findLastCursorCandidate(normalizedEntries) : null;
  if (!cursorCandidate && hasFullPage) {
    klog("chips:ledger_cursor_missing", { count: normalizedEntries.length });
  }
  const nextCursor = cursorCandidate
    ? encodeLedgerCursor(cursorCandidate.sortId)
    : null;

  return { entries: normalizedEntries, items: normalizedEntries, nextCursor };
}

async function findTransactionByKey(idempotencyKey, tx = null) {
  const query = `
select id, tx_type, payload_hash, idempotency_key, reference, description, created_at, user_id
from public.chips_transactions
where idempotency_key = $1
limit 1;
`;
  const runner = tx ? (q, params) => tx.unsafe(q, params) : executeSql;
  const rows = await runner(query, [idempotencyKey]);
  return rows?.[0] || null;
}

async function fetchTransactionSnapshotByTxId(transactionId, userId = null, tx = null) {
  const query = `
with txn as (
  select * from public.chips_transactions where id = $1
),
entries as (
  select e.*
  from public.chips_entries e
  where e.transaction_id = (select id from txn)
  order by e.entry_seq asc
),
account as (
  select id, balance, next_entry_seq
  from public.chips_accounts
  where user_id = coalesce($2::uuid, (select user_id from txn))
    and account_type = 'USER'
  limit 1
)
select
  (select row_to_json(txn) from txn) as transaction,
  (select coalesce(jsonb_agg(e order by e.entry_seq), '[]'::jsonb) from entries e) as entries,
  (select row_to_json(account) from account) as account;
`;
  const runner = tx ? (q, params) => tx.unsafe(q, params) : executeSql;
  const rows = await runner(query, [transactionId, userId]);
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
    if (kind !== "USER" && kind !== "SYSTEM" && kind !== "ESCROW") {
      throw badRequest("unsupported_account_type", "Unsupported accountType in entry");
    }
    if (kind !== "USER" && !systemKey) {
      throw badRequest("missing_system_key", "System entries must provide systemKey");
    }
    if (kind === "USER") {
      hasUserEntry = true;
    }
    if (
      Object.prototype.hasOwnProperty.call(entry, "metadata") &&
      entry.metadata != null &&
      !isPlainObject(entry.metadata)
    ) {
      throw badRequest("invalid_entry_metadata", "Entry metadata must be a plain JSON object");
    }
    const metadata = entry?.metadata ?? {};
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
  tx = null,
}) {
  if (!VALID_TX_TYPES.has(txType)) {
    throw badRequest("invalid_tx_type", "Invalid transaction type");
  }
  if (!idempotencyKey) {
    throw badRequest("missing_idempotency_key", "Idempotency key is required");
  }

  const normalizedEntries = validateEntries(entries);
  assertPlainObjectOrNull(metadata, "invalid_metadata");
  const safeMetadata = metadata ?? {};
  let safeMetadataJson = "{}";
  let safeMetadataNormalized = {};
  try {
    safeMetadataJson = JSON.stringify(safeMetadata);
    safeMetadataNormalized = JSON.parse(safeMetadataJson);
  } catch (error) {
    throw badRequest("invalid_metadata", "Metadata must be JSON-serializable");
  }

  const neededSystemKeys = normalizedEntries
    .filter(entry => entry.kind !== "USER" && entry.systemKey)
    .map(entry => entry.systemKey);
  const uniqueSystemKeys = [...new Set(neededSystemKeys)];
  const systemAccounts = await fetchSystemAccounts(uniqueSystemKeys, tx);
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

  const hashableEntries = normalizedEntries.map((entry) => ({
    kind: entry.kind,
    systemKey: entry.systemKey ?? null,
    amount: entry.amount,
    metadata: entry.metadata ?? {},
  }));

  let payloadHash;
  try {
    payloadHash = hashPayload({
      userId,
      txType,
      idempotencyKey,
      reference,
      description,
      metadata: safeMetadataNormalized,
      entries: hashableEntries,
    });
  } catch (error) {
    throw badRequest("invalid_entry_metadata", "Entry metadata must be JSON-serializable");
  }

  let result;
  let userAccount = null;
  const runInTx = async (sqlTx) => {
    // IMPORTANT: inside this block use ONLY `sqlTx` for all SQL to keep it atomic.
    userAccount = await getOrCreateUserAccount(userId, sqlTx);

    const entryRecords = normalizedEntries.map(entry => {
      if (entry.kind === "USER") {
        const safeEntryMetadata = entry?.metadata ?? {};
        return { account_id: userAccount.id, amount: entry.amount, metadata: safeEntryMetadata };
      }
      const account = systemMap.get(entry.systemKey);
      const safeEntryMetadata = entry?.metadata ?? {};
      return { account_id: account?.id, amount: entry.amount, metadata: safeEntryMetadata, system_key: entry.systemKey };
    });

    for (const rec of entryRecords) {
      if (!rec.account_id) {
        throw badRequest("missing_account", "Missing account for entry");
      }
    }

    let entriesPayload = "[]";
    try {
      entriesPayload = JSON.stringify(entryRecords);
    } catch (error) {
      throw badRequest("invalid_entry_metadata", "Entry metadata must be JSON-serializable");
    }

    const txRows = await sqlTx`
      insert into public.chips_transactions (reference, description, metadata, idempotency_key, payload_hash, tx_type, user_id, created_by)
      values (${reference}, ${description}, ${safeMetadataJson}::jsonb, ${idempotencyKey}, ${payloadHash}, ${txType}, ${userId}, ${createdBy})
      returning *;
    `;

    const transactionRow = txRows?.[0];
    if (!transactionRow) {
      throw new Error("Failed to insert transaction row");
    }

    const applyResult = await sqlTx.unsafe(
      `
with input_entries as (
  select
    v.account_id,
    v.amount,
    coalesce(v.metadata, '{}'::jsonb) as metadata
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
      const failed = new Error("Failed to apply any account balances");
      failed.code = "chips_apply_failed";
      failed.status = 500;
      throw failed;
    }
    if (expectedAccounts !== updatedAccounts) {
      klog("chips_apply_mismatch", {
        expectedAccounts,
        updatedAccounts,
        idempotencyKey,
        txType,
      });
      const mismatch = new Error("Failed to apply expected account balances");
      mismatch.code = "chips_apply_mismatch";
      mismatch.status = 500;
      throw mismatch;
    }

    const entriesResult = await sqlTx.unsafe(
      `
with input_entries as (
  select
    v.account_id,
    v.amount,
    coalesce(v.metadata, '{}'::jsonb) as metadata
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

    const insertedEntries = Array.isArray(entriesResult?.[0]?.entries)
      ? entriesResult[0].entries
      : [];
    if (Array.isArray(insertedEntries) && insertedEntries.length !== entryRecords.length) {
      const mismatch = new Error("Inserted entries count mismatch");
      mismatch.code = "chips_entries_mismatch";
      mismatch.status = 500;
      klog("chips_entries_mismatch", {
        expected: entryRecords.length,
        actual: insertedEntries.length,
        idempotencyKey,
      });
      throw mismatch;
    }

    const accountRows = await sqlTx`
      select id, balance, next_entry_seq
      from public.chips_accounts
      where id = ${userAccount.id}
      limit 1;
    `;

    return {
      transaction: transactionRow,
      entries: insertedEntries,
      account: accountRows?.[0] || null,
    };
  };

  try {
    result = tx ? await runInTx(tx) : await beginSql(async sqlTx => runInTx(sqlTx));
  } catch (error) {
    const combined = `${error.message || ""} ${error.details || ""}`.toLowerCase();
    const constraint = (error?.constraint || "").toLowerCase();
    const is23505 = error?.code === "23505";
    const mentionsIdempotency =
      constraint.includes("chips_transactions_idempotency_key") ||
      combined.includes("idempotency") ||
      combined.includes("idempotency_key") ||
      combined.includes("chips_transactions_idempotency_key_uidx");
    const looksUnique =
      combined.includes("duplicate key value") ||
      combined.includes("duplicate key") ||
      combined.includes("violates unique constraint") ||
      combined.includes("duplicate");
    const isIdempotencyUnique = (is23505 && mentionsIdempotency) || (looksUnique && mentionsIdempotency);
    if (isIdempotencyUnique) {
      const existingTx = await findTransactionByKey(idempotencyKey, tx);
      if (existingTx) {
        if (existingTx.user_id && existingTx.user_id !== userId) {
          const conflict = new Error("Idempotency key already used by another user");
          conflict.status = 409;
          throw conflict;
        }
        if (existingTx.payload_hash !== payloadHash || existingTx.tx_type !== txType) {
          const conflict = new Error("Idempotency key already used with different payload");
          conflict.status = 409;
          throw conflict;
        }
        const snapshot = await fetchTransactionSnapshotByTxId(existingTx.id, userId, tx);
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

  if (!result?.transaction) {
    klog("chips_tx_missing_rows", { idempotencyKey });
    throw new Error("Failed to record transaction");
  }

  return result;
}

export {
  VALID_TX_TYPES,
  getUserBalance,
  listUserLedgerAfterSeq,
  listUserLedger,
  postTransaction,
};
