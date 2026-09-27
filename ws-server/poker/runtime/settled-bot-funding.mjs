import {
  ACCESS_SNAPSHOT_MAX_AGE_MS,
  hasPokerPoolSchema,
  readPokerPoolProvisioning,
  readPokerTierPolicy
} from "../../../shared/poker-domain/bot-access.mjs";
import { getBotFundingSystemKeyForBuyIn } from "../../../shared/poker-domain/table-economy.mjs";

// Refreshed outside the hand loop, including when only managed bots are active.
export async function readSettledBotFundingSnapshot(tx, { nowMs = Date.now(), buyIns = [] } = {}) {
  const schemaBacked = await hasPokerPoolSchema(tx);
  const snapshot = { schemaBacked, expiresAtMs: nowMs + ACCESS_SNAPSHOT_MAX_AGE_MS, tiers: {} };
  if (!schemaBacked) return snapshot;
  const tiers = [...new Set([100, 500, ...buyIns].map(Number))]
    .filter((buyIn) => Number.isSafeInteger(buyIn) && buyIn > 0);
  for (const buyIn of tiers) {
    const policy = await readPokerTierPolicy(tx, { buyIn });
    const provisioned = await readPokerPoolProvisioning(tx, { buyIn });
    snapshot.tiers[buyIn] = { enabled: policy?.enabled === true, provisioned };
  }
  return snapshot;
}

export function resolveSettledBotFundingSystemKey({
  snapshot,
  buyIn,
  isSlowOnly = false,
  tableMarkerTransition = false,
  lifecycleKind = null,
  effectiveRestricted = false,
  legacySystemKey = "TREASURY",
  nowMs = Date.now()
} = {}) {
  if (!snapshot || !Number.isFinite(snapshot.expiresAtMs) || nowMs > snapshot.expiresAtMs) return null;
  if (effectiveRestricted === true) return null;
  if (snapshot.schemaBacked === false) {
    return getBotFundingSystemKeyForBuyIn(buyIn, { legacySystemKey });
  }
  const tier = snapshot.tiers?.[Number(buyIn)];
  if (snapshot.schemaBacked !== true || tier?.enabled !== true
    || tier.provisioned?.NORMAL !== true || tier.provisioned?.SLOW !== true) return null;
  const poolClass = lifecycleKind !== "CONTINUOUS_BOT" && (isSlowOnly || tableMarkerTransition)
    ? "SLOW" : "NORMAL";
  return getBotFundingSystemKeyForBuyIn(buyIn, { poolClass });
}
