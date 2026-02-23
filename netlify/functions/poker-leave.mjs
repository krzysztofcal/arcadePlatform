import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";
import { updatePokerStateOptimistic } from "./_shared/poker-state-write.mjs";
import { applyLeaveTable } from "./_shared/poker-reducer.mjs";
import { withoutPrivateState } from "./_shared/poker-state-utils.mjs";

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

const normalizeNonNegativeInt = (n) =>
  Number.isInteger(n) && n >= 0 && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;

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
      let mutated = false;
      const requestInfo = await ensurePokerRequest(tx, {
        tableId,
        userId: auth.userId,
        requestId,
        kind: "LEAVE",
        pendingStaleSec: REQUEST_PENDING_STALE_SEC,
      });
      if (requestInfo.status === "stored") return requestInfo.result;
      if (requestInfo.status === "pending") return { ok: false, pending: true, requestId };

      try {
        const tableRows = await tx.unsafe("select id, status from public.poker_tables where id = $1 limit 1;", [tableId]);
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }

        const stateRows = await tx.unsafe(
          "select version, state from public.poker_state where table_id = $1 for update;",
          [tableId]
        );
        const stateRow = stateRows?.[0] || null;
        if (!stateRow) {
          throw new Error("poker_state_missing");
        }
        const expectedVersion = Number(stateRow.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
          throw makeError(409, "state_invalid");
        }

        const currentState = normalizeState(stateRow.state);
        const stacks = parseStacks(currentState.stacks);
        const seatsBefore = parseSeats(currentState.seats);
        const alreadyLeft =
          !seatsBefore.some((seat) => seat?.userId === auth.userId) &&
          !Object.prototype.hasOwnProperty.call(stacks, auth.userId);

        const seatRows = await tx.unsafe(
          "select seat_no, status, stack from public.poker_seats where table_id = $1 and user_id = $2 for update;",
          [tableId, auth.userId]
        );
        const seatRow = seatRows?.[0] || null;
        const seatNo = seatRow?.seat_no;
        if (alreadyLeft || !Number.isInteger(seatNo)) {
          if (seatRow) {
            await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
              tableId,
              auth.userId,
            ]);
          }
          const resultPayload = {
            ok: true,
            tableId,
            cashedOut: 0,
            seatNo: Number.isInteger(seatNo) ? seatNo : null,
            status: "already_left",
          };
          await storePokerRequestResult(tx, {
            tableId,
            userId: auth.userId,
            requestId,
            kind: "LEAVE",
            result: resultPayload,
          });
          return resultPayload;
        }
        const rawSeatStack = seatRow ? seatRow.stack : null;
        const stackValue = normalizeSeatStack(rawSeatStack);
        const stateStackRaw = currentState?.stacks?.[auth.userId];
        const stateStack = normalizeNonNegativeInt(Number(stateStackRaw));
        const seatStack = normalizeNonNegativeInt(Number(rawSeatStack));
        const cashOutAmount = stateStack ?? seatStack ?? 0;
        const isStackMissing = rawSeatStack == null;
        if (isStackMissing) {
          klog("poker_leave_stack_missing", { tableId, userId: auth.userId, seatNo });
        }
        if (stackValue != null && stackValue < 0) {
          klog("poker_leave_stack_negative", { tableId, userId: auth.userId, seatNo, stack: stackValue });
        }

        if (cashOutAmount > 0) {
          const escrowSystemKey = `POKER_TABLE:${tableId}`;
          const idempotencyKey = requestId
            ? `poker:leave:${tableId}:${auth.userId}:${requestId}`
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
          mutated = true;
        }
        klog("poker_leave_cashout", {
          tableId,
          userId: auth.userId,
          amount: cashOutAmount,
          seatNo,
          stackSource: stateStack != null ? "state" : seatStack != null ? "seat" : "none",
          hadStack: stackValue != null,
        });

        const leaveApplied = applyLeaveTable(currentState, { userId: auth.userId, requestId });
        const leaveState = normalizeState(leaveApplied?.state);
        const currentPhase = typeof currentState.phase === "string" ? currentState.phase : "";
        const hasActiveHandId = typeof currentState.handId === "string" && currentState.handId.trim() !== "";
        const isActiveHandPhase = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"].includes(currentPhase);
        const wasParticipatingInHand =
          !currentState?.foldedByUserId?.[auth.userId] &&
          !currentState?.leftTableByUserId?.[auth.userId] &&
          !currentState?.sitOutByUserId?.[auth.userId] &&
          !currentState?.pendingAutoSitOutByUserId?.[auth.userId];
        const shouldDetachSeatAndStack = (!isActiveHandPhase && !hasActiveHandId) || !wasParticipatingInHand;

        const seats = shouldDetachSeatAndStack
          ? parseSeats(leaveState.seats).filter((seatItem) => seatItem?.userId !== auth.userId)
          : parseSeats(leaveState.seats);
        const updatedStacks = parseStacks(leaveState.stacks);
        if (shouldDetachSeatAndStack) {
          delete updatedStacks[auth.userId];
        }

        const updatedState = {
          ...leaveState,
          tableId: leaveState.tableId || tableId,
          seats,
          stacks: updatedStacks,
          pot: Number.isFinite(leaveState.pot) ? leaveState.pot : 0,
          phase: leaveState.phase || "INIT",
        };

        const updateResult = await updatePokerStateOptimistic(tx, {
          tableId,
          expectedVersion,
          nextState: updatedState,
        });
        if (!updateResult.ok) {
          if (updateResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          if (updateResult.reason === "conflict") {
            klog("poker_leave_conflict", { tableId, userId: auth.userId, expectedVersion });
            throw makeError(409, "state_conflict");
          }
          throw makeError(409, "state_invalid");
        }
        mutated = true;
        if (shouldDetachSeatAndStack) {
          await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
            tableId,
            auth.userId,
          ]);
        }

        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        const publicState = withoutPrivateState(updatedState);
        const resultPayload = {
          ok: true,
          tableId,
          cashedOut: cashOutAmount,
          seatNo: seatNo ?? null,
          state: {
            version: updateResult.newVersion,
            state: publicState,
          },
        };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "LEAVE",
          result: resultPayload,
        });
        klog("poker_leave_ok", {
          tableId,
          userId: auth.userId,
          requestId: requestId || null,
          cashedOut: cashOutAmount > 0,
          txId,
        });
        return resultPayload;
      } catch (error) {
        if (requestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId, kind: "LEAVE" });
        } else if (requestId && mutated) {
          klog("poker_leave_request_retained", { tableId, userId: auth.userId, requestId });
        }
        throw error;
      }
    });

    if (result?.pending) {
      return {
        statusCode: 202,
        headers: cors,
        body: JSON.stringify({ error: "request_pending", requestId: result.requestId || requestId }),
      };
    }

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
