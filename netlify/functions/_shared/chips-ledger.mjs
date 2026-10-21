import crypto from "node:crypto";
import { lockAccountLifecycle, assertAccountActive, deletionPokerSeatPendingSql } from "../../../shared/account-deletion.mjs";

const deletionEnabled = () => process.env.ACCOUNT_DELETION_ENABLED === "1";
const INTERNAL_DELETION = Symbol("trusted deletion ledger effect");
const financialMismatch = () => Object.assign(new Error("financial_mismatch"), { code: "financial_mismatch" });
import { beginSql, executeSql, klog } from "./supabase-admin.mjs";

const VALID_TX_TYPES = new Set([
  "MINT",
  "BURN",
  "BUY_IN",
  "CASH_OUT",
  "ADMIN_ADJUST",
  "TABLE_BUY_IN",
  "TABLE_CASH_OUT",
  "HAND_SETTLEMENT",
  "RAKE_FEE",
  "PRIZE_PAYOUT",
  "WELCOME_BONUS",
  "PROMO_BONUS",
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
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  normalized = normalized.replace(/\+00$/, "Z");
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuidLike = (value) => UUID_RE.test(String(value || "").trim());

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const assertPlainObjectOrNull = (value, code) => {
  if (value == null) return;
  if (!isPlainObject(value)) {
    throw badRequest(code, "Metadata must be a plain JSON object");
  }
};

const FULL_REPLAY_TX_TYPES = new Set([
  "BUY_IN",
  "CASH_OUT",
  "WELCOME_BONUS",
  "PROMO_BONUS",
  "ADMIN_ADJUST",
]);

const requiresFullReplay = (record) => FULL_REPLAY_TX_TYPES.has(String(record?.tx_type || ""))
  || (record?.tx_type === "BURN" && /^account-delete:[0-9a-f-]{36}:burn:v1$/i.test(record.idempotency_key || ""));

const idempotencyError = (code, message, status = 503) => {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
};

const mapTableLifecycleError = (error) => {
  if (error?.code === "P8901" || error?.code === "P8902") {
    const mapped = new Error("TABLE idempotency key or binding is invalid");
    mapped.code = "invalid_table_binding";
    mapped.status = 400;
    mapped.cause = error;
    return mapped;
  }
  if (error?.code !== "P8903" && error?.code !== "P8904") return error;
  const mapped = new Error(error.code === "P8903" ? "TABLE table is closed" : "TABLE idempotency binding is retired");
  mapped.code = error.code === "P8903" ? "table_closed" : "idempotency_retired";
  mapped.status = 409;
  mapped.cause = error;
  return mapped;
};

const normalizeIdempotencyUserId = (value) => {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
};

function assertIdempotencyMatch(record, { idempotencyKey, payloadUserId, txType, payloadHash }) {
  const recordUserId = normalizeIdempotencyUserId(record?.user_id);
  const expectedUserId = payloadUserId || null;
  if (
    recordUserId !== expectedUserId
    || String(record?.tx_type || "") !== String(txType || "")
    || String(record?.payload_hash || "") !== String(payloadHash || "")
  ) {
    klog("chips_idempotency_identity_mismatch", {
      idempotencyKey,
      expected_user_id: expectedUserId,
      actual_user_id: recordUserId,
      expected_tx_type: txType,
      actual_tx_type: record?.tx_type || null,
    });
    throw idempotencyError("chips_idempotency_conflict", "Idempotency key already used with different identity", 409);
  }
}

async function findIdempotencyRecord(idempotencyKey, tx = null) {
  const query = `
select idempotency_key, transaction_id, payload_hash, tx_type::text as tx_type, user_id,
       transaction_created_at, replay_transaction, replay_entries, replay_completed_at, created_at
from public.chips_transaction_idempotency
where idempotency_key = $1
limit 1;
`;
  const runner = tx ? (q, params) => tx.unsafe(q, params) : executeSql;
  return (await runner(query, [idempotencyKey]))?.[0] || null;
}

async function fetchCurrentUserAccountSnapshot(userId, tx = null) {
  const normalizedUserId = normalizeIdempotencyUserId(userId);
  if (!normalizedUserId) return null;
  const query = `
select id, balance, next_entry_seq
from public.chips_accounts
where ${deletionEnabled() ? 'coalesce(user_id, retired_user_id)' : 'user_id'} = $1 and account_type = 'USER'
limit 1;
`;
  const runner = tx ? (q, params) => tx.unsafe(q, params) : executeSql;
  return (await runner(query, [normalizedUserId]))?.[0] || null;
}

const parseStoredJson = (value, label) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw idempotencyError("chips_idempotency_replay_unavailable", `Invalid ${label} replay snapshot`);
  }
};

