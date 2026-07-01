import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";
import { writePersistedTableToFile } from "./persisted-state-file-store.mjs";

const HAND_SETTLED_ACTION_TYPE = "HAND_SETTLED";
const SETTLEMENT_AUDIT_VERSION = 1;
const ACCEPTED_ACTION_AUDIT_VERSION = 1;
const ACCEPTED_ACTION_TYPES = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL_IN"]);

function normalizeJsonState(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function sanitizePersistedState(value) {
  const state = normalizeJsonState(value);
  const { deck: _ignoredDeck, holeCardsByUserId: _ignoredHoleCards, ...persistedState } = state;
  return persistedState;
}

const stableStringify = (value) =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return val;
    return Object.keys(val)
      .sort()
      .reduce((acc, key) => {
        acc[key] = val[key];
        return acc;
      }, {});
  });

function normalizeCardCode(value) {
  if (typeof value === "string") {
    const code = value.trim().toUpperCase();
    return /^(10|[2-9TJQKA])[CDHS]$/.test(code) ? code.replace(/^10/, "T") : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const suit = typeof value.s === "string" ? value.s.trim().toUpperCase() : "";
  if (!/[CDHS]/.test(suit)) {
    return null;
  }
  const rankValue = value.r;
  const rank = typeof rankValue === "number"
    ? (rankValue === 14 ? "A" : rankValue === 13 ? "K" : rankValue === 12 ? "Q" : rankValue === 11 ? "J" : rankValue === 10 ? "T" : String(rankValue))
    : typeof rankValue === "string"
      ? rankValue.trim().toUpperCase().replace(/^10$/, "T")
      : "";
  return /^(?:[2-9TJQKA])$/.test(rank) ? `${rank}${suit}` : null;
}

function normalizeCardList(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards.map(normalizeCardCode).filter(Boolean);
}

function buildHoleCardRows(state) {
  const handId = normalizeAuditString(state?.handId);
  const holeCardsByUserId = state?.holeCardsByUserId;
  if (!handId || !holeCardsByUserId || typeof holeCardsByUserId !== "object" || Array.isArray(holeCardsByUserId)) {
    return { handId, rows: [] };
  }
  const rows = Object.entries(holeCardsByUserId)
    .map(([userId, cards]) => ({
      userId: normalizeAuditString(userId),
      cards: normalizeCardList(cards)
    }))
    .filter((entry) => entry.userId && entry.cards.length === 2);
  return { handId, rows };
}

function safeHoleCardPersistReason(error) {
  if (typeof error?.code === "string" && error.code.trim()) {
    return error.code.trim();
  }
  if (typeof error?.name === "string" && error.name.trim() && error.name !== "Error") {
    return error.name.trim();
  }
  return "unknown";
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
}

function normalizePayoutMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([userId, amount]) => typeof userId === "string" && userId.trim() && Number.isFinite(Number(amount)))
      .map(([userId, amount]) => [userId.trim(), Number(amount)])
  );
}

function normalizeAuditActionType(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toUpperCase();
  return ACCEPTED_ACTION_TYPES.has(normalized) ? normalized : "";
}

function normalizeAuditString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeAuditNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readActorStack(state, actorUserId) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !actorUserId) {
    return null;
  }
  return normalizeAuditNumber(state?.stacks?.[actorUserId]);
}

