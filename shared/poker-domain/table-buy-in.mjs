function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function postUserTableBuyIn({
  postTransaction,
  tx,
  tableId,
  userId,
  amount,
  idempotencyKey,
  createdBy = userId,
  reference = null,
  metadata = {}
}) {
  const normalizedAmount = Number(amount);
  if (typeof postTransaction !== "function") throw makeError("temporarily_unavailable");
  if (!tableId || !userId || !idempotencyKey) throw makeError("invalid_buy_in");
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw makeError("invalid_buy_in");

  return postTransaction({
    userId,
    txType: "TABLE_BUY_IN",
    idempotencyKey,
    reference,
    metadata,
    entries: [
      { accountType: "USER", amount: -normalizedAmount },
      { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: normalizedAmount }
    ],
    createdBy,
    tx
  });
}