async function resolveIdempotentReplay(record, input, tx = null) {
  assertIdempotencyMatch(record, input);
  const hotSnapshot = await fetchTransactionSnapshotByTxId(
    record.transaction_id,
    normalizeIdempotencyUserId(input.payloadUserId),
    tx,
  );
  const fullReplay = requiresFullReplay(record);
  if (hotSnapshot?.transaction && (!fullReplay || (Array.isArray(hotSnapshot.entries) && hotSnapshot.entries.length > 0))) {
    return hotSnapshot;
  }

  if (!fullReplay) {
    return {
      transaction: {
        id: String(record.transaction_id),
        idempotency_key: record.idempotency_key,
        payload_hash: record.payload_hash,
        tx_type: record.tx_type,
        user_id: record.user_id || null,
        created_at: asIso(record.transaction_created_at),
      },
      entries: [],
      account: null,
    };
  }

  const transaction = parseStoredJson(record.replay_transaction, "transaction");
  const entries = parseStoredJson(record.replay_entries, "entries");
  const snapshotUserId = normalizeIdempotencyUserId(transaction?.user_id);
  if (
    !isPlainObject(transaction)
    || !Array.isArray(entries)
    || !record.replay_completed_at
    || String(transaction.id || "") !== String(record.transaction_id)
    || String(transaction.idempotency_key || "") !== String(record.idempotency_key)
    || String(transaction.payload_hash || "") !== String(record.payload_hash)
    || String(transaction.tx_type || "") !== String(record.tx_type)
    || snapshotUserId !== normalizeIdempotencyUserId(record.user_id)
    || entries.length === 0
  ) {
    klog("chips_idempotency_replay_snapshot_missing", {
      idempotencyKey: record.idempotency_key,
      txType: record.tx_type,
      transactionId: record.transaction_id,
    });
    throw idempotencyError("chips_idempotency_replay_unavailable", "Required idempotency replay snapshot is unavailable");
  }
  const account = await fetchCurrentUserAccountSnapshot(record.user_id || input.payloadUserId, tx);
  if (record.user_id && !account) {
    klog("chips_idempotency_replay_account_missing", {
      idempotencyKey: record.idempotency_key,
      userId: record.user_id,
    });
    throw idempotencyError("chips_idempotency_replay_unavailable", "Current account snapshot is unavailable");
  }
  return { transaction, entries, account };
}

async function storeIdempotencyReplay(record, result, tx) {
  if (!requiresFullReplay(record)) return record;
  if (!result?.transaction || !Array.isArray(result.entries)) {
    throw idempotencyError("chips_idempotency_replay_unavailable", "Cannot store incomplete idempotency replay snapshot");
  }
  let transactionJson;
  let entriesJson;
  try {
    transactionJson = JSON.stringify(result.transaction);
    entriesJson = JSON.stringify(result.entries);
  } catch {
    throw idempotencyError("chips_idempotency_replay_unavailable", "Cannot serialize idempotency replay snapshot");
  }
  const transactionParam = typeof tx?.json === "function"
    ? tx.json(JSON.parse(transactionJson))
    : transactionJson;
  const entriesParam = typeof tx?.json === "function"
    ? tx.json(JSON.parse(entriesJson))
    : entriesJson;
  const rows = await tx.unsafe(`
update public.chips_transaction_idempotency
set replay_transaction = $2::jsonb,
    replay_entries = $3::jsonb,
    replay_completed_at = timezone('utc', now())
where idempotency_key = $1
  and replay_transaction is null
  and replay_entries is null
  and replay_completed_at is null
returning idempotency_key, transaction_id, payload_hash, tx_type::text as tx_type, user_id,
          transaction_created_at, replay_transaction, replay_entries, replay_completed_at, created_at;
`, [record.idempotency_key, transactionParam, entriesParam]);
  if (rows?.[0]) return rows[0];
  klog("chips_idempotency_replay_store_failed", {
    idempotencyKey: record.idempotency_key,
    transactionId: record.transaction_id,
    txType: record.tx_type,
  });
  throw idempotencyError("chips_idempotency_replay_unavailable", "Idempotency replay snapshot could not be stored");
}