function buildAcceptedActionAuditMeta({ tableId, stateVersionAfter, auditAction, nextState }) {
  if (!auditAction || typeof auditAction !== "object" || Array.isArray(auditAction)) {
    return null;
  }
  const actionType = normalizeAuditActionType(auditAction.action ?? auditAction.actionType);
  const handId = normalizeAuditString(auditAction.handId) || normalizeAuditString(nextState?.handId);
  const actorUserId = normalizeAuditString(auditAction.actorUserId ?? auditAction.userId);
  if (!tableId || !handId || !actorUserId || !actionType || !Number.isInteger(stateVersionAfter)) {
    return null;
  }

  const phaseFrom = normalizeAuditString(auditAction.phaseFrom);
  const phaseTo = normalizeAuditString(auditAction.phaseTo) || normalizeAuditString(nextState?.phase);
  const amount = normalizeAuditNumber(auditAction.amount);
  const potTotalAfter = normalizeAuditNumber(auditAction.potTotalAfter ?? nextState?.potTotal ?? nextState?.pot);
  const currentBetAfter = normalizeAuditNumber(auditAction.currentBetAfter ?? nextState?.currentBet);
  const actorStackAfter = normalizeAuditNumber(auditAction.actorStackAfter ?? readActorStack(nextState, actorUserId));
  const requestId = normalizeAuditString(auditAction.requestId)
    || `audit:action:${tableId}:${handId}:${stateVersionAfter}:${actorUserId}:${actionType}`;

  const meta = {
    auditVersion: ACCEPTED_ACTION_AUDIT_VERSION,
    tableId,
    handId,
    actorUserId,
    action: actionType,
    phaseFrom: phaseFrom || null,
    phaseTo: phaseTo || null,
    stateVersionAfter
  };

  if (amount !== null) meta.amount = amount;
  if (typeof auditAction.isBot === "boolean") meta.isBot = auditAction.isBot;
  if (normalizeAuditString(auditAction.source ?? auditAction.trigger)) meta.source = normalizeAuditString(auditAction.source ?? auditAction.trigger);
  const stateVersionBefore = normalizeAuditNumber(auditAction.stateVersionBefore);
  if (stateVersionBefore !== null) meta.stateVersionBefore = stateVersionBefore;
  const potTotalBefore = normalizeAuditNumber(auditAction.potTotalBefore);
  if (potTotalBefore !== null) meta.potTotalBefore = potTotalBefore;
  if (potTotalAfter !== null) meta.potTotalAfter = potTotalAfter;
  const currentBetBefore = normalizeAuditNumber(auditAction.currentBetBefore);
  if (currentBetBefore !== null) meta.currentBetBefore = currentBetBefore;
  if (currentBetAfter !== null) meta.currentBetAfter = currentBetAfter;
  const toCall = normalizeAuditNumber(auditAction.toCall);
  if (toCall !== null) meta.toCall = toCall;
  const actorStackBefore = normalizeAuditNumber(auditAction.actorStackBefore);
  if (actorStackBefore !== null) meta.actorStackBefore = actorStackBefore;
  if (actorStackAfter !== null) meta.actorStackAfter = actorStackAfter;

  return {
    tableId,
    version: stateVersionAfter,
    userId: actorUserId,
    actionType,
    amount,
    handId,
    requestId,
    phaseFrom: phaseFrom || null,
    phaseTo: phaseTo || null,
    meta
  };
}

function normalizePotsAwarded(potsAwarded) {
  if (!Array.isArray(potsAwarded)) {
    return [];
  }
  return potsAwarded
    .filter((pot) => pot && typeof pot === "object" && !Array.isArray(pot))
    .map((pot) => ({
      amount: Number.isFinite(Number(pot.amount)) ? Number(pot.amount) : 0,
      winners: normalizeStringList(pot.winners),
      eligibleUserIds: normalizeStringList(pot.eligibleUserIds)
    }));
}

