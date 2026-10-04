export function pokerTierPolicyRows(enabledBuyIns = [100, 500]) {
  return [100, 500, 1000, 5000].map((buy_in) => ({
    buy_in, enabled: enabledBuyIns.includes(buy_in), revision: 1,
    normal_refill_threshold_ch: 1, normal_refill_amount_ch: 10,
    slow_refill_threshold_ch: 1, slow_refill_amount_ch: 10
  }));
}