function isIdempotencyUniqueError(error) {
  const combined = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  const constraint = (error?.constraint || "").toLowerCase();
  const is23505 = error?.code === "23505";
  const mentionsIdempotency =
    constraint.includes("chips_transactions_idempotency_key")
    || constraint.includes("chips_transaction_idempotency")
    || combined.includes("idempotency")
    || combined.includes("idempotency_key");
  const looksUnique =
    combined.includes("duplicate key value")
    || combined.includes("duplicate key")
    || combined.includes("violates unique constraint")
    || combined.includes("duplicate");
  return (is23505 && mentionsIdempotency) || (looksUnique && mentionsIdempotency);
}

async function getOrCreateUserAccount(userId, tx = null, internalAuthorization = null) {
  if (deletionEnabled()) {
    if (!tx) return beginSql((activeTx) => getOrCreateUserAccount(userId, activeTx, internalAuthorization));
    await lockAccountLifecycle(tx, [userId]);
    if (internalAuthorization?.capability !== INTERNAL_DELETION || internalAuthorization.userId !== userId) {
      await assertAccountActive(tx, userId);
    }
    const retired = await tx.unsafe("select id from public.chips_accounts where retired_user_id=$1 and account_type='USER' limit 1;", [userId]);
    if (retired.length) throw Object.assign(new Error("account_retired"), { code: "account_retired" });
  }
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
  if (account.status !== "active") throw Object.assign(new Error("account_not_active"), { code: "account_not_active" });
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
    const createdIso = asIso(createdAt);
    if (!createdIso) {
      throw badRequest("invalid_cursor", "Invalid cursor");
    }
    const entrySeq = parsePositiveInt(payload?.entrySeq ?? payload?.entry_seq);
    if (entrySeq === null) {
      throw badRequest("invalid_cursor", "Invalid cursor");
    }
    return { createdAt: createdIso, entrySeq, mode: "entry_seq" };
  }
  const timestampOnly = payload?.displayCreatedAt || payload?.display_created_at || payload?.createdAt || payload?.created_at;
  if (timestampOnly) {
    klog("chips:ledger_timestamp_only_cursor", {
      has_displayCreatedAt: payload?.displayCreatedAt != null,
      has_display_created_at: payload?.display_created_at != null,
      has_createdAt: payload?.createdAt != null,
      has_created_at: payload?.created_at != null,
    });
  }
  throw badRequest("invalid_cursor", "Invalid cursor");
}

function encodeLedgerCursor(cursor) {
  if (!cursor || typeof cursor !== "object") return null;
  const sortId = cursor.sortId;
  const createdAt = cursor.createdAt;
  const entrySeq = cursor.entrySeq;
  if (sortId) {
    if (typeof sortId !== "string" || !/^\d+$/.test(sortId) || sortId === "0") return null;
    try {
      const payload = JSON.stringify({ sortId });
      return Buffer.from(payload, "utf8").toString("base64");
    } catch (_err) {
      return null;
    }
  }
  if (createdAt && entrySeq != null) {
    if (typeof createdAt !== "string" || !createdAt.trim()) return null;
    if (!Number.isInteger(entrySeq) || entrySeq <= 0) return null;
    try {
      const payload = JSON.stringify({ createdAt, entrySeq });
      return Buffer.from(payload, "utf8").toString("base64");
    } catch (_err) {
      return null;
    }
  }
  return null;
}

function findLastCursorCandidate(entries) {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const sortId = parsePositiveIntString(entry?.sort_id);
    if (sortId !== null) {
      return { sortId };
    }
    const createdAt = entry?.display_created_at || entry?.created_at || entry?.tx_created_at || null;
    const parsedEntrySeq = parsePositiveInt(entry?.entry_seq);
    if (createdAt && parsedEntrySeq !== null) {
      return { createdAt, entrySeq: parsedEntrySeq };
    }
  }
  return null;
}