function normalizeEvaluatedHands(handsByUserId) {
  if (!handsByUserId || typeof handsByUserId !== "object" || Array.isArray(handsByUserId)) {
    return [];
  }
  return Object.entries(handsByUserId)
    .filter(([userId, hand]) => typeof userId === "string" && userId.trim() && hand && typeof hand === "object" && !Array.isArray(hand))
    .map(([userId, hand]) => ({
      userId: userId.trim(),
      category: hand.category ?? null,
      name: typeof hand.name === "string" ? hand.name : null,
      ranks: Array.isArray(hand.ranks) ? hand.ranks.filter((rank) => Number.isFinite(Number(rank))).map((rank) => Number(rank)) : [],
      bestFiveCards: normalizeCardList(hand.best5)
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

function buildSettlementAuditMeta({ tableId, state }) {
  const handId = typeof state?.handSettlement?.handId === "string" && state.handSettlement.handId.trim()
    ? state.handSettlement.handId.trim()
    : (typeof state?.handId === "string" ? state.handId.trim() : "");
  if (!tableId || !handId || state?.phase !== "SETTLED" || !state?.handSettlement) {
    return null;
  }
  const meta = {
    auditVersion: SETTLEMENT_AUDIT_VERSION,
    tableId,
    handId,
    settledAt: typeof state.handSettlement?.settledAt === "string" ? state.handSettlement.settledAt : null,
    reason: typeof state?.showdown?.reason === "string" ? state.showdown.reason : null,
    communityCards: normalizeCardList(state?.community),
    winners: normalizeStringList(state?.showdown?.winners),
    payoutByUserId: normalizePayoutMap(state?.handSettlement?.payouts),
    potsAwarded: normalizePotsAwarded(state?.showdown?.potsAwarded)
  };
  const evaluatedHands = normalizeEvaluatedHands(state?.showdown?.handsByUserId);
  if (evaluatedHands.length > 0) {
    meta.evaluatedHands = evaluatedHands;
  }
  return meta;
}

async function maybeWriteSettlementAudit({ tx, tableId, stateVersion, state, klog = () => {} }) {
  const auditMeta = buildSettlementAuditMeta({ tableId, state });
  if (!auditMeta) {
    return { ok: true, skipped: true };
  }
  const existingRows = await tx.unsafe(
    "select id from public.poker_actions where table_id = $1 and hand_id = $2 and action_type = $3 limit 1;",
    [tableId, auditMeta.handId, HAND_SETTLED_ACTION_TYPE]
  );
  if (existingRows?.[0]?.id) {
    return { ok: true, skipped: true, alreadyApplied: true };
  }
  await tx.unsafe(
    "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
    [
      tableId,
      stateVersion,
      null,
      HAND_SETTLED_ACTION_TYPE,
      null,
      auditMeta.handId,
      `audit:settlement:${tableId}:${auditMeta.handId}`,
      null,
      "SETTLED",
      JSON.stringify(auditMeta)
    ]
  );
  klog("ws_hand_settlement_audit_written", {
    tableId,
    handId: auditMeta.handId,
    stateVersion,
    actionType: HAND_SETTLED_ACTION_TYPE
  });
  return { ok: true };
}

async function maybeWriteAcceptedActionAudit({ tx, tableId, stateVersion, state, auditAction, klog = () => {} }) {
  const audit = buildAcceptedActionAuditMeta({ tableId, stateVersionAfter: stateVersion, auditAction, nextState: state });
  if (!audit) {
    return { ok: true, skipped: true };
  }

  const existingRows = await tx.unsafe(
    "select id from public.poker_actions where table_id = $1 and request_id = $2 limit 1;",
    [tableId, audit.requestId]
  );
  if (existingRows?.[0]?.id) {
    return { ok: true, skipped: true, alreadyApplied: true };
  }

  await tx.unsafe(
    "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
    [
      audit.tableId,
      audit.version,
      audit.userId,
      audit.actionType,
      audit.amount,
      audit.handId,
      audit.requestId,
      audit.phaseFrom,
      audit.phaseTo,
      JSON.stringify(audit.meta)
    ]
  );
  klog("ws_accepted_action_audit_written", {
    tableId,
    handId: audit.handId,
    requestId: audit.requestId,
    actionType: audit.actionType,
    stateVersion
  });
  return { ok: true };
}

async function maybeWriteHoleCards({ tx, tableId, state, klog = () => {} }) {
  const { handId, rows } = buildHoleCardRows(state);
  if (!tableId || !handId || rows.length === 0) {
    if (tableId || handId) {
      const holeCardsByUserId = state?.holeCardsByUserId;
      klog("ws_hole_cards_persist_skipped", {
        tableId,
        handId: handId || null,
        hasHandId: Boolean(handId),
        hasHoleCardsByUserId: Boolean(holeCardsByUserId && typeof holeCardsByUserId === "object" && !Array.isArray(holeCardsByUserId)),
        playerCount: rows.length
      });
    }
    return { ok: true, skipped: true };
  }
  const placeholders = rows.map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}::jsonb)`).join(", ");
  const params = rows.flatMap((entry) => [tableId, handId, entry.userId, JSON.stringify(entry.cards)]);
  await tx.unsafe(
    `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ${placeholders} on conflict (table_id, hand_id, user_id) do update set cards = excluded.cards;`,
    params
  );
  return { ok: true, playerCount: rows.length };
}

export function createPersistedStateWriter({ env = process.env, beginSql = beginSqlWs, klog = () => {} } = {}) {
  async function writeViaDb({ tableId, expectedVersion, nextState, privateStateForHoleCards = null, acceptedActionAudit = null }) {
    return beginSql(async (tx) => {
      const persistedState = sanitizePersistedState(nextState);
      const holeCardState = normalizeJsonState(privateStateForHoleCards) || {};
      const payload = JSON.stringify(persistedState);
      const rows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $3::jsonb, updated_at = now() where table_id = $1 and version = $2 returning version;",
        [tableId, expectedVersion, payload]
      );
      const newVersion = Number(rows?.[0]?.version);
      if (Number.isInteger(newVersion) && newVersion >= 0) {
        await tx.unsafe("update public.poker_tables set last_activity_at = now() where id = $1;", [tableId]);
        try {
          await maybeWriteHoleCards({ tx, tableId, state: holeCardState, klog });
        } catch (error) {
          const { handId, rows } = buildHoleCardRows(holeCardState);
          klog("ws_hole_cards_persist_failed", {
            tableId,
            handId: handId || persistedState?.handId || null,
            playerCount: rows.length,
            reason: safeHoleCardPersistReason(error)
          });
        }
        try {
          await maybeWriteAcceptedActionAudit({ tx, tableId, stateVersion: newVersion, state: persistedState, auditAction: acceptedActionAudit, klog });
        } catch (error) {
          klog("ws_accepted_action_audit_failed", {
            tableId,
            handId: acceptedActionAudit?.handId ?? persistedState?.handId ?? null,
            requestId: acceptedActionAudit?.requestId ?? null,
            actionType: acceptedActionAudit?.action ?? acceptedActionAudit?.actionType ?? null,
            reason: error?.message || "unknown"
          });
        }
        try {
          await maybeWriteSettlementAudit({ tx, tableId, stateVersion: newVersion, state: persistedState, klog });
        } catch (error) {
          klog("ws_hand_settlement_audit_failed", {
            tableId,
            handId: persistedState?.handSettlement?.handId ?? persistedState?.handId ?? null,
            stateVersion: newVersion,
            reason: error?.message || "unknown"
          });
        }
        return { ok: true, newVersion };
      }

      const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
      const currentRow = stateRows?.[0];
      if (!currentRow) return { ok: false, reason: "not_found" };
      const currentVersion = Number(currentRow?.version);
      const currentState = sanitizePersistedState(currentRow?.state);
      const equalState = stableStringify(currentState) === stableStringify(sanitizePersistedState(nextState));
      if (equalState) {
        try {
          await maybeWriteHoleCards({ tx, tableId, state: holeCardState, klog });
        } catch (error) {
          const { handId, rows } = buildHoleCardRows(holeCardState);
          klog("ws_hole_cards_persist_failed", {
            tableId,
            handId: handId || currentState?.handId || null,
            playerCount: rows.length,
            reason: safeHoleCardPersistReason(error)
          });
        }
        try {
          await maybeWriteAcceptedActionAudit({ tx, tableId, stateVersion: Number.isInteger(currentVersion) ? currentVersion : expectedVersion, state: currentState, auditAction: acceptedActionAudit, klog });
        } catch (error) {
          klog("ws_accepted_action_audit_failed", {
            tableId,
            handId: acceptedActionAudit?.handId ?? currentState?.handId ?? null,
            requestId: acceptedActionAudit?.requestId ?? null,
            actionType: acceptedActionAudit?.action ?? acceptedActionAudit?.actionType ?? null,
            reason: error?.message || "unknown"
          });
        }
        try {
          await maybeWriteSettlementAudit({ tx, tableId, stateVersion: Number.isInteger(currentVersion) ? currentVersion : expectedVersion, state: currentState, klog });
        } catch (error) {
          klog("ws_hand_settlement_audit_failed", {
            tableId,
            handId: currentState?.handSettlement?.handId ?? currentState?.handId ?? null,
            stateVersion: Number.isInteger(currentVersion) ? currentVersion : expectedVersion,
            reason: error?.message || "unknown"
          });
        }
        return { ok: true, newVersion: Number.isInteger(currentVersion) ? currentVersion : expectedVersion, alreadyApplied: true };
      }
      return { ok: false, reason: "conflict", currentVersion: Number.isInteger(currentVersion) ? currentVersion : null };
    }, { env });
  }

  async function writeMutation({ tableId, expectedVersion, nextState, privateStateForHoleCards = null, supabaseUrl, supabaseServiceRoleKey, meta = null, acceptedActionAudit = null }) {
    if (!tableId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return { ok: false, reason: "invalid" };
    }
    if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
      return { ok: false, reason: "invalid" };
    }
    const persistedState = sanitizePersistedState(nextState);
    const holeCardPrivateState = privateStateForHoleCards
      ? normalizeJsonState(privateStateForHoleCards)
      : normalizeJsonState(nextState);
    try {
      JSON.stringify(persistedState);
    } catch {
      return { ok: false, reason: "invalid" };
    }

    try {
      const forcedFailureKind = typeof env.WS_TEST_PERSIST_FAIL_KIND === "string" ? env.WS_TEST_PERSIST_FAIL_KIND.trim() : "";
      if (forcedFailureKind && forcedFailureKind === String(meta?.mutationKind || "")) {
        return { ok: false, reason: "conflict" };
      }
      if (env.WS_PERSISTED_STATE_FILE) {
        return writePersistedTableToFile({
          filePath: env.WS_PERSISTED_STATE_FILE,
          tableId,
          expectedVersion,
          nextState: persistedState
        });
      }
      if (!env.SUPABASE_DB_URL && !supabaseUrl && !supabaseServiceRoleKey) {
        return { ok: false, reason: "config_missing" };
      }
      return await writeViaDb({ tableId, expectedVersion, nextState: persistedState, privateStateForHoleCards: holeCardPrivateState, acceptedActionAudit });
    } catch (error) {
      klog("ws_persisted_state_write_error", {
        tableId,
        expectedVersion,
        reason: "db_error",
        message: error?.message || "unknown",
        ...(meta && typeof meta === "object" ? meta : {})
      });
      return { ok: false, reason: "db_error", message: error?.message || "unknown" };
    }
  }

  return { writeMutation };
}
