import { getBotFundingSystemKeyForBuyIn } from "./table-economy.mjs";

export const ACCESS_CLASSES = Object.freeze(["NORMAL", "SLOW"]);
export const ACCESS_EFFECTIVE_STATES = Object.freeze(["NORMAL", "SLOW", "RESTRICTED"]);
export const ACCESS_OVERRIDES = Object.freeze(["AUTO", "FORCE_NORMAL", "FORCE_SLOW", "FORCE_RESTRICTED"]);
export const DEFAULT_SLOW_THRESHOLD_CH = 1_000_000_000;
export const DEFAULT_SLOW_HYSTERESIS_BPS = 500;
export const MIN_SLOW_HYSTERESIS_BPS = 100;
export const MAX_SLOW_HYSTERESIS_BPS = 5000;
export const DEFAULT_SLOW_RECOVERY_THRESHOLD_CH = 950_000_000;
export const ACCESS_SNAPSHOT_MAX_AGE_MS = 30_000;

export function deriveSlowRecoveryThresholdCh(entryThresholdCh, hysteresisBps = DEFAULT_SLOW_HYSTERESIS_BPS) {
  if (typeof entryThresholdCh !== "number" || typeof hysteresisBps !== "number") return null;
  if (!Number.isSafeInteger(entryThresholdCh) || entryThresholdCh <= 0) return null;
  if (!Number.isSafeInteger(hysteresisBps) || hysteresisBps < MIN_SLOW_HYSTERESIS_BPS || hysteresisBps > MAX_SLOW_HYSTERESIS_BPS) return null;
  const derivedBigInt = (BigInt(entryThresholdCh) * BigInt(10000 - hysteresisBps)) / 10000n;
  const derived = Number(derivedBigInt);
  if (!Number.isSafeInteger(derived) || derived <= 0 || derived >= entryThresholdCh) return null;
  return derived;
}

// Transaction-local only: a later transaction must observe a completed schema cutover.
const schemaByTransaction = new WeakMap();
export async function hasPokerPoolSchema(tx) {
  if (!schemaByTransaction.has(tx)) {
    schemaByTransaction.set(tx, (async () => {
      const rows = await tx.unsafe("select to_regclass('public.poker_access_policy') is not null as available;");
      if (typeof rows?.[0]?.available !== "boolean") throw new Error("poker_schema_capability_unavailable");
      return rows[0].available;
    })());
  }
  return schemaByTransaction.get(tx);
}

export function legacyPokerAccessSnapshot(nowMs = Date.now()) {
  return { ...normalizeAccessSnapshot({ automaticClass: "NORMAL", override: "AUTO", revision: 1 }, { nowMs }), schemaBacked: false };
}

const isSafePositiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function normalizeAccessClass(value, fallback = null) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ACCESS_CLASSES.includes(normalized) ? normalized : fallback;
}

export function normalizeAccessOverride(value, fallback = null) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ACCESS_OVERRIDES.includes(normalized) ? normalized : fallback;
}

export function resolveEffectiveClass(automaticClass, override) {
  const automatic = normalizeAccessClass(automaticClass);
  const normalizedOverride = normalizeAccessOverride(override);
  if (!automatic || !normalizedOverride) return null;
  if (normalizedOverride === "FORCE_NORMAL") return "NORMAL";
  if (normalizedOverride === "FORCE_SLOW") return "SLOW";
  if (normalizedOverride === "FORCE_RESTRICTED") return "RESTRICTED";
  return automatic;
}

export function deriveAccessState({ automaticClass = "NORMAL", override = "AUTO" } = {}) {
  const normalizedAutomatic = normalizeAccessClass(automaticClass, "NORMAL");
  const normalizedOverride = normalizeAccessOverride(override, "AUTO");
  const effectiveClass = resolveEffectiveClass(normalizedAutomatic, normalizedOverride);
  if (!effectiveClass) {
    const error = new Error("poker_access_state_invalid");
    error.code = "poker_access_state_invalid";
    throw error;
  }
  return {
    automaticClass: normalizedAutomatic,
    override: normalizedOverride,
    effectiveClass,
  };
}

