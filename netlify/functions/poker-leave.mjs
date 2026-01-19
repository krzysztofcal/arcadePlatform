import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";

const REQUEST_PENDING_STALE_SEC = 30;

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const normalizeState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};

const parseSeats = (value) => (Array.isArray(value) ? value : []);

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const normalizeSeatStack = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
};

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

const isRequestPendingStale = (row) => {
  if (!row?.created_at) return false;
  const createdAtMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdAtMs)) return false;
  return Date.now() - createdAtMs > REQUEST_PENDING_STALE_SEC * 1000;
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);

  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableIdRaw = typeof tableIdValue === "string" ? tableIdValue : "";
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdValue = payload?.requestId;
  const requestIdTrimmed = typeof requestIdValue === "string" ? requestIdValue.trim() : "";
  const requestIdPresent = requestIdTrimmed !== "";
  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok) {
    const requestIdType = typeof requestIdValue;
    const requestIdPreview = requestIdTrimmed ? requestIdTrimmed.slice(0, 50) : null;
    klog("poker_request_id_invalid", {
      fn: "leave",
      tableId,
      requestIdType,
      requestIdPreview,
      requestIdPresent,
      reason: "normalize_failed",
    });
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = requestIdParsed.value;

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  const userId = auth.userId || null;
  klog("poker_leave_start", {
    tableId,
    tableIdRaw: tableIdRaw || null,
    userId,
    hasAuth: !!(auth.valid && auth.userId),
    requestIdPresent,
  });

  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    let txId = null;
    const result = await beginSql(async (tx) => {
      if (requestId) {
        const requestRows = await tx.unsafe(
          "select result_json, created_at from public.poker_requests where table_id = $1 and request_id = $2 limit 1;",
          [tableId, requestId]
        );
        const existingRow = requestRows?.[0];
        if (existingRow) {
          const stored = parseResultJson(existingRow.result_json);
          if (stored) return stored;
          if (isRequestPendingStale(existingRow)) {
            await tx.unsafe("delete from public.poker_requests where table_id = $1 and request_id = $2;", [
              tableId,
              requestId,
            ]);
          } else {
            return { ok: false, pending: true, requestId };
          }
        }

        const insertRequest = () =>
          tx.unsafe(
            `insert into public.poker_requests (table_id, user_id, request_id, kind)
           values ($1, $2, $3, 'LEAVE')
           on conflict (table_id, request_id) do nothing
           returning request_id;`,
            [tableId, auth.userId, requestId]
          );
        let insertedRows = await insertRequest();
        const hasRequest = !!insertedRows?.[0]?.request_id;
        if (!hasRequest) {
          const existingRows = await tx.unsafe(
            "select result_json, created_at from public.poker_requests where table_id = $1 and request_id = $2 limit 1;",
            [tableId, requestId]
          );
          const existingConflict = existingRows?.[0];
          const stored = parseResultJson(existingConflict?.result_json);
          if (stored) return stored;
          if (existingConflict && isRequestPendingStale(existingConflict)) {
            await tx.unsafe("delete from public.poker_requests where table_id = $1 and request_id = $2;", [
              tableId,
              requestId,
            ]);
            insertedRows = await insertRequest();
            if (!insertedRows?.[0]?.request_id) {
              return { ok: false, pending: true, requestId };
            }
          } else {
            return { ok: false, pending: true, requestId };
          }
        }
      }

      try {
        const tableRows = await tx.unsafe("select id, status from public.poker_tables where id = $1 limit 1;", [tableId]);
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }

        const seatRows = await tx.unsafe(
          "select seat_no, status, stack from public.poker_seats where table_id = $1 and user_id = $2 for update;",
          [tableId, auth.userId]
        );
        const seatRow = seatRows?.[0] || null;
        const seatNo = seatRow?.seat_no;
        if (!Number.isInteger(seatNo)) {
          throw makeError(409, "not_seated");
        }

        const stateRows = await tx.unsafe(
          "select version, state from public.poker_state where table_id = $1 for update;",
          [tableId]
        );
        const stateRow = stateRows?.[0] || null;
        if (!stateRow) {
          throw new Error("poker_state_missing");
        }

        const currentState = normalizeState(stateRow.state);
        const stacks = parseStacks(currentState.stacks);
        const stackValue = normalizeSeatStack(seatRow?.stack);
        const cashOutAmount = stackValue ?? 0;
        if (!stackValue || cashOutAmount === 0) {
          klog("poker_leave_stack_missing", { tableId, userId: auth.userId, seatNo });
        }

        if (cashOutAmount > 0) {
          const escrowSystemKey = `POKER_TABLE:${tableId}`;
          const idempotencyKey = requestId
            ? `poker:leave:${requestId}`
            : `poker:leave:${tableId}:${auth.userId}:${cashOutAmount}`;

          const txResult = await postTransaction({
            userId: auth.userId,
            txType: "TABLE_CASH_OUT",
            idempotencyKey,
            entries: [
              { accountType: "ESCROW", systemKey: escrowSystemKey, amount: -cashOutAmount },
              { accountType: "USER", amount: cashOutAmount },
            ],
            createdBy: auth.userId,
            tx,
          });
          txId = txResult?.transaction?.id || null;
        }
        klog("poker_leave_cashout", {
          tableId,
          userId: auth.userId,
          amount: cashOutAmount,
          seatNo,
          hadStack: stackValue != null,
        });

        const seats = parseSeats(currentState.seats).filter((seatItem) => seatItem?.userId !== auth.userId);
        const updatedStacks = { ...stacks };
        delete updatedStacks[auth.userId];

        const updatedState = {
          ...currentState,
          tableId: currentState.tableId || tableId,
          seats,
          stacks: updatedStacks,
          pot: Number.isFinite(currentState.pot) ? currentState.pot : 0,
          phase: currentState.phase || "INIT",
        };

        await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [
          tableId,
          auth.userId,
        ]);
        await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [tableId, auth.userId]);
        await tx.unsafe(
          "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1;",
          [tableId, JSON.stringify(updatedState)]
        );

        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        const resultPayload = { ok: true, tableId, cashedOut: cashOutAmount, seatNo: seatNo ?? null };
        if (requestId) {
          await tx.unsafe(
            "update public.poker_requests set result_json = $3::jsonb where table_id = $1 and request_id = $2;",
            [tableId, requestId, JSON.stringify(resultPayload)]
          );
        }
        klog("poker_leave_ok", {
          tableId,
          userId: auth.userId,
          requestId: requestId || null,
          cashedOut: !!stackValue,
          txId,
        });
        return resultPayload;
      } catch (error) {
        if (requestId) {
          await tx.unsafe("delete from public.poker_requests where table_id = $1 and request_id = $2;", [
            tableId,
            requestId,
          ]);
        }
        throw error;
      }
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(result),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      klog("poker_leave_error", {
        tableId,
        userId: auth.userId || null,
        code: error.code,
        message: error.message || null,
      });
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_leave_error", {
      tableId,
      userId: auth?.userId || null,
      code: error?.code || "server_error",
      message: error?.message || "unknown_error",
    });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
