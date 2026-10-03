/** One bounded DB refill decision, isolated so an error leaves funding usable. */
export async function attemptDemandRefill({ tx, buyIn, poolClass, fundingDemandId, requiredDebitCh } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("demand_refill_tx_required");
  if (!Number.isSafeInteger(Number(buyIn)) || Number(buyIn) <= 0
      || !["NORMAL", "SLOW"].includes(poolClass)
      || typeof fundingDemandId !== "string" || !fundingDemandId.trim()
      || !Number.isSafeInteger(requiredDebitCh) || requiredDebitCh <= 0) return { status: "invalid_demand" };
  const run = async (activeTx) => {
    const rows = await activeTx.unsafe(
      "select public.poker_bot_pool_refill_demand($1::bigint, $2::text, $3::text, $4::bigint) as result;",
      [Number(buyIn), poolClass, fundingDemandId, requiredDebitCh]
    );
    return rows?.[0]?.result || { status: "unavailable" };
  };
  if (typeof tx.savepoint === "function") return tx.savepoint("poker_demand_refill", run);
  await tx.unsafe("savepoint poker_demand_refill;");
  try {
    const result = await run(tx);
    await tx.unsafe("release savepoint poker_demand_refill;");
    return result;
  } catch (error) {
    await tx.unsafe("rollback to savepoint poker_demand_refill;");
    await tx.unsafe("release savepoint poker_demand_refill;");
    throw error;
  }
}
