import { ensurePokerRequest, storePokerRequestResult } from "../../netlify/functions/_shared/poker-idempotency.mjs";
import { requireAuthoritativeHumanStack } from "./human-stack-accounting.mjs";
import { postUserTableBuyIn } from "./table-buy-in.mjs";

export const POKER_REBUY_AMOUNT = 100;
const POKER_REQUEST_KIND = "REBUY";
const PENDING_STALE_SEC = 30;

function makeError(code, status = 409) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function parseState(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw makeError("state_invalid");
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Normalize every malformed persisted value to one controlled code.
  }
  throw makeError("state_invalid");
}

function currentHandUserIds(state) {
  const source = Array.isArray(state?.handSeats) ? state.handSeats : (Array.isArray(state?.seats) ? state.seats : []);
  return new Set(source.map((seat) => String(seat?.userId || "").trim()).filter(Boolean));
}

function normalizeCardCodeForValidation(cardCode) {
  if (typeof cardCode !== "string") return null;
  const code = cardCode.trim().toUpperCase();
  if (!/^(10|[2-9TJQKA])[CDHS]$/.test(code)) return null;
  const suit = code.slice(-1);
  const rankCode = code.slice(0, -1);
  const rank = rankCode === "A"
    ? 14
    : rankCode === "K"
      ? 13
      : rankCode === "Q"
        ? 12
        : rankCode === "J"
          ? 11
          : rankCode === "T"
            ? 10
            : Number(rankCode);
  return Number.isInteger(rank) && rank >= 2 && rank <= 14 ? { r: rank, s: suit } : null;
}

function normalizeStateForStorageValidation(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray(state.community)) return state;
  const community = state.community.map((card) => typeof card === "string" ? normalizeCardCodeForValidation(card) : card);
  if (community.some((card) => !card)) return state;
  return { ...state, community };
}

function normalizeStoredResult(result) {
  if (!result || typeof result !== "object" || result.ok !== true) return null;
  const stack = Number(result.stack);
  const stateVersion = Number(result.stateVersion);
  if (!Number.isInteger(stack) || stack !== POKER_REBUY_AMOUNT) return null;
  if (!Number.isInteger(stateVersion) || stateVersion <= 0) return null;
  return result;
}

export async function executePokerRebuyAuthoritative({
  beginSql,
  tableId,
  userId,
  requestId,
  amount = POKER_REBUY_AMOUNT,
  postTransactionFn,
  loadStateForUpdate,
  updateStateLocked,
  validateStateForStorage,
  klog = () => {}
}) {
  if (typeof beginSql !== "function" || typeof postTransactionFn !== "function") throw makeError("temporarily_unavailable", 503);
  if (typeof loadStateForUpdate !== "function" || typeof updateStateLocked !== "function" || typeof validateStateForStorage !== "function") {
    throw makeError("temporarily_unavailable", 503);
  }
  if (!tableId || !userId || !requestId) throw makeError("invalid_request", 400);
  const normalizedAmount = Number(amount);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount !== POKER_REBUY_AMOUNT) throw makeError("invalid_rebuy_amount", 400);

  return beginSql(async (tx) => {
    const request = await ensurePokerRequest(tx, {
      tableId,
      userId,
      requestId,
      kind: POKER_REQUEST_KIND,
      pendingStaleSec: PENDING_STALE_SEC
    });
    if (request.status === "stored") {
      const stored = normalizeStoredResult(request.result);
      if (!stored) throw makeError("request_result_invalid");
      klog("poker_rebuy_replayed", { tableId, requestId, stateVersion: stored.stateVersion });
      return { ...stored, replayed: true };
    }
    if (request.status === "pending") throw makeError("request_pending");

    const tableRows = await tx.unsafe(
      "select id, status from public.poker_tables where id = $1 for update;",
      [tableId]
    );
    const table = tableRows?.[0] || null;
    if (!table) throw makeError("table_not_found", 404);
    if (String(table.status || "").toUpperCase() !== "OPEN") throw makeError("table_not_open");

    const seatRows = await tx.unsafe(
      `select user_id, seat_no, stack, status, is_bot
       from public.poker_seats
       where table_id = $1 and user_id = $2
       for update;`,
      [tableId, userId]
    );
    const seat = seatRows?.[0] || null;
    if (!seat || String(seat.status || "").toUpperCase() !== "ACTIVE") throw makeError("seat_not_active");
    if (seat.is_bot === true) throw makeError("rebuy_not_allowed");
    const seatNo = Number(seat.seat_no);
    if (!Number.isInteger(seatNo) || seatNo < 1) throw makeError("state_invalid");

    const locked = await loadStateForUpdate(tx, tableId);
    if (!locked?.ok) throw makeError(locked?.reason === "not_found" ? "state_missing" : "state_invalid");
    const state = parseState(locked.state);
    const stackEvidence = requireAuthoritativeHumanStack({ state, userId });
    if (stackEvidence.amount !== 0) throw makeError("rebuy_not_available");
    if (currentHandUserIds(state).has(userId)) throw makeError("rebuy_not_available");
    if (state?.waitingForNextHandByUserId?.[userId] === true) throw makeError("rebuy_not_available");

    const nextState = {
      ...state,
      stacks: {
        ...(state.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks) ? state.stacks : {}),
        [userId]: normalizedAmount
      },
      waitingForNextHandByUserId: {
        ...(state.waitingForNextHandByUserId && typeof state.waitingForNextHandByUserId === "object" && !Array.isArray(state.waitingForNextHandByUserId)
          ? state.waitingForNextHandByUserId
          : {}),
        [userId]: true
      }
    };
    if (!validateStateForStorage(normalizeStateForStorageValidation(nextState))) throw makeError("state_invalid");

    const updated = await updateStateLocked(tx, { tableId, nextState });
    if (!updated?.ok) throw makeError(updated?.reason === "not_found" ? "state_missing" : "state_conflict");

    const idempotencyKey = `poker:rebuy:v1:${tableId}:${userId}:${requestId}`;
    const ledger = await postUserTableBuyIn({
      postTransaction: postTransactionFn,
      tx,
      tableId,
      userId,
      amount: normalizedAmount,
      idempotencyKey,
      reference: `poker-rebuy:${tableId}`,
      metadata: { tableId, seatNo, reason: "manual_rebuy" }
    });

    const projectedRows = await tx.unsafe(
      `update public.poker_seats
       set stack = $4, updated_at = now()
       where table_id = $1 and user_id = $2 and seat_no = $3 and status = 'ACTIVE' and is_bot = false
       returning user_id;`,
      [tableId, userId, seatNo, normalizedAmount]
    );
    if (projectedRows?.length !== 1) throw makeError("seat_projection_conflict");
    await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);

    const result = {
      ok: true,
      tableId,
      userId,
      seatNo,
      stack: normalizedAmount,
      status: "WAITING_NEXT_HAND",
      stateVersion: Number(updated.newVersion),
      ledgerTransactionId: ledger?.transaction?.id || null,
      requestId
    };
    await storePokerRequestResult(tx, {
      tableId,
      userId,
      requestId,
      kind: POKER_REQUEST_KIND,
      result
    });
    klog("poker_rebuy_committed", { tableId, seatNo, stateVersion: result.stateVersion, amount: normalizedAmount });
    return result;
  });
}
