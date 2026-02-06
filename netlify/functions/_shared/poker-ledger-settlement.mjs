const normalizeNonNegativeInt = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.floor(amount) !== amount || amount < 0) {
    return null;
  }
  if (Math.abs(amount) > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return amount;
};

const normalizePayoutEntries = (payouts) => {
  if (!payouts || typeof payouts !== "object" || Array.isArray(payouts)) {
    throw new Error("invalid_hand_settlement_payouts");
  }
  return Object.entries(payouts).map(([rawUserId, rawAmount]) => {
    const userId = typeof rawUserId === "string" ? rawUserId.trim() : "";
    if (!userId) throw new Error("invalid_hand_settlement_user_id");
    const amount = normalizeNonNegativeInt(rawAmount);
    if (amount == null) throw new Error("invalid_hand_settlement_payout_amount");
    return { userId, amount };
  });
};

const normalizeHandId = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

export async function postHandSettlementToLedger({ tableId, handSettlement, postTransaction, klog, tx = null }) {
  const handId = normalizeHandId(handSettlement?.handId);
  if (!tableId || typeof tableId !== "string") throw new Error("invalid_settlement_table_id");
  if (!handId) throw new Error("invalid_hand_settlement_hand_id");
  if (typeof postTransaction !== "function") throw new Error("invalid_settlement_post_transaction");

  const entries = normalizePayoutEntries(handSettlement?.payouts);
  let postedCount = 0;
  let postedTotal = 0;

  for (const payout of entries) {
    if (payout.amount <= 0) continue;
    const idempotencyKey = `poker:settlement:${tableId}:${handId}:${payout.userId}`;
    await postTransaction({
      userId: payout.userId,
      txType: "HAND_SETTLEMENT",
      idempotencyKey,
      reference: `table:${tableId}:hand:${handId}`,
      metadata: {
        tableId,
        handId,
        settledAt: handSettlement?.settledAt || null,
      },
      entries: [
        { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -payout.amount },
        { accountType: "USER", amount: payout.amount },
      ],
      createdBy: payout.userId,
      tx,
    });
    postedCount += 1;
    postedTotal += payout.amount;
  }

  if (typeof klog === "function") {
    klog("poker_ledger_settlement_posted", {
      tableId,
      handId,
      settledAt: handSettlement?.settledAt || null,
      count: postedCount,
      total: postedTotal,
    });
  }

  return { handId, count: postedCount, total: postedTotal };
}
