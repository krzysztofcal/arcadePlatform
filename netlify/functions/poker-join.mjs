import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { HEARTBEAT_INTERVAL_SEC, isValidUuid } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";
import { isStateStorageValid } from "./_shared/poker-state-utils.mjs";
import { patchLeftTableByUserId } from "./_shared/poker-left-flag.mjs";
import { clearMissedTurns } from "./_shared/poker-missed-turns.mjs";
import { patchSitOutByUserId } from "./_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "./_shared/poker-state-write-locked.mjs";

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

const parseSeatNo = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
};

const parseBuyIn = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
};

const parseSeats = (value) => (Array.isArray(value) ? value : []);

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const buildMeStatus = (state, userId, { forceSeated = false } = {}) => {
  const seat = Array.isArray(state?.seats) ? state.seats.find((entry) => entry?.userId === userId) : null;
  return {
    userId,
    isSeated: forceSeated ? true : !!seat,
    isLeft: !!state?.leftTableByUserId?.[userId],
    isSitOut: !!state?.sitOutByUserId?.[userId],
  };
};

const clearRejoinFlags = async (tx, { tableId, userId }) => {
  const loadResult = await loadPokerStateForUpdate(tx, tableId);
  if (!loadResult.ok) {
    if (loadResult.reason === "not_found") throw makeError(404, "state_missing");
    throw makeError(409, "state_invalid");
  }
  const currentState = loadResult.state;
  const patched = patchLeftTableByUserId(currentState, userId, false);
  const clearedMissed = clearMissedTurns(patched.nextState, userId);
  const clearedSitOut = patchSitOutByUserId(clearedMissed.nextState, userId, false);
  if (!patched.changed && !clearedMissed.changed && !clearedSitOut.changed) {
    return { updated: false, nextState: clearedSitOut.nextState };
  }
  if (!isStateStorageValid(clearedSitOut.nextState, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false })) {
    klog("poker_join_state_invalid", { tableId, userId, reason: "state_invalid" });
    throw makeError(409, "state_invalid");
  }
  const updateResult = await updatePokerStateLocked(tx, { tableId, nextState: clearedSitOut.nextState });
  if (!updateResult.ok) {
    if (updateResult.reason === "not_found") throw makeError(404, "state_missing");
    throw makeError(409, "state_invalid");
  }
  return { updated: true, nextState: clearedSitOut.nextState };
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
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const seatNo = parseSeatNo(payload?.seatNo);
  if (seatNo == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_seat_no" }) };
  }

  const buyIn = parseBuyIn(payload?.buyIn);
  if (buyIn == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_buy_in" }) };
  }

  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok) {
    const requestIdValue = payload?.requestId;
    const requestIdType = typeof requestIdValue;
    const requestIdTrimmed = typeof requestIdValue === "string" ? requestIdValue.trim() : "";
    const requestIdPreview = requestIdTrimmed ? requestIdTrimmed.slice(0, 50) : null;
    const requestIdPresent = requestIdTrimmed !== "";
    klog("poker_request_id_invalid", {
      fn: "join",
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
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  klog("poker_join_begin", { tableId, userId: auth.userId, seatNo, hasRequestId: !!requestId });

  try {
    const result = await beginSql(async (tx) => {
      let mutated = false;
      const requestInfo = await ensurePokerRequest(tx, {
        tableId,
        userId: auth.userId,
        requestId,
        kind: "JOIN",
        pendingStaleSec: REQUEST_PENDING_STALE_SEC,
      });
      if (requestInfo.status === "stored") return requestInfo.result;
      if (requestInfo.status === "pending") return { ok: false, pending: true, requestId };

      try {
        const tableRows = await tx.unsafe(
          "select id, status, max_players from public.poker_tables where id = $1 limit 1;",
          [tableId]
        );
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }
        const seatRows = await tx.unsafe(
          "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
          [tableId, auth.userId]
        );
        const existingSeatNo = seatRows?.[0]?.seat_no;
        if (Number.isInteger(existingSeatNo)) {
          if (table.status === "CLOSED") {
            throw makeError(409, "table_closed");
          }
          await tx.unsafe(
            "update public.poker_seats set status = 'ACTIVE', last_seen_at = now(), stack = coalesce(stack, $3) where table_id = $1 and user_id = $2;",
            [tableId, auth.userId, buyIn]
          );
          mutated = true;

          await tx.unsafe(
            "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
            [tableId]
          );
          const flagResult = await clearRejoinFlags(tx, { tableId, userId: auth.userId });

          const resultPayload = {
            ok: true,
            tableId,
            seatNo: existingSeatNo,
            userId: auth.userId,
            me: buildMeStatus(flagResult.nextState, auth.userId, { forceSeated: true }),
          };
          await storePokerRequestResult(tx, {
            tableId,
            userId: auth.userId,
            requestId,
            kind: "JOIN",
            result: resultPayload,
          });
          klog("poker_join_stack_persisted", {
            tableId,
            userId: auth.userId,
            seatNo: existingSeatNo,
            attemptedStackFill: buyIn,
            mode: "rejoin",
          });
          klog("poker_join_ok", { tableId, userId: auth.userId, seatNo: existingSeatNo, rejoin: true });
          return resultPayload;
        }

        if (table.status === "CLOSED") {
          throw makeError(409, "table_closed");
        }

        if (table.status !== "OPEN") {
          throw makeError(409, "table_not_open");
        }

        if (seatNo >= Number(table.max_players)) {
          throw makeError(400, "invalid_seat_no");
        }

        try {
          await tx.unsafe(
            `
insert into public.poker_seats (table_id, user_id, seat_no, status, last_seen_at, joined_at, stack)
values ($1, $2, $3, 'ACTIVE', now(), now(), $4);
            `,
            [tableId, auth.userId, seatNo, buyIn]
          );
          mutated = true;
        } catch (error) {
          const isUnique = error?.code === "23505";
          const details = `${error?.constraint || ""} ${error?.detail || ""}`.toLowerCase();
          if (isUnique && details.includes("seat_no")) {
            throw makeError(409, "seat_taken");
          }
          if (isUnique && details.includes("user_id")) {
            const seatRow = await tx.unsafe(
              "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
              [tableId, auth.userId]
            );
            const fallbackSeatNo = seatRow?.[0]?.seat_no;
            if (Number.isInteger(fallbackSeatNo)) {
              await tx.unsafe(
                "update public.poker_seats set status = 'ACTIVE', last_seen_at = now(), stack = coalesce(stack, $3) where table_id = $1 and user_id = $2;",
                [tableId, auth.userId, buyIn]
              );
              mutated = true;
              const flagResult = await clearRejoinFlags(tx, { tableId, userId: auth.userId });
              const resultPayload = {
                ok: true,
                tableId,
                seatNo: fallbackSeatNo,
                userId: auth.userId,
                me: buildMeStatus(flagResult.nextState, auth.userId, { forceSeated: true }),
              };
              await storePokerRequestResult(tx, {
                tableId,
                userId: auth.userId,
                requestId,
                kind: "JOIN",
                result: resultPayload,
              });
              klog("poker_join_stack_persisted", {
                tableId,
                userId: auth.userId,
                seatNo: fallbackSeatNo,
                attemptedStackFill: buyIn,
                mode: "rejoin",
              });
              klog("poker_join_ok", { tableId, userId: auth.userId, seatNo: fallbackSeatNo, rejoin: true });
              return resultPayload;
            }
            throw makeError(409, "already_seated");
          }
          throw error;
        }

        const escrowSystemKey = `POKER_TABLE:${tableId}`;
        const escrowRows = await tx.unsafe(
          "select id from public.chips_accounts where system_key = $1 limit 1;",
          [escrowSystemKey]
        );
        const escrowId = escrowRows?.[0]?.id || null;
        if (!escrowId) {
          throw new Error("poker_escrow_missing");
        }

        const idempotencyKey = requestId
          ? `poker:join:${tableId}:${auth.userId}:${requestId}`
          : `poker:join:${tableId}:${auth.userId}:${seatNo}:${buyIn}`;

        await postTransaction({
          userId: auth.userId,
          txType: "TABLE_BUY_IN",
          idempotencyKey,
          entries: [
            { accountType: "USER", amount: -buyIn },
            { accountType: "ESCROW", systemKey: escrowSystemKey, amount: buyIn },
          ],
          createdBy: auth.userId,
          tx,
        });
        mutated = true;

        const loadResult = await loadPokerStateForUpdate(tx, tableId);
        if (!loadResult.ok) {
          if (loadResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          throw makeError(409, "state_invalid");
        }

        const currentState = loadResult.state;
        const seats = parseSeats(currentState.seats).filter((seat) => seat?.userId !== auth.userId);
        seats.push({ userId: auth.userId, seatNo });
        const stacks = { ...parseStacks(currentState.stacks), [auth.userId]: buyIn };
        const patched = patchLeftTableByUserId(currentState, auth.userId, false);
        const clearedMissed = clearMissedTurns(patched.nextState, auth.userId);
        const clearedSitOut = patchSitOutByUserId(clearedMissed.nextState, auth.userId, false);

        const updatedState = {
          ...clearedSitOut.nextState,
          tableId: currentState.tableId || tableId,
          seats,
          stacks,
          pot: Number.isFinite(currentState.pot) ? currentState.pot : 0,
          phase: currentState.phase || "INIT",
        };
        if (!isStateStorageValid(updatedState, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false })) {
          klog("poker_join_state_invalid", { tableId, userId: auth.userId, reason: "state_invalid" });
          throw makeError(409, "state_invalid");
        }

        const updateResult = await updatePokerStateLocked(tx, { tableId, nextState: updatedState });
        if (!updateResult.ok) {
          if (updateResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          throw makeError(409, "state_invalid");
        }

        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        const resultPayload = {
          ok: true,
          tableId,
          seatNo,
          userId: auth.userId,
          heartbeatEverySec: HEARTBEAT_INTERVAL_SEC,
          me: buildMeStatus(updatedState, auth.userId, { forceSeated: true }),
        };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "JOIN",
          result: resultPayload,
        });
        klog("poker_join_stack_persisted", {
          tableId,
          userId: auth.userId,
          seatNo,
          persistedStack: buyIn,
          mode: "insert",
        });
        klog("poker_join_ok", { tableId, userId: auth.userId, seatNo, rejoin: false });
        return resultPayload;
      } catch (error) {
        if (requestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId, kind: "JOIN" });
        } else if (requestId && mutated) {
          klog("poker_join_request_retained", { tableId, userId: auth.userId, requestId });
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
      klog("poker_join_fail", { tableId, userId: auth.userId, reason: error.code });
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_join_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