async function listUserLedgerAfterSeq(userId, { afterSeq = null, limit = 50 } = {}) {
  const cappedLimit = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 50), 200);
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
  join public.chips_accounts a on a.id = e.account_id
  where a.account_type = 'USER'
    and a.user_id = $1
    and ($2::bigint is null or e.entry_seq > $2)
  order by e.entry_seq asc
  limit $3
)
select * from entries;
`;
  await getOrCreateUserAccount(userId);
  const rows = await executeSql(query, [userId, parsedAfterSeq, cappedLimit]);
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
    const displayCreatedAt = asIso(row?.display_created_at) || resolveDisplayCreatedAt(row, {
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

function normalizeLedgerRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
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
    const displayCreatedAt = asIso(row?.display_created_at) || resolveDisplayCreatedAt(row, {
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
}

async function listUserLedger(userId, options = {}) {
  const { cursor = null, limit = 50 } = options;
  const cappedLimit = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 50), 200);
  await getOrCreateUserAccount(userId);
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
  join public.chips_accounts a on a.id = e.account_id
  where a.account_type = 'USER'
    and a.user_id = $1
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
  join public.chips_accounts a on a.id = e.account_id
  where a.account_type = 'USER'
    and a.user_id = $1
    and (
      $2::timestamptz is null
      or (coalesce(e.created_at, t.created_at), e.entry_seq) < ($2::timestamptz, $3::bigint)
    )
  order by coalesce(e.created_at, t.created_at) desc nulls last, e.entry_seq desc
  limit $4
)
select * from entries;
`;
  const useLegacy = parsedCursor?.mode === "entry_seq";
  const rows = await executeSql(
    useLegacy ? legacyQuery : sortQuery,
    useLegacy
      ? [userId, parsedCursor?.createdAt || null, cursorEntrySeq, cappedLimit]
      : [userId, cursorSortId, cappedLimit],
  );
  const rowList = Array.isArray(rows) ? rows : [];
  const hasFullPage = rowList.length === cappedLimit;
  const normalizedEntries = normalizeLedgerRows(rowList);
  const cursorCandidate = hasFullPage ? findLastCursorCandidate(normalizedEntries) : null;
  if (!cursorCandidate && hasFullPage) {
    klog("chips:ledger_cursor_missing", { count: normalizedEntries.length });
  }
  const nextCursor = cursorCandidate
    ? encodeLedgerCursor(cursorCandidate)
    : null;

  return { entries: normalizedEntries, items: normalizedEntries, nextCursor };
}