export function applyAutomaticThresholdEvidence({
  automaticClass = "NORMAL",
  override = "AUTO",
  evidenceCh,
  slowThresholdCh = DEFAULT_SLOW_THRESHOLD_CH,
  slowRecoveryThresholdCh = DEFAULT_SLOW_RECOVERY_THRESHOLD_CH,
  allowRecovery = true,
} = {}) {
  const current = deriveAccessState({ automaticClass, override });
  const entryThreshold = Number(slowThresholdCh);
  const recoveryThreshold = Number(slowRecoveryThresholdCh);
  const evidence = Number(evidenceCh);

  const validEntry = Number.isSafeInteger(entryThreshold) && entryThreshold > 0;
  const validRecovery = Number.isSafeInteger(recoveryThreshold) && recoveryThreshold > 0;
  const validThresholds = validEntry && validRecovery && recoveryThreshold < entryThreshold;
  const validEvidence = Number.isSafeInteger(evidence) && evidence >= 0;

  let nextAutomatic = current.automaticClass;

  if (current.override === "AUTO" && validThresholds && validEvidence) {
    if (current.automaticClass === "NORMAL") {
      if (evidence >= entryThreshold) {
        nextAutomatic = "SLOW";
      }
    } else if (current.automaticClass === "SLOW") {
      if (allowRecovery && evidence < recoveryThreshold) {
        nextAutomatic = "NORMAL";
      }
    }
  }

  return {
    automaticClass: nextAutomatic,
    override: current.override,
    effectiveClass: resolveEffectiveClass(nextAutomatic, current.override),
    changed: nextAutomatic !== current.automaticClass,
  };
}

export function normalizePolicySnapshot(row, { nowMs = Date.now(), maxAgeMs = ACCESS_SNAPSHOT_MAX_AGE_MS } = {}) {
  const slowThresholdCh = Number(row?.slow_threshold_ch ?? row?.slowThresholdCh);
  const slowHysteresisBps = Number(row?.slow_hysteresis_bps ?? row?.slowHysteresisBps);
  const slowRecoveryThresholdCh = Number(row?.slow_recovery_threshold_ch ?? row?.slowRecoveryThresholdCh);
  const revision = Number(row?.revision ?? row?.poker_access_revision);
  const loadedAtMs = Number(row?.loadedAtMs ?? row?.loaded_at_ms ?? nowMs);
  if (!Number.isSafeInteger(slowThresholdCh) || slowThresholdCh <= 0
    || !Number.isSafeInteger(slowHysteresisBps) || slowHysteresisBps < MIN_SLOW_HYSTERESIS_BPS || slowHysteresisBps > MAX_SLOW_HYSTERESIS_BPS
    || !Number.isSafeInteger(slowRecoveryThresholdCh) || slowRecoveryThresholdCh <= 0
    || slowRecoveryThresholdCh >= slowThresholdCh
    || !Number.isSafeInteger(revision) || revision <= 0
    || !Number.isFinite(loadedAtMs)) return null;

  const expectedRecovery = deriveSlowRecoveryThresholdCh(slowThresholdCh, slowHysteresisBps);
  if (expectedRecovery === null || slowRecoveryThresholdCh !== expectedRecovery) {
    return null;
  }

  return {
    slowThresholdCh,
    slowHysteresisBps,
    slowRecoveryThresholdCh,
    revision,
    loadedAtMs,
    expiresAtMs: loadedAtMs + Math.max(0, Number(maxAgeMs) || ACCESS_SNAPSHOT_MAX_AGE_MS),
  };
}

