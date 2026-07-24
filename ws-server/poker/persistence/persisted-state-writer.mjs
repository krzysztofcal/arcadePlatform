import { createHash } from "node:crypto";
import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";
import { postTransaction } from "./chips-ledger.mjs";
import { writePersistedTableToFile } from "./persisted-state-file-store.mjs";
import { projectDurableActionResult } from "../idempotency/action-command.mjs";

const HAND_SETTLED_ACTION_TYPE = "HAND_SETTLED";
const SETTLEMENT_AUDIT_VERSION = 1;
const ACCEPTED_ACTION_AUDIT_VERSION = 1;
const ACCEPTED_ACTION_TYPES = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL_IN"]);
const MAX_REPLACEMENT_FUNDINGS = 10;
const MAX_HUMAN_STACK_UPDATES = 10;
const DURABLE_ACTION_KIND = "ACT";
const PAYLOAD_HASH_PATTERN = /^[a-f0-9]{64}$/;

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

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeDurableActionRequest(value, { expectedVersion = null } = {}) {
  if (value === undefined || value === null) return { ok: true, supplied: false, request: null };
  const identity = normalizeDurableActionIdentity(value);
  if (!identity) {
    return { ok: false, supplied: true, reason: "invalid_durable_action_request" };
  }
  const result = projectDurableActionResult(value?.result);
  if (!result) {
    return { ok: false, supplied: true, reason: "invalid_durable_action_request" };
  }
  if (Number.isInteger(expectedVersion) && result.stateVersion !== expectedVersion + 1) {
    return { ok: false, supplied: true, reason: "invalid_durable_action_request" };
  }
  return { ok: true, supplied: true, request: { ...identity, result } };
}

function normalizeDurableActionIdentity(value) {
  const userId = typeof value?.userId === "string" ? value.userId.trim() : "";
  const requestId = typeof value?.requestId === "string" ? value.requestId.trim() : "";
  const payloadHash = typeof value?.payloadHash === "string" ? value.payloadHash.trim().toLowerCase() : "";
  if (!userId || !requestId || requestId.length > 200 || !PAYLOAD_HASH_PATTERN.test(payloadHash)) return null;
  return { userId, requestId, payloadHash };
}

function classifyDurableActionRow(row, payloadHash) {
  if (!row) return { outcome: "missing" };
  const storedHash = typeof row?.payload_hash === "string" ? row.payload_hash.trim().toLowerCase() : "";
  if (!PAYLOAD_HASH_PATTERN.test(storedHash)) return { outcome: "invalid", reason: "idempotency_record_invalid" };
  if (storedHash !== payloadHash) return { outcome: "idempotency_conflict", reason: "idempotency_conflict" };
  const durableResult = projectDurableActionResult(parseJsonObject(row?.result_json));
  if (!durableResult) return { outcome: "invalid", reason: "idempotency_record_invalid" };
  return { outcome: "durable_replay", durableResult };
}

async function readDurableActionRow(tx, { tableId, userId, requestId, lock = false }) {
  const lockClause = lock ? " for update" : "";
  const rows = await tx.unsafe(
    `select payload_hash, result_json from public.poker_requests where table_id = $1 and kind = $2 and request_id = $3 and user_id = $4 limit 1${lockClause};`,
    [tableId, DURABLE_ACTION_KIND, requestId, userId]
  );
  return rows?.[0] || null;
}

async function reserveDurableActionRequest(tx, { tableId, request }) {
  const insertedRows = await tx.unsafe(
    `insert into public.poker_requests (table_id, user_id, request_id, kind, payload_hash, result_json)
     values ($1, $2, $3, $4, $5, null)
     on conflict (table_id, kind, request_id, user_id) do nothing
     returning request_id;`,
    [tableId, request.userId, request.requestId, DURABLE_ACTION_KIND, request.payloadHash]
  );
  if (insertedRows?.[0]?.request_id) return { outcome: "reserved" };
  const existingRow = await readDurableActionRow(tx, { tableId, userId: request.userId, requestId: request.requestId, lock: true });
  return classifyDurableActionRow(existingRow, request.payloadHash);
}

