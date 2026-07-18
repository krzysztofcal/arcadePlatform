function normalizeRequiredBuyIn(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("invalid_required_buy_in");
  }
  return amount;
}

function normalizeStoredBalance(value) {
  const balance = Number(value);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new Error("chips_balance_integrity_error");
  }
  return balance;
}

export async function readPokerBuyInEligibility(tx, { userId, requiredBuyIn }) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_buy_in_tx_required");
  if (typeof userId !== "string" || !userId.trim()) throw new Error("poker_buy_in_user_required");
  const normalizedRequiredBuyIn = normalizeRequiredBuyIn(requiredBuyIn);
  const rows = await tx.unsafe(
    `
select balance
from public.chips_accounts
where user_id = $1
  and account_type = 'USER'
limit 1;
    `,
    [userId]
  );
  const balance = rows?.[0] ? normalizeStoredBalance(rows[0].balance) : 0;
  return {
    eligible: balance >= normalizedRequiredBuyIn,
    balance,
    requiredBuyIn: normalizedRequiredBuyIn,
  };
}