export function isFreshPolicySnapshot(snapshot, nowMs = Date.now()) {
  const slowThresholdCh = Number(snapshot?.slowThresholdCh);
  const slowHysteresisBps = Number(snapshot?.slowHysteresisBps);
  const slowRecoveryThresholdCh = Number(snapshot?.slowRecoveryThresholdCh);
  if (!snapshot
    || !Number.isSafeInteger(slowThresholdCh) || slowThresholdCh <= 0
    || !Number.isSafeInteger(slowHysteresisBps) || slowHysteresisBps < MIN_SLOW_HYSTERESIS_BPS || slowHysteresisBps > MAX_SLOW_HYSTERESIS_BPS
    || !Number.isSafeInteger(slowRecoveryThresholdCh) || slowRecoveryThresholdCh <= 0
    || slowRecoveryThresholdCh >= slowThresholdCh
    || !Number.isSafeInteger(Number(snapshot.revision))
    || Number(snapshot.revision) <= 0
    || !Number.isFinite(Number(snapshot.expiresAtMs))
    || Number(nowMs) > Number(snapshot.expiresAtMs)) {
    return false;
  }
  const expectedRecovery = deriveSlowRecoveryThresholdCh(slowThresholdCh, slowHysteresisBps);
  return expectedRecovery !== null && slowRecoveryThresholdCh === expectedRecovery;
}

export function normalizeAccessSnapshot(row, { nowMs = Date.now(), maxAgeMs = ACCESS_SNAPSHOT_MAX_AGE_MS } = {}) {
  const rawAutomaticClass = row?.poker_auto_class ?? row?.automaticClass;
  const rawOverride = row?.poker_access_override ?? row?.override;
  const automaticClass = normalizeAccessClass(rawAutomaticClass);
  const override = normalizeAccessOverride(rawOverride);
  if (!automaticClass || !override) return null;
  const state = deriveAccessState({ automaticClass, override });
  const revision = Number(row?.poker_access_revision ?? row?.revision ?? 1);
  if (!Number.isSafeInteger(revision) || revision <= 0) return null;
  const loadedAtMs = Number(row?.loadedAtMs ?? row?.loaded_at_ms ?? nowMs);
  if (!Number.isFinite(loadedAtMs)) return null;
  return {
    ...state,
    schemaBacked: Object.prototype.hasOwnProperty.call(row || {}, "poker_auto_class")
      || Object.prototype.hasOwnProperty.call(row || {}, "poker_access_override"),
    revision,
    automaticSlowAt: row?.poker_auto_slow_at ?? row?.automaticSlowAt ?? null,
    loadedAtMs,
    expiresAtMs: loadedAtMs + Math.max(0, Number(maxAgeMs) || ACCESS_SNAPSHOT_MAX_AGE_MS),
  };
}

export function isFreshAccessSnapshot(snapshot, nowMs = Date.now()) {
  return Boolean(snapshot
    && ACCESS_CLASSES.includes(snapshot.automaticClass)
    && ACCESS_OVERRIDES.includes(snapshot.override)
    && ACCESS_EFFECTIVE_STATES.includes(snapshot.effectiveClass)
    && Number.isSafeInteger(Number(snapshot.revision))
    && Number(nowMs) <= Number(snapshot.expiresAtMs));
}

export async function readPokerAccessPolicy(tx, { nowMs = Date.now() } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_access_tx_required");
  if (!await hasPokerPoolSchema(tx)) return {
    ...normalizePolicySnapshot({
      slow_threshold_ch: Number.MAX_SAFE_INTEGER,
      slow_hysteresis_bps: DEFAULT_SLOW_HYSTERESIS_BPS,
      slow_recovery_threshold_ch: deriveSlowRecoveryThresholdCh(Number.MAX_SAFE_INTEGER, DEFAULT_SLOW_HYSTERESIS_BPS),
      revision: 1,
    }, { nowMs }),
    schemaBacked: false,
  };
  const rows = await tx.unsafe(
    "select slow_threshold_ch, slow_hysteresis_bps, slow_recovery_threshold_ch, revision from public.poker_access_policy where id = 1 limit 1;"
  );
  return normalizePolicySnapshot(rows?.[0], { nowMs });
}