async function finalizeDurableActionRequest(tx, { tableId, request }) {
  const rows = await tx.unsafe(
    `update public.poker_requests set result_json = $6::jsonb
     where table_id = $1 and kind = $2 and request_id = $3 and user_id = $4 and payload_hash = $5
     returning request_id;`,
    [tableId, DURABLE_ACTION_KIND, request.requestId, request.userId, request.payloadHash, JSON.stringify(request.result)]
  );
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.request_id !== request.requestId) {
    const error = new Error("durable_action_finalize_conflict");
    error.code = "durable_action_finalize_conflict";
    throw error;
  }
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
    .filter((entry) => entry.userId && entry.cards.length === 2)
    .sort((left, right) => left.userId.localeCompare(right.userId));
  return { handId, rows };
}

function buildHoleCardFingerprint(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
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
  const insertedRows = await tx.unsafe(
    `insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     on conflict (table_id, hand_id)
       where hand_id is not null
         and btrim(hand_id) <> ''
         and action_type = 'HAND_SETTLED'
     do nothing
     returning id;`,
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
  if (!insertedRows?.[0]?.id) {
    return { ok: true, skipped: true, alreadyApplied: true };
  }
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

  const insertedRows = await tx.unsafe(
    `insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     on conflict (table_id, request_id)
       where request_id is not null
         and btrim(request_id) <> ''
         and action_type in ('FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN')
     do nothing
     returning id;`,
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
  if (!insertedRows?.[0]?.id) {
    return { ok: true, skipped: true, alreadyApplied: true };
  }
  klog("ws_accepted_action_audit_written", {
    tableId,
    handId: audit.handId,
    requestId: audit.requestId,
    actionType: audit.actionType,
    stateVersion
  });
  return { ok: true };
}

async function maybeWriteHoleCards({ tx, tableId, state, acknowledgement = null, klog = () => {} }) {
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
  const fingerprint = buildHoleCardFingerprint(rows);
  if (acknowledgement?.handId === handId && acknowledgement?.fingerprint === fingerprint) {
    return { ok: true, skipped: true, acknowledged: true };
  }
  const placeholders = rows.map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}::jsonb)`).join(", ");
  const params = rows.flatMap((entry) => [tableId, handId, entry.userId, JSON.stringify(entry.cards)]);
  await tx.unsafe(
    `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ${placeholders} on conflict (table_id, hand_id, user_id) do update set cards = excluded.cards;`,
    params
  );
  klog("ws_hole_cards_persist_written", {
    tableId,
    handId,
    playerCount: rows.length
  });
  return {
    ok: true,
    playerCount: rows.length,
    acknowledgement: { handId, fingerprint }
  };
}

function normalizeReplacementFundings({ replacementFundings, tableId, expectedVersion }) {
  if (replacementFundings === undefined) {
    return { ok: true, supplied: false, fundings: [] };
  }
  if (!Array.isArray(replacementFundings) || replacementFundings.length > MAX_REPLACEMENT_FUNDINGS) {
    return { ok: false, reason: "invalid_replacement_fundings" };
  }
  const seenSeats = new Set();
  const fundings = [];
  for (const value of replacementFundings) {
    const seatNo = Number(value?.seatNo);
    const oldStack = Number(value?.oldStack);
    const targetStack = Number(value?.targetStack);
    const fundingDelta = Number(value?.fundingDelta);
    const fromStateVersion = Number(value?.fromStateVersion);
    const toStateVersion = Number(value?.toStateVersion);
    const oldBotUserId = typeof value?.oldBotUserId === "string" ? value.oldBotUserId.trim() : "";
    const replacementBotUserId = typeof value?.replacementBotUserId === "string" ? value.replacementBotUserId.trim() : "";
    const settledHandId = typeof value?.settledHandId === "string" ? value.settledHandId.trim() : "";
    if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > MAX_REPLACEMENT_FUNDINGS || seenSeats.has(seatNo)
      || !Number.isInteger(oldStack) || oldStack < 0
      || !Number.isInteger(targetStack) || targetStack <= oldStack
      || !Number.isInteger(fundingDelta) || fundingDelta !== targetStack - oldStack
      || fromStateVersion !== expectedVersion || toStateVersion !== expectedVersion + 1
      || !oldBotUserId || !replacementBotUserId || !settledHandId) {
      return { ok: false, reason: "invalid_replacement_fundings" };
    }
    seenSeats.add(seatNo);
    fundings.push({
      seatNo,
      oldBotUserId,
      replacementBotUserId,
      oldStack,
      targetStack,
      fundingDelta,
      settledHandId,
      fromStateVersion,
      toStateVersion,
      idempotencyKey: `poker:bot-replacement-buyin:v1:${tableId}:${toStateVersion}:${seatNo}`
    });
  }
  fundings.sort((left, right) => left.seatNo - right.seatNo);
  return { ok: true, supplied: true, fundings };
}

function normalizeHumanStackUpdates({ humanStackUpdates, expectedVersion }) {
  if (humanStackUpdates === undefined) return { ok: true, supplied: false, updates: [] };
  if (!Array.isArray(humanStackUpdates) || humanStackUpdates.length > MAX_HUMAN_STACK_UPDATES) {
    return { ok: false, reason: "invalid_human_stack_updates" };
  }
  const seenUsers = new Set();
  const seenSeats = new Set();
  const updates = [];
  for (const value of humanStackUpdates) {
    const userId = typeof value?.userId === "string" ? value.userId.trim() : "";
    const seatNo = Number(value?.seatNo);
    const stack = Number(value?.stack);
    const fromStateVersion = Number(value?.fromStateVersion);
    const toStateVersion = Number(value?.toStateVersion);
    const settledHandId = typeof value?.settledHandId === "string" ? value.settledHandId.trim() : "";
    if (!userId || seenUsers.has(userId) || !Number.isInteger(seatNo) || seatNo < 1 || seatNo > MAX_HUMAN_STACK_UPDATES || seenSeats.has(seatNo)
      || !Number.isInteger(stack) || stack < 0 || fromStateVersion !== expectedVersion || toStateVersion !== expectedVersion + 1 || !settledHandId) {
      return { ok: false, reason: "invalid_human_stack_updates" };
    }
    seenUsers.add(userId);
    seenSeats.add(seatNo);
    updates.push({ userId, seatNo, stack, settledHandId, fromStateVersion, toStateVersion });
  }
  updates.sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId));
  return { ok: true, supplied: true, updates };
}

async function writeHumanStackUpdates({ tx, tableId, updates }) {
  const projectedHumanStacks = [];
  for (const update of updates) {
    const rows = await tx.unsafe(
      "update public.poker_seats set stack = $4 where table_id = $1 and user_id = $2 and seat_no = $3 and status = 'ACTIVE' and is_bot = false returning user_id, seat_no, stack;",
      [tableId, update.userId, update.seatNo, update.stack]
    );
    if (!Array.isArray(rows) || rows.length !== 1 || Number(rows[0]?.stack) !== update.stack) {
      const error = new Error("human_stack_projection_conflict");
      error.code = "human_stack_projection_conflict";
      throw error;
    }
    projectedHumanStacks.push({ userId: update.userId, seatNo: update.seatNo, stack: update.stack });
  }
  return projectedHumanStacks;
}

async function writeReplacementFundings({ tx, tableId, fundings, botFundingSystemKey }) {
  if (fundings.length === 0) {
    return [];
  }
  const sourceSystemKey = typeof botFundingSystemKey === "string" ? botFundingSystemKey.trim() : "";
  if (!sourceSystemKey) {
    const error = new Error("replacement_funding_config_invalid");
    error.code = "replacement_funding_config_invalid";
    throw error;
  }
  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  const fundedReplacements = [];
  for (const funding of fundings) {
    const result = await postTransaction({
      userId: null,
      txType: "TABLE_BUY_IN",
      idempotencyKey: funding.idempotencyKey,
      reference: `BOT_REPLACEMENT_BUY_IN:${tableId}:${funding.toStateVersion}:${funding.seatNo}`,
      description: "Poker bot replacement funding",
      metadata: {
        actor: "BOT",
        reason: "BOT_REPLACEMENT_BUY_IN",
        tableId,
        seatNo: funding.seatNo,
        oldBotUserId: funding.oldBotUserId,
        replacementBotUserId: funding.replacementBotUserId,
        settledHandId: funding.settledHandId,
        fromStateVersion: funding.fromStateVersion,
        toStateVersion: funding.toStateVersion,
        oldStack: funding.oldStack,
        targetStack: funding.targetStack,
        fundingDelta: funding.fundingDelta,
        sourceSystemKey
      },
      entries: [
        {
          accountType: "SYSTEM",
          systemKey: sourceSystemKey,
          amount: -funding.fundingDelta,
          metadata: { reason: "BOT_REPLACEMENT_BUY_IN", tableId, seatNo: funding.seatNo }
        },
        {
          accountType: "ESCROW",
          systemKey: escrowSystemKey,
          amount: funding.fundingDelta,
          metadata: { reason: "BOT_REPLACEMENT_BUY_IN", tableId, seatNo: funding.seatNo }
        }
      ],
      createdBy: null,
      tx
    });
    const transactionId = typeof result?.transaction?.id === "string" ? result.transaction.id : "";
    const payloadHash = typeof result?.transaction?.payload_hash === "string" ? result.transaction.payload_hash : "";
    if (!transactionId || !payloadHash) {
      const error = new Error("replacement_funding_receipt_invalid");
      error.code = "replacement_funding_receipt_invalid";
      throw error;
    }
    fundedReplacements.push({
      seatNo: funding.seatNo,
      idempotencyKey: funding.idempotencyKey,
      fundingDelta: funding.fundingDelta,
      transactionId,
      payloadHash
    });
  }
  return fundedReplacements;
}

export function createPersistedStateWriter({ env = process.env, beginSql = beginSqlWs, klog = () => {} } = {}) {
  const holeCardAcknowledgementByTableId = new Map();

  async function writeViaDb({
    tableId,
    expectedVersion,
    nextState,
    privateStateForHoleCards = null,
    acceptedActionAudit = null,
    replacementFundingPlan,
    humanStackUpdatePlan,
    botFundingSystemKey = null,
    durableActionPlan
  }) {
    let successfulHoleCardWrite = null;
    const result = await beginSql(async (tx) => {
      const persistedState = sanitizePersistedState(nextState);
      const holeCardState = normalizeJsonState(privateStateForHoleCards) || {};
      const payload = JSON.stringify(persistedState);
      if (durableActionPlan.supplied) {
        const reservation = await reserveDurableActionRequest(tx, { tableId, request: durableActionPlan.request });
        if (reservation.outcome !== "reserved") {
          return {
            ok: reservation.outcome === "durable_replay",
            ...reservation
          };
        }
      }
      const rows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $3::jsonb, updated_at = now() where table_id = $1 and version = $2 returning version;",
        [tableId, expectedVersion, payload]
      );
      const newVersion = Number(rows?.[0]?.version);
      if (Number.isInteger(newVersion) && newVersion >= 0) {
        const projectedHumanStacks = await writeHumanStackUpdates({ tx, tableId, updates: humanStackUpdatePlan.updates });
        const fundedReplacements = await writeReplacementFundings({
          tx,
          tableId,
          fundings: replacementFundingPlan.fundings,
          botFundingSystemKey
        });
        await tx.unsafe("update public.poker_tables set last_activity_at = now() where id = $1;", [tableId]);
        try {
          const holeCardResult = await maybeWriteHoleCards({
            tx,
            tableId,
            state: holeCardState,
            acknowledgement: holeCardAcknowledgementByTableId.get(tableId),
            klog
          });
          successfulHoleCardWrite = holeCardResult.acknowledgement || null;
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
        if (durableActionPlan.supplied) {
          await finalizeDurableActionRequest(tx, { tableId, request: durableActionPlan.request });
        }
        return {
          ok: true,
          newVersion,
          ...(durableActionPlan.supplied ? {
            outcome: "committed",
            durableResult: durableActionPlan.request.result
          } : {}),
          ...(replacementFundingPlan.supplied ? {
            tableId,
            expectedVersion,
            replacementFundingCommitted: true,
            fundedReplacements
          } : {}),
          ...(humanStackUpdatePlan.supplied ? {
            tableId,
            expectedVersion,
            humanStackProjectionCommitted: true,
            projectedHumanStacks
          } : {})
        };
      }

      if (durableActionPlan.supplied) {
        const error = new Error("durable_action_state_conflict");
        error.code = "durable_action_state_conflict";
        throw error;
      }

      const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
      const currentRow = stateRows?.[0];
      if (!currentRow) return { ok: false, reason: "not_found" };
      const currentVersion = Number(currentRow?.version);
      const currentState = sanitizePersistedState(currentRow?.state);
      const equalState = stableStringify(currentState) === stableStringify(sanitizePersistedState(nextState));
      if (equalState) {
        try {
          const holeCardResult = await maybeWriteHoleCards({
            tx,
            tableId,
            state: holeCardState,
            acknowledgement: holeCardAcknowledgementByTableId.get(tableId),
            klog
          });
          successfulHoleCardWrite = holeCardResult.acknowledgement || null;
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
    if (successfulHoleCardWrite) {
      holeCardAcknowledgementByTableId.set(tableId, successfulHoleCardWrite);
    }
    return result;
  }

  function forgetHoleCardAcknowledgement(tableId) {
    return holeCardAcknowledgementByTableId.delete(tableId);
  }

  async function writeMutation({
    tableId,
    expectedVersion,
    nextState,
    privateStateForHoleCards = null,
    supabaseUrl,
    supabaseServiceRoleKey,
    meta = null,
    acceptedActionAudit = null,
    replacementFundings = undefined,
    humanStackUpdates = undefined,
    botFundingSystemKey = null,
    durableActionRequest = null
  }) {
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
    const replacementFundingPlan = normalizeReplacementFundings({ replacementFundings, tableId, expectedVersion });
    if (!replacementFundingPlan.ok) {
      return { ok: false, reason: replacementFundingPlan.reason };
    }
    const humanStackUpdatePlan = normalizeHumanStackUpdates({ humanStackUpdates, expectedVersion });
    if (!humanStackUpdatePlan.ok) return { ok: false, reason: humanStackUpdatePlan.reason };
    const durableActionPlan = normalizeDurableActionRequest(durableActionRequest, { expectedVersion });
    if (!durableActionPlan.ok) return { ok: false, outcome: "invalid", reason: durableActionPlan.reason };
    if (replacementFundingPlan.fundings.length > 0) {
      const sourceSystemKey = typeof botFundingSystemKey === "string" ? botFundingSystemKey.trim() : "";
      if (!sourceSystemKey) {
        return { ok: false, reason: "replacement_funding_config_invalid" };
      }
    }

    try {
      const forcedFailureKind = typeof env.WS_TEST_PERSIST_FAIL_KIND === "string" ? env.WS_TEST_PERSIST_FAIL_KIND.trim() : "";
      if (forcedFailureKind && forcedFailureKind === String(meta?.mutationKind || "")) {
        return { ok: false, reason: "conflict" };
      }
      if (env.WS_PERSISTED_STATE_FILE) {
        if (durableActionPlan.supplied) {
          return { ok: false, outcome: "failure", reason: "durable_action_store_unavailable" };
        }
        if (replacementFundingPlan.fundings.length > 0) {
          return { ok: false, reason: "ledger_unavailable" };
        }
        return writePersistedTableToFile({
          filePath: env.WS_PERSISTED_STATE_FILE,
          tableId,
          expectedVersion,
          nextState: persistedState,
          humanStackUpdates: humanStackUpdatePlan.updates
        });
      }
      if (!env.SUPABASE_DB_URL && !supabaseUrl && !supabaseServiceRoleKey) {
        return { ok: false, reason: "config_missing" };
      }
      return await writeViaDb({
        tableId,
        expectedVersion,
        nextState: persistedState,
        privateStateForHoleCards: holeCardPrivateState,
        acceptedActionAudit,
        replacementFundingPlan,
        humanStackUpdatePlan,
        botFundingSystemKey,
        durableActionPlan
      });
    } catch (error) {
      klog("ws_persisted_state_write_error", {
        tableId,
        expectedVersion,
        reason: "db_error",
        message: error?.message || "unknown",
        ...(meta && typeof meta === "object" ? meta : {})
      });
      const stateConflict = error?.code === "durable_action_state_conflict";
      return {
        ok: false,
        ...(durableActionPlan.supplied ? { outcome: "failure" } : {}),
        reason: stateConflict ? "conflict" : "db_error",
        message: error?.message || "unknown"
      };
    }
  }

  async function readDurableActionRequest({ tableId, userId, requestId, payloadHash }) {
    const identity = normalizeDurableActionIdentity({ userId, requestId, payloadHash });
    if (!tableId || !identity) {
      return { outcome: "invalid", reason: "invalid_durable_action_request" };
    }
    if (!env.SUPABASE_DB_URL || env.WS_PERSISTED_STATE_FILE) {
      return { outcome: "failure", reason: "durable_action_store_unavailable" };
    }
    try {
      return await beginSql(async (tx) => {
        const row = await readDurableActionRow(tx, { tableId, userId: identity.userId, requestId: identity.requestId });
        return classifyDurableActionRow(row, identity.payloadHash);
      }, { env });
    } catch (error) {
      klog("ws_durable_action_read_error", { tableId, reason: "db_error", message: error?.message || "unknown" });
      return { outcome: "failure", reason: "db_error" };
    }
  }

  return { writeMutation, readDurableActionRequest, forgetHoleCardAcknowledgement };
}
