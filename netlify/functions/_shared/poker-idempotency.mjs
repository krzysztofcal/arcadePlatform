const parseResultJson = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
};

const isRequestPendingStale = (row, staleSec) => {
  if (!row?.created_at) return false;
  const createdAtMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs > staleSec * 1000;
};

const defaultReadSql =
  "select result_json, created_at from public.poker_requests where table_id = $1 and user_id = $2 and request_id = $3 and kind = $4 limit 1;";

const readPokerRequest = async (tx, { tableId, userId, requestId, kind, readSql }) =>
  tx.unsafe(readSql || defaultReadSql, [tableId, userId, requestId, kind]);

const insertPokerRequest = async (tx, { tableId, userId, requestId, kind }) =>
  tx.unsafe(
    `insert into public.poker_requests (table_id, user_id, request_id, kind)
     values ($1, $2, $3, $4)
     on conflict (table_id, kind, request_id, user_id) do nothing
     returning request_id;`,
    [tableId, userId, requestId, kind]
  );

export const deletePokerRequest = async (tx, { tableId, userId, requestId, kind }) => {
  if (!requestId) return;
  await tx.unsafe(
    "delete from public.poker_requests where table_id = $1 and user_id = $2 and request_id = $3 and kind = $4;",
    [tableId, userId, requestId, kind]
  );
};

export const ensurePokerRequest = async (tx, { tableId, userId, requestId, kind, pendingStaleSec, readSql }) => {
  if (!requestId) return { status: "none" };
  const rows = await readPokerRequest(tx, { tableId, userId, requestId, kind, readSql });
  const existingRow = rows?.[0];
  const stored = parseResultJson(existingRow?.result_json);
  if (stored) return { status: "stored", result: stored };
  if (existingRow && !isRequestPendingStale(existingRow, pendingStaleSec)) return { status: "pending" };
  if (existingRow) {
    await deletePokerRequest(tx, { tableId, userId, requestId, kind });
  }

  let insertedRows = await insertPokerRequest(tx, { tableId, userId, requestId, kind });
  if (insertedRows?.[0]?.request_id) return { status: "created" };

  const conflictRows = await readPokerRequest(tx, { tableId, userId, requestId, kind, readSql });
  const conflictRow = conflictRows?.[0];
  if (!conflictRow) return { status: "created" };
  const conflictStored = parseResultJson(conflictRow?.result_json);
  if (conflictStored) return { status: "stored", result: conflictStored };
  if (conflictRow && isRequestPendingStale(conflictRow, pendingStaleSec)) {
    await deletePokerRequest(tx, { tableId, userId, requestId, kind });
    insertedRows = await insertPokerRequest(tx, { tableId, userId, requestId, kind });
    if (insertedRows?.[0]?.request_id) return { status: "created" };
  }
  return { status: "pending" };
};

export const storePokerRequestResult = async (tx, { tableId, userId, requestId, kind, result }) => {
  if (!requestId) return;
  await tx.unsafe(
    "update public.poker_requests set result_json = $5::jsonb where table_id = $1 and user_id = $2 and request_id = $3 and kind = $4;",
    [tableId, userId, requestId, kind, JSON.stringify(result)]
  );
};