export async function readPokerAccessSnapshot(tx, { userId, lock = false, nowMs = Date.now() } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_access_tx_required");
  if (typeof userId !== "string" || !userId.trim()) return null;
  if (!await hasPokerPoolSchema(tx)) return legacyPokerAccessSnapshot(nowMs);
  const rows = await tx.unsafe(`
select poker_auto_class, poker_access_override, poker_access_revision, poker_auto_slow_at
from public.chips_accounts
where user_id = $1 and account_type = 'USER'
limit 1${lock ? " for update" : ""};
`, [userId]);
  return normalizeAccessSnapshot(rows?.[0], { nowMs });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function readPokerAccessSnapshots(tx, { userIds = [], lock = false, nowMs = Date.now() } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_access_tx_required");
  const normalizedUserIds = [...new Set((Array.isArray(userIds) ? userIds : [])
    .map((userId) => typeof userId === "string" ? userId.trim().toLowerCase() : "")
    .filter((userId) => UUID_RE.test(userId)))];
  if (normalizedUserIds.length === 0) return new Map();
  if (!await hasPokerPoolSchema(tx)) return new Map(normalizedUserIds.map((userId) => [userId, legacyPokerAccessSnapshot(nowMs)]));
  const rows = await tx.unsafe(`
select user_id, poker_auto_class, poker_access_override, poker_access_revision, poker_auto_slow_at
from public.chips_accounts
where user_id = any($1::uuid[])
  and account_type = 'USER'${lock ? "\nfor update" : ""};
`, [normalizedUserIds]);
  const snapshots = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const userId = typeof row?.user_id === "string" ? row.user_id.trim().toLowerCase() : "";
    const snapshot = normalizeAccessSnapshot(row, { nowMs });
    if (UUID_RE.test(userId) && snapshot) snapshots.set(userId, snapshot);
  }
  return snapshots;
}

export async function persistAutomaticTransition(tx, { userId, targetClass, expectedRevision = null, now = null } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_access_tx_required");
  if (typeof userId !== "string" || !userId.trim()) return { changed: false, reason: "user_missing" };
  const normalizedTarget = normalizeAccessClass(targetClass);
  if (!normalizedTarget) return { changed: false, reason: "invalid_target_class" };

  const fromClass = normalizedTarget === "SLOW" ? "NORMAL" : "SLOW";
  const params = [userId];
  const revisionClause = Number.isSafeInteger(Number(expectedRevision)) && Number(expectedRevision) > 0
    ? ` and poker_access_revision = $${params.length + 1}`
    : "";
  if (revisionClause) params.push(Number(expectedRevision));

  const timestampValue = now ? `$${params.length + 1}::timestamptz` : "timezone('utc', now())";
  const slowAtClause = normalizedTarget === "SLOW"
    ? `poker_auto_slow_at = coalesce(poker_auto_slow_at, ${timestampValue}),\n    `
    : "";
  const updatedAtClause = `poker_access_updated_at = ${timestampValue},`;

  const queryParams = now ? [...params, now] : params;
  const rows = await tx.unsafe(`
update public.chips_accounts
set poker_auto_class = '${normalizedTarget}',
    ${slowAtClause}${updatedAtClause}
    poker_access_updated_by = null,
    poker_access_revision = poker_access_revision + 1
where user_id = $1 and account_type = 'USER'
  and poker_auto_class = '${fromClass}'${revisionClause}
returning poker_auto_class, poker_access_override, poker_access_revision, poker_auto_slow_at;
`, queryParams);

  if (rows?.[0]) return { changed: true, snapshot: normalizeAccessSnapshot(rows[0]) };
  return { changed: false, reason: "already_target_class_or_revision_changed" };
}

export async function persistAutomaticSlow(tx, { userId, expectedRevision = null, now = null } = {}) {
  return persistAutomaticTransition(tx, { userId, targetClass: "SLOW", expectedRevision, now });
}

