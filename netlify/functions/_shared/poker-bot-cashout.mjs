import { postTransaction } from "./chips-ledger.mjs";
import { isValidUuid } from "./poker-utils.mjs";
import { klog } from "./supabase-admin.mjs";

const normalizeStack = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return 0;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return 0;
  return num;
};

export async function cashoutBotSeatIfNeeded(
  tx,
  { tableId, botUserId, seatNo, bankrollSystemKey, reason, actorUserId, idempotencyKeySuffix }
) {
  const lockedRows = await tx.unsafe(
    "select user_id, seat_no, status, is_bot, stack from public.poker_seats where table_id = $1 and user_id = $2 limit 1 for update;",
    [tableId, botUserId]
  );
  const seat = lockedRows?.[0] || null;
  if (!seat) {
    klog("poker_bot_cashout_skip", { tableId, botUserId, seatNo: seatNo ?? null, reason: "seat_missing", cause: reason });
    return { ok: false, skipped: true, reason: "seat_missing" };
  }

  if (!seat.is_bot) {
    klog("poker_bot_cashout_skip", { tableId, botUserId, seatNo: seat.seat_no ?? seatNo ?? null, reason: "not_bot", cause: reason });
    return { ok: false, skipped: true, reason: "not_bot" };
  }

  const effectiveSeatNo = Number.isInteger(seat.seat_no) ? seat.seat_no : seatNo;
  if (seat.status === "ACTIVE") {
    klog("poker_bot_cashout_skip", {
      tableId,
      botUserId,
      seatNo: effectiveSeatNo ?? null,
      reason: "active_seat",
      amount: 0,
      cause: reason,
    });
    return { ok: true, skipped: true, reason: "active_seat", amount: 0, seatNo: effectiveSeatNo ?? null };
  }

  const amount = normalizeStack(seat.stack);
  if (amount <= 0) {
    klog("poker_bot_cashout_skip", {
      tableId,
      botUserId,
      seatNo: effectiveSeatNo ?? null,
      reason: "non_positive_stack",
      amount,
      cause: reason,
    });
    return { ok: true, skipped: true, reason: "non_positive_stack", amount };
  }

  const createdBy = String(actorUserId || "").trim();
  if (!isValidUuid(createdBy)) {
    klog("poker_bot_cashout_failed", {
      tableId,
      botUserId,
      seatNo: effectiveSeatNo ?? null,
      amount,
      cause: reason,
      code: "invalid_actor_user_id",
    });
    const error = new Error("invalid_actor_user_id");
    error.code = "invalid_actor_user_id";
    throw error;
  }

  const keySuffix = String(idempotencyKeySuffix || "").trim();
  if (!keySuffix) {
    klog("poker_bot_cashout_failed", {
      tableId,
      botUserId,
      seatNo: effectiveSeatNo ?? null,
      amount,
      cause: reason,
      code: "invalid_idempotency_suffix",
    });
    const error = new Error("invalid_idempotency_suffix");
    error.code = "invalid_idempotency_suffix";
    throw error;
  }

  const safeReason = String(reason || "UNKNOWN").toUpperCase();

  await postTransaction({
    userId: createdBy,
    txType: "TABLE_CASH_OUT",
    idempotencyKey: `bot-cashout:${tableId}:${effectiveSeatNo}:${safeReason}:${keySuffix}`,
    metadata: {
      actor: "BOT",
      reason: "BOT_CASH_OUT",
      tableId,
      seatNo: effectiveSeatNo,
      botUserId,
      cause: safeReason,
    },
    entries: [
      { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -amount },
      { accountType: "SYSTEM", systemKey: bankrollSystemKey, amount },
    ],
    createdBy,
    tx,
  });

  await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [tableId, botUserId]);

  klog("poker_bot_cashout_ok", {
    tableId,
    botUserId,
    seatNo: effectiveSeatNo ?? null,
    amount,
    cause: safeReason,
  });

  return { ok: true, cashedOut: true, amount, seatNo: effectiveSeatNo ?? null };
}
