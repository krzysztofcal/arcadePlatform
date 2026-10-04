import { readPokerTierPolicySnapshot } from "../../../shared/poker-domain/bot-access.mjs";
import { getBotFundingSystemKeyForBuyIn } from "../../../shared/poker-domain/table-economy.mjs";

// Refreshed outside the hand loop, including when only managed bots are active.
export async function readSettledBotFundingSnapshot(tx, { nowMs = Date.now() } = {}) {
  return readPokerTierPolicySnapshot(tx, { nowMs });
}

export function decideSettledBotFunding({
  snapshot,
  buyIn,
  isSlowOnly = false,
  tableMarkerTransition = false,
  lifecycleKind = null,
  effectiveRestricted = false,
  nowMs = Date.now()
} = {}) {
  if (effectiveRestricted === true) {
    return {
      known: true,
      allowed: false,
      systemKey: null,
      reason: "restricted"
    };
  }
  if (!snapshot || !Number.isFinite(snapshot.expiresAtMs) || nowMs > snapshot.expiresAtMs) {
    return {
      known: false,
      allowed: false,
      systemKey: null,
      reason: !snapshot ? "missing_snapshot" : "expired_snapshot"
    };
  }
  if (snapshot.schemaBacked !== true) {
    return { known: true, allowed: false, systemKey: null, reason: "tier_policy_schema_unavailable" };
  }
  const normalizedBuyIn = Number(buyIn);
  if (!Number.isSafeInteger(normalizedBuyIn) || normalizedBuyIn <= 0) {
    return {
      known: true,
      allowed: false,
      systemKey: null,
      reason: "invalid_buy_in"
    };
  }
  const tier = snapshot.tiers?.[normalizedBuyIn];
  if (!tier) {
    return {
      known: false,
      allowed: false,
      systemKey: null,
      reason: "unknown_tier_policy"
    };
  }
  if (tier.enabled !== true) {
    return {
      known: true,
      allowed: false,
      systemKey: null,
      reason: "tier_disabled"
    };
  }
  const poolClass = lifecycleKind !== "CONTINUOUS_BOT" && (isSlowOnly || tableMarkerTransition)
    ? "SLOW" : "NORMAL";
  if (tier.provisioned?.NORMAL !== true || tier.provisioned?.SLOW !== true || tier.provisioned?.[poolClass] !== true) {
    return {
      known: true,
      allowed: false,
      systemKey: null,
      reason: "tier_unprovisioned"
    };
  }
  const systemKey = getBotFundingSystemKeyForBuyIn(normalizedBuyIn, { poolClass });
  if (!systemKey) {
    return {
      known: true,
      allowed: false,
      systemKey: null,
      reason: "invalid_buy_in"
    };
  }
  return {
    known: true,
    allowed: true,
    systemKey,
    poolClass,
    reason: "funding_allowed"
  };
}

export function resolveSettledBotFundingSystemKey(options = {}) {
  const decision = decideSettledBotFunding(options);
  return decision.allowed === true ? decision.systemKey : null;
}