export function isValidTierPolicy(policy) {
  if (!policy || typeof policy !== "object") return false;
  if (policy.enabled !== true && policy.enabled !== false) return false;
  return Number.isSafeInteger(Number(policy.revision)) && Number(policy.revision) > 0 && [
    policy.normal_refill_threshold_ch,
    policy.normal_refill_amount_ch,
    policy.slow_refill_threshold_ch,
    policy.slow_refill_amount_ch,
  ].every(isSafePositiveInteger);
}

export function normalizeTierPolicySnapshot(row) {
  if (!row) return null;
  const normalCap = row.normal_hourly_refill_cap_ch ?? row.normalHourlyRefillCapCh;
  const slowCap = row.slow_hourly_refill_cap_ch ?? row.slowHourlyRefillCapCh;
  const policy = {
    buyIn: Number(row.buy_in ?? row.buyIn),
    enabled: row.enabled === true,
    normal_refill_threshold_ch: Number(row.normal_refill_threshold_ch),
    normal_refill_amount_ch: Number(row.normal_refill_amount_ch),
    slow_refill_threshold_ch: Number(row.slow_refill_threshold_ch),
    slow_refill_amount_ch: Number(row.slow_refill_amount_ch),
    normal_hourly_refill_cap_ch: normalCap === null || normalCap === undefined ? null : Number(normalCap),
    slow_hourly_refill_cap_ch: slowCap === null || slowCap === undefined ? null : Number(slowCap),
    revision: Number(row.revision),
  };
  return Number.isSafeInteger(policy.buyIn) && policy.buyIn > 0 && isValidTierPolicy(policy) ? policy : null;
}

export async function readPokerTierPolicy(tx, { buyIn } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_access_tx_required");
  const normalizedBuyIn = Number(buyIn);
  if (!Number.isSafeInteger(normalizedBuyIn) || normalizedBuyIn <= 0) return null;
  const rows = await tx.unsafe(
    `select buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch,
            slow_refill_threshold_ch, slow_refill_amount_ch,
            normal_hourly_refill_cap_ch, slow_hourly_refill_cap_ch, revision
       from public.poker_bot_tier_policy
      where buy_in = $1
      limit 1;`,
    [normalizedBuyIn]
  );
  return normalizeTierPolicySnapshot(rows?.[0]);
}

export async function readPokerPoolProvisioning(tx, { buyIn } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_access_tx_required");
  const normalKey = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "NORMAL" });
  const slowKey = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "SLOW" });
  if (!normalKey || !slowKey) return { NORMAL: false, SLOW: false };
  const rows = await tx.unsafe(
    `select system_key
       from public.chips_accounts
      where account_type = 'SYSTEM'
        and status = 'active'
        and system_key = any($1::text[]);`,
    [[normalKey, slowKey]]
  );
  const present = new Set((Array.isArray(rows) ? rows : []).map((row) => row?.system_key));
  return { NORMAL: present.has(normalKey), SLOW: present.has(slowKey) };
}

export function classifySettledAccessEvidence({
  snapshot,
  settledStackCh,
  policy,
  nowMs = Date.now(),
} = {}) {
  if (!isFreshAccessSnapshot(snapshot, nowMs) || !isFreshPolicySnapshot(policy, nowMs)) {
    return { known: false, reason: "access_cache_unknown" };
  }
  const next = applyAutomaticThresholdEvidence({
    automaticClass: snapshot.automaticClass,
    override: snapshot.override,
    evidenceCh: settledStackCh,
    slowThresholdCh: policy.slowThresholdCh,
    slowRecoveryThresholdCh: policy.slowRecoveryThresholdCh,
    allowRecovery: false,
  });
  return {
    known: true,
    ...next,
    revision: snapshot.revision,
    slowThresholdCh: policy.slowThresholdCh,
    slowHysteresisBps: policy.slowHysteresisBps,
    slowRecoveryThresholdCh: policy.slowRecoveryThresholdCh,
  };
}