async function listUserLedgerPage(userId, options = {}) {
  const requestedPage = Number(options.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedLimit = Number(options.limit);
  const limit = Math.min(Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : 10), 50);
  await getOrCreateUserAccount(userId);
  const countQuery = `
select count(*) as total
from public.chips_entries e
join public.chips_accounts a on a.id = e.account_id
where a.account_type = 'USER'
  and a.user_id = $1;
`;
  const pageQuery = `
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
join public.chips_accounts a on a.id = e.account_id
where a.account_type = 'USER'
  and a.user_id = $1
order by e.id desc
offset $2
limit $3;
`;
  const countRows = await executeSql(countQuery, [userId]);
  const parsedTotal = Number(countRows?.[0]?.total);
  const total = Number.isSafeInteger(parsedTotal) && parsedTotal >= 0 ? parsedTotal : 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const resolvedPage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const offset = (resolvedPage - 1) * limit;
  const rows = await executeSql(pageQuery, [userId, offset, limit]);
  const rowList = Array.isArray(rows) ? rows : [];
  const items = normalizeLedgerRows(rowList);
  return {
    entries: items,
    items,
    pagination: {
      page: resolvedPage,
      limit,
      total,
      totalPages,
      hasPreviousPage: resolvedPage > 1,
      hasNextPage: resolvedPage < totalPages,
    },
  };
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
  where ${deletionEnabled() ? 'coalesce(user_id, retired_user_id)' : 'user_id'} = coalesce($2::uuid, (select user_id from txn))
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

function validateEntries(entries, payloadUserId, { txType = null, createdBy = null } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw badRequest("missing_entries", "At least one entry is required");
  }
  const sanitized = [];
  let hasUserEntry = false;
  let hasEscrowEntry = false;
  let hasSystemEntry = false;
  let escrowEntryCount = 0;
  let systemEntryCount = 0;
  let escrowAmount = 0;
  let systemAmount = 0;
  for (const entry of entries) {
    const amount = Number(entry?.amount);
    const kind = entry?.accountType || entry?.kind;
    const systemKey = entry?.systemKey;
    const rawEntryUserId = entry?.userId;
    const hasEntryUserId = rawEntryUserId !== undefined && rawEntryUserId !== null;
    const entryUserId = hasEntryUserId ? String(rawEntryUserId).trim() : "";
    if (!Number.isInteger(amount) || amount === 0) {
      throw badRequest("invalid_entry_amount", "Entry amount must be a non-zero integer");
    }
    if (kind !== "USER" && kind !== "SYSTEM" && kind !== "ESCROW") {
      throw badRequest("unsupported_account_type", "Unsupported accountType in entry");
    }
    if (kind === "ESCROW") {
      hasEscrowEntry = true;
      escrowEntryCount += 1;
      escrowAmount += amount;
    }
    if (kind === "SYSTEM") {
      hasSystemEntry = true;
      systemEntryCount += 1;
      systemAmount += amount;
    }
    if (kind !== "USER" && !systemKey) {
      throw badRequest("missing_system_key", "System entries must provide systemKey");
    }
    let effectiveUserId = null;
    if (kind === "USER") {
      hasUserEntry = true;
      if (hasEntryUserId) {
        if (!entryUserId) {
          throw badRequest("invalid_entry_user", "USER entry userId must be non-empty string");
        }
        effectiveUserId = entryUserId;
      } else {
        const fallbackUserId = String(payloadUserId == null ? "" : payloadUserId).trim();
        if (!fallbackUserId) {
          throw badRequest("invalid_entry_user", "USER entries require a user id");
        }
        effectiveUserId = fallbackUserId;
      }
      if (!isUuidLike(effectiveUserId)) {
        throw badRequest("invalid_entry_user", "USER entry userId must be a UUID");
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(entry, "metadata") &&
      entry.metadata != null &&
      !isPlainObject(entry.metadata)
    ) {
      throw badRequest("invalid_entry_metadata", "Entry metadata must be a plain JSON object");
    }
    const metadata = entry?.metadata ?? {};
    sanitized.push({ kind, systemKey, amount, metadata, ...(kind === "USER" ? { userId: effectiveUserId } : {}) });
  }
  const payloadUserIdNormalized = String(payloadUserId == null ? "" : payloadUserId).trim();
  const createdByNormalized = String(createdBy == null ? "" : createdBy).trim();
  const entryKind = (entry) => entry?.accountType || entry?.kind;
  const allowEscrowOnlyTableBuyIn =
    !hasUserEntry &&
    txType === "TABLE_BUY_IN" &&
    payloadUserIdNormalized === "" &&
    isUuidLike(createdByNormalized) &&
    entries.length === 2 &&
    hasEscrowEntry &&
    hasSystemEntry &&
    escrowEntryCount === 1 &&
    systemEntryCount === 1 &&
    systemAmount < 0 &&
    escrowAmount > 0 &&
    (systemAmount + escrowAmount) === 0;
  const allowEscrowOnlyTableCashOut =
    !hasUserEntry &&
    txType === "TABLE_CASH_OUT" &&
    payloadUserIdNormalized === "" &&
    (createdByNormalized === "" || isUuidLike(createdByNormalized)) &&
    entries.length === 2 &&
    hasEscrowEntry &&
    hasSystemEntry &&
    escrowEntryCount === 1 &&
    systemEntryCount === 1 &&
    escrowAmount < 0 &&
    systemAmount > 0 &&
    (systemAmount + escrowAmount) === 0;
  if (!hasUserEntry && txType === "TABLE_BUY_IN" && !allowEscrowOnlyTableBuyIn) {
    throw badRequest("invalid_escrow_only_entries", "Escrow-only TABLE_BUY_IN requires SYSTEM(-) and ESCROW(+) strict shape");
  }
  if (!hasUserEntry && txType === "TABLE_CASH_OUT" && !allowEscrowOnlyTableCashOut) {
    throw badRequest("invalid_escrow_only_entries", "Escrow-only TABLE_CASH_OUT requires ESCROW(-) and SYSTEM(+) strict shape");
  }
  if (!hasUserEntry && txType === "MINT") {
    throw badRequest("missing_user_entry", "System-only MINT is not authorized through the application ledger");
  }
  if (!hasUserEntry && txType !== "TABLE_BUY_IN" && txType !== "TABLE_CASH_OUT" && txType !== "MINT") {
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
  internalAuthorization = null,
}) {
  if (!VALID_TX_TYPES.has(txType)) {
    throw badRequest("invalid_tx_type", "Invalid transaction type");
  }
  if (!idempotencyKey) {
    throw badRequest("missing_idempotency_key", "Idempotency key is required");
  }

  const payloadUserIdRaw = String(userId == null ? "" : userId).trim();
  const userEntryFallbackNeeded = Array.isArray(entries)
    ? entries.some((entry) => {
      const kind = entry?.accountType || entry?.kind;
      return kind === "USER" && (entry?.userId === undefined || entry?.userId === null || String(entry.userId).trim() === "");
    })
    : false;
  if (payloadUserIdRaw && !isUuidLike(payloadUserIdRaw) && userEntryFallbackNeeded) {
    throw badRequest("invalid_user_id", "userId must be a UUID");
  }
  const payloadUserId = isUuidLike(payloadUserIdRaw) ? payloadUserIdRaw : "";

  const normalizedEntries = validateEntries(entries, payloadUserId, {
    txType,
    createdBy,
  });
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

  const hashableEntries = normalizedEntries.map((entry) => ({
    kind: entry.kind,
    userId: entry.kind === "USER" ? (entry.userId ?? null) : null,
    systemKey: entry.systemKey ?? null,
    amount: entry.amount,
    metadata: entry.metadata ?? {},
  }));

  let payloadHash;
  try {
    payloadHash = hashPayload({
      userId: payloadUserId || null,
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

  const existingIdempotency = await findIdempotencyRecord(idempotencyKey, tx);
  if (existingIdempotency) {
    return resolveIdempotentReplay(existingIdempotency, {
      idempotencyKey,
      payloadUserId,
      txType,
      payloadHash,
    }, tx);
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
  for (const entry of normalizedEntries) {
    if (entry.kind === "USER") continue;
    const account = systemMap.get(entry.systemKey);
    if (account?.account_type !== entry.kind) {
      throw badRequest("system_account_type_mismatch", `Account ${entry.systemKey} does not match ${entry.kind}`);
    }
  }

  let result;
  let userAccount = null;
  const runInTx = async (sqlTx) => {
    const runNewTransaction = async (activeTx = sqlTx) => {
      // IMPORTANT: inside this block use ONLY `activeTx` for all SQL to keep it atomic.
      const userEntryIds = [...new Set(normalizedEntries.filter((entry) => entry.kind === "USER").map((entry) => entry.userId).filter(Boolean))];
      userEntryIds.sort();
      if (deletionEnabled()) {
        const actor = createdBy && userEntryIds.length && internalAuthorization?.capability !== INTERNAL_DELETION ? createdBy : null;
        await lockAccountLifecycle(activeTx,[...userEntryIds,...(actor ? [actor] : [])]);
        if (actor) await assertAccountActive(activeTx,actor);
      }
      const userAccountById = new Map();
      for (const userEntryId of userEntryIds) {
        userAccountById.set(userEntryId, await getOrCreateUserAccount(userEntryId, activeTx, internalAuthorization));
      }

      userAccount = payloadUserId ? (userAccountById.get(payloadUserId) || null) : null;

      for (const entry of normalizedEntries) {
        if (entry.kind === "USER" && !userAccountById.has(entry.userId)) {
          throw badRequest("invalid_entry_user", "USER entry userId must resolve to a user account");
        }
      }

      const entryRecords = normalizedEntries.map(entry => {
        if (entry.kind === "USER") {
          const safeEntryMetadata = entry?.metadata ?? {};
          return { account_id: userAccountById.get(entry.userId)?.id, amount: entry.amount, metadata: safeEntryMetadata };
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

      const txRows = await activeTx`
      insert into public.chips_transactions (reference, description, metadata, idempotency_key, payload_hash, tx_type, user_id, created_by)
      values (${reference}, ${description}, (${safeMetadataJson}::text)::jsonb, ${idempotencyKey}, ${payloadHash}, ${txType}, ${payloadUserId || null}, ${createdBy})
      returning *;
    `;

      const transactionRow = txRows?.[0];
      if (!transactionRow) {
        throw new Error("Failed to insert transaction row");
      }

      const applyResult = await activeTx.unsafe(
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

      const entriesResult = await activeTx.unsafe(
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
      if (insertedEntries.length !== entryRecords.length) {
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

      const shouldLoadUserAccountSnapshot = Boolean(payloadUserId && userAccount?.id);
      const accountRows = shouldLoadUserAccountSnapshot
        ? await activeTx`
      select id, balance, next_entry_seq
      from public.chips_accounts
      where id = ${userAccount.id}
      limit 1;
    `
        : [];

      const freshResult = {
        transaction: transactionRow,
        entries: insertedEntries,
        account: accountRows?.[0] || null,
      };
      const registryRecord = await findIdempotencyRecord(idempotencyKey, activeTx);
      if (!registryRecord) {
        throw idempotencyError("chips_idempotency_registry_missing", "Transaction idempotency registry row is missing");
      }
      await storeIdempotencyReplay(registryRecord, freshResult, activeTx);
      return freshResult;
    };

    const executeAttempt = async () => {
      if (typeof sqlTx.savepoint === "function") {
        return await sqlTx.savepoint("chips_idempotency_attempt", async (spTx) => {
          if (sqlTx?.klog && !spTx.klog) spTx.klog = sqlTx.klog;
          return await runNewTransaction(spTx);
        });
      }
      await sqlTx.unsafe("savepoint chips_idempotency_attempt;");
      try {
        const freshResult = await runNewTransaction(sqlTx);
        await sqlTx.unsafe("release savepoint chips_idempotency_attempt;");
        return freshResult;
      } catch (attemptError) {
        await sqlTx.unsafe("rollback to savepoint chips_idempotency_attempt;");
        await sqlTx.unsafe("release savepoint chips_idempotency_attempt;");
        throw attemptError;
      }
    };

    try {
      return await executeAttempt();
    } catch (error) {
      if (!isIdempotencyUniqueError(error)) throw error;
      const authoritativeRecord = await findIdempotencyRecord(idempotencyKey, sqlTx);
      if (!authoritativeRecord) throw error;
      return resolveIdempotentReplay(authoritativeRecord, {
        idempotencyKey,
        payloadUserId,
        txType,
        payloadHash,
      }, sqlTx);
    }
  };

  try {
    result = tx ? await runInTx(tx) : await beginSql(async sqlTx => runInTx(sqlTx));
  } catch (error) {
    throw mapTableLifecycleError(error);
  }

  if (!result?.transaction) {
    klog("chips_tx_missing_rows", { idempotencyKey });
    throw new Error("Failed to record transaction");
  }

  return result;
}

// Trusted Poker completion only. No caller-controlled boolean can bypass lifecycle.
async function postPokerLeaveCashout({ tx, tableId, userId, amount, idempotencyKey, createdBy = userId,
  description = null, metadata = { tableId } }) {
  if (!tx || !isUuidLike(userId) || !isUuidLike(tableId) || !Number.isSafeInteger(amount) || amount <= 0) throw financialMismatch();
  const input = { userId, txType: "TABLE_CASH_OUT", idempotencyKey, reference: `table:${tableId}`,
    description, metadata, createdBy, tx,
    entries: [{ accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -amount }, { accountType: "USER", amount }] };
  if (!deletionEnabled()) return postTransaction(input);
  // Table/state locks precede lifecycle/request/account locks throughout Poker.
  const [row] = await tx.unsafe("select state from public.poker_state where table_id=$1 for update;", [tableId]);
  await lockAccountLifecycle(tx, [userId]);
  const [request] = await tx.unsafe("select * from public.account_deletion_requests where old_user_id=$1 for update;", [userId]);
  if (!request) return postTransaction(input);
  const state = typeof row?.state === "string" ? JSON.parse(row.state) : row?.state;
  if (!["preparing", "poker"].includes(request.phase) || ["ERROR", "COMPLETED"].includes(request.status)
    || !["INIT", "SETTLED", "HAND_DONE"].includes(state?.phase)
    || Number(state?.stacks?.[userId]) !== amount) throw financialMismatch();
  return postTransaction({ ...input, internalAuthorization: { capability: INTERNAL_DELETION, userId } });
}

async function retireUserForDeletion({ tx, userId, requestId, assertLease }) {
  if (!deletionEnabled() || !tx || !isUuidLike(userId) || !isUuidLike(requestId) || typeof assertLease !== "function") {
    throw new Error("deletion_retirement_unavailable");
  }
  await lockAccountLifecycle(tx, [userId]);
  const request = await assertLease(tx);
  if (request?.request_id !== requestId || request.old_user_id !== userId || request.phase !== "burn"
    || request.status !== "PROCESSING" || request.progress?.poker?.done !== true) throw financialMismatch();
  let accounts = await tx.unsafe("select * from public.chips_accounts where account_type='USER' and coalesce(user_id,retired_user_id)=$1 for update;", [userId]);
  if (accounts.length === 0 && !request.progress.walletRetirement) {
    // An owner who never held CH still gets a permanent retired financial
    // identity; creating its empty live shell and retiring it is one transaction.
    await getOrCreateUserAccount(userId, tx, { capability: INTERNAL_DELETION, userId });
    accounts = await tx.unsafe("select * from public.chips_accounts where account_type='USER' and coalesce(user_id,retired_user_id)=$1 for update;", [userId]);
  }
  if (accounts.length !== 1) throw financialMismatch();
  const account = accounts[0];
  const saved = request.progress.walletRetirement;
  if (saved?.retiredAt) {
    if (saved.accountId !== account.id || account.retired_user_id !== userId || account.user_id != null
      || account.status !== "closed" || Number(account.balance) !== 0) throw financialMismatch();
    if (saved.noBurn === true) {
      if (saved.amount !== 0 || saved.burnPayload !== null || saved.burnTransactionId != null) throw financialMismatch();
    } else {
      if (!Number.isSafeInteger(saved.amount) || saved.amount <= 0 || typeof saved.burnPayload !== "string") throw financialMismatch();
      const registry = await findIdempotencyRecord(`account-delete:${requestId}:burn:v1`, tx);
      if (!registry || registry.transaction_id !== saved.burnTransactionId) throw financialMismatch();
      const replayed = await postTransaction({ ...JSON.parse(saved.burnPayload), tx });
      if (replayed.transaction.id !== saved.burnTransactionId) throw financialMismatch();
    }
    return { done: true, receipt: saved };
  }
  if (saved || account.retired_user_id || account.user_id !== userId || account.status !== "active") throw financialMismatch();
  const [obligations] = await tx.unsafe(`select
    exists(select 1 from public.poker_seats p where p.user_id=$1 and ${deletionPokerSeatPendingSql}) or
    exists(select 1 from public.poker_state where state->'stacks' ? $1::text
      or (state->>'phase' in ('PREFLOP','FLOP','TURN','RIVER','SHOWDOWN')
        and exists(select 1 from jsonb_array_elements(coalesce(state->'handSeats',state->'seats','[]'::jsonb)) s where s->>'userId'=$1::text))) as pending;`, [userId]);
  if (obligations?.pending !== false) throw financialMismatch();
  const amount = Number(account.balance);
  if (!Number.isSafeInteger(amount) || amount < 0) throw financialMismatch();
  const burnPayload = amount === 0 ? null : {
    userId, txType: "BURN", idempotencyKey: `account-delete:${requestId}:burn:v1`,
    reference: `account-delete:${requestId}`, description: "Account deletion final wallet burn",
    metadata: { requestId, reason: "ACCOUNT_DELETION" }, createdBy: userId,
    entries: [{ accountType: "USER", amount: -amount }, { accountType: "SYSTEM", systemKey: "GENESIS", amount }],
  };
  const receipt = { version: 1, accountId: account.id, amount, burnPayload: burnPayload ? JSON.stringify(burnPayload) : null, noBurn: amount === 0 };
  const store = async () => {
    const rows = await tx.unsafe(`update public.account_deletion_requests
      set progress=jsonb_set(progress,'{walletRetirement}',($2::text)::jsonb),progress_at=clock_timestamp()
      where request_id=$1 returning request_id;`, [requestId, JSON.stringify(receipt)]);
    if (rows.length !== 1) throw financialMismatch();
  };
  await store();
  if (burnPayload) {
    const burned = await postTransaction({ ...burnPayload, tx, internalAuthorization: { capability: INTERNAL_DELETION, userId } });
    if (!burned?.transaction?.id || Number(burned.account?.balance) !== 0) throw financialMismatch();
    receipt.burnTransactionId = burned.transaction.id;
    await store();
  }
  await assertLease(tx);
  const retired = await tx.unsafe(`update public.chips_accounts set user_id=null,retired_user_id=$2,
    retired_at=clock_timestamp(),status='closed' where id=$1 and user_id=$2 and balance=0 and status='active' returning retired_at;`, [account.id, userId]);
  if (retired.length !== 1) throw financialMismatch();
  receipt.retiredAt = asIso(retired[0].retired_at);
  await store();
  return { done: true, receipt };
}

export {
  VALID_TX_TYPES,
  retireUserForDeletion,
  postPokerLeaveCashout,
  getUserBalance,
  listUserLedgerAfterSeq,
  listUserLedger,
  listUserLedgerPage,
  postTransaction,
};
