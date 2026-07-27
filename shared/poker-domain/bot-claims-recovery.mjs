import { createHash } from "node:crypto";
import { postTransaction } from "../../netlify/functions/_shared/chips-ledger.mjs";
import {
  ensurePokerRequest,
  storePokerRequestResult,
} from "../../netlify/functions/_shared/poker-idempotency.mjs";
import {
  executeTerminalPokerCloseInTx,
  loadBotFundingRows,
} from "./terminal-close.mjs";

const RECOVERY_KIND = "ADMIN_BOT_CLAIMS_RECOVERY";
const RECOVERY_CLOSE_REASON = "ADMIN_BOT_CLAIMS_RECOVERY";
const GAMEPLAY_REQUEST_KINDS = new Set(["ACT", "JOIN", "LEAVE", "REBUY"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeNonNegativeInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function addSafe(left, right) {
  const result = left + right;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function fail(reason, extra = {}) {
  return {
    ok: false,
    eligible: false,
    changed: false,
    closed: false,
    retryable: false,
    code: "bot_claims_recovery_ineligible",
    reason,
    ...extra,
  };
}

function conflict(reason) {
  const error = new Error(reason);
  error.code = reason;
  error.status = 409;
  return error;
}

function parseStateSeat(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const userId = normalizeString(row.userId ?? row.user_id);
  const seatNo = normalizeNonNegativeInt(row.seatNo ?? row.seat_no ?? row.seat);
  if (!userId || seatNo == null || seatNo < 1) return null;
  const rawIsBot = row.isBot ?? row.is_bot;
  return {
    userId,
    seatNo,
    isBot: rawIsBot === true ? true : rawIsBot === false ? false : null,
  };
}

function normalizeSettlementPayoutIds(meta) {
  const parsed = normalizeJsonObject(meta);
  const payouts = normalizeJsonObject(parsed?.payoutByUserId);
  return payouts ? Object.keys(payouts).map(normalizeString).filter(Boolean) : [];
}

function terminalCashoutEvidence(transaction, stateVersion) {
  const metadata = normalizeJsonObject(transaction?.metadata) || {};
  const reason = normalizeString(metadata.reason).toUpperCase();
  const key = normalizeString(transaction?.idempotency_key);
  const isTerminal =
    reason === "HUMAN_TERMINAL_CASH_OUT"
    || reason === "BOT_TERMINAL_CASH_OUT"
    || key.startsWith("poker:human-terminal-cashout:v1:")
    || key.startsWith("poker:bot-terminal-cashout:v1:");
  if (!isTerminal) return { terminal: false, blocking: false };
  const fromVersion = normalizeNonNegativeInt(metadata.fromStateVersion);
  const toVersion = normalizeNonNegativeInt(metadata.toStateVersion);
  if (fromVersion == null || toVersion == null) {
    return { terminal: true, blocking: true };
  }
  return {
    terminal: true,
    blocking: toVersion >= stateVersion || fromVersion >= stateVersion,
  };
}

function buildInputHash({ escrowBefore, seats }) {
  const seatProjection = seats
    .map((seat) => ({
      userId: normalizeString(seat.user_id),
      seatNo: normalizeNonNegativeInt(seat.seat_no),
      isBot: seat.is_bot === true,
    }))
    .sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId));
  return createHash("sha256")
    .update(JSON.stringify({ escrowBefore, seats: seatProjection }))
    .digest("hex");
}

function collectParticipantEvidence({
  adminUserId,
  table,
  state,
  seats,
  actions,
  requests,
  ledgerTransactions,
  ledgerUserIds,
  fundingRecords,
}) {
  const participants = new Set();
  const humanEvidence = new Set();
  const botEvidence = new Set();
  let conflicting = false;
  const addParticipant = (value) => {
    const userId = normalizeString(value);
    if (userId) participants.add(userId);
  };
  const addHuman = (value) => {
    const userId = normalizeString(value);
    if (!userId) return;
    participants.add(userId);
    humanEvidence.add(userId);
  };
  const addBot = (value) => {
    const userId = normalizeString(value);
    if (!userId) return;
    participants.add(userId);
    botEvidence.add(userId);
  };

  const creatorUserId = normalizeString(table?.created_by);
  for (const seat of seats) {
    if (seat?.is_bot === true) addParticipant(seat.user_id);
    else if (seat?.is_bot === false) addHuman(seat.user_id);
    else conflicting = true;
  }
  for (const stateSeatRaw of Array.isArray(state?.seats) ? state.seats : []) {
    const stateSeat = parseStateSeat(stateSeatRaw);
    if (!stateSeat) {
      conflicting = true;
      continue;
    }
    if (stateSeat.isBot === true) addParticipant(stateSeat.userId);
    else if (stateSeat.isBot === false) addHuman(stateSeat.userId);
    else addParticipant(stateSeat.userId);
  }
  for (const userId of Object.keys(normalizeJsonObject(state?.stacks) || {})) addParticipant(userId);

  for (const record of fundingRecords) {
    if (record?.kind === "seed") addBot(record.botUserId);
    if (record?.kind === "replacement") {
      addBot(record.oldBotUserId);
      addBot(record.replacementBotUserId);
    }
  }
  for (const action of actions) {
    const actionType = normalizeString(action?.action_type).toUpperCase();
    if (!actionType.startsWith("ADMIN_")) {
      if (normalizeString(action?.user_id) === creatorUserId) addHuman(action.user_id);
      else addParticipant(action?.user_id);
    }
    if (actionType === "HAND_SETTLED") {
      for (const userId of normalizeSettlementPayoutIds(action?.meta)) addParticipant(userId);
    }
  }
  for (const request of requests) {
    if (GAMEPLAY_REQUEST_KINDS.has(normalizeString(request?.kind).toUpperCase())) {
      if (normalizeString(request?.user_id) === creatorUserId) addHuman(request.user_id);
      else addParticipant(request?.user_id);
    }
  }
  for (const transaction of ledgerTransactions) {
    const metadata = normalizeJsonObject(transaction?.metadata) || {};
    const reason = normalizeString(metadata.reason).toUpperCase();
    if (transaction?.user_id) addHuman(transaction.user_id);
    if (reason === "BOT_SEED_BUY_IN") addBot(metadata.botUserId);
    if (reason === "BOT_REPLACEMENT_BUY_IN") {
      addBot(metadata.oldBotUserId);
      addBot(metadata.replacementBotUserId);
    }
    if (reason === "BOT_TERMINAL_CASH_OUT") addBot(metadata.botUserId);
  }
  for (const userId of ledgerUserIds) addHuman(userId);

  for (const userId of participants) {
    if (!UUID_RE.test(userId)) conflicting = true;
    if (humanEvidence.has(userId) && botEvidence.has(userId)) conflicting = true;
  }
  if (conflicting) return fail("identity_evidence_conflict");

  const foreignHumans = [...humanEvidence].filter((userId) => userId !== adminUserId);
  if (foreignHumans.length > 0) return fail("foreign_human_history");

  const unknown = [...participants].filter((userId) => userId !== adminUserId && !botEvidence.has(userId));
  if (unknown.length > 0) return fail("participant_identity_unknown");

  return {
    ok: true,
    participants,
    botUserIds: botEvidence,
    hasAdminHuman: humanEvidence.has(adminUserId),
  };
}

export function projectBotClaimsRepair({ state, seats, escrowBefore, adminUserId, identityEvidence }) {
  const stacks = normalizeJsonObject(state?.stacks);
  if (!stacks || !identityEvidence?.ok) return fail("stack_or_identity_invalid");
  const normalizedEscrow = normalizeNonNegativeInt(escrowBefore);
  if (normalizedEscrow == null) return fail("escrow_invalid");

  const normalizedStacks = new Map();
  let claimTotal = 0;
  for (const [userIdRaw, amountRaw] of Object.entries(stacks)) {
    const userId = normalizeString(userIdRaw);
    const amount = normalizeNonNegativeInt(amountRaw);
    if (!userId || amount == null || normalizedStacks.has(userId)) return fail("stack_state_invalid");
    normalizedStacks.set(userId, amount);
    claimTotal = addSafe(claimTotal, amount);
    if (claimTotal == null) return fail("claims_overflow");
  }

  const seatByUserId = new Map();
  for (const seat of seats) {
    const userId = normalizeString(seat?.user_id);
    const seatNo = normalizeNonNegativeInt(seat?.seat_no);
    if (!userId || seatNo == null || seatNo < 1 || seatByUserId.has(userId)) return fail("seat_state_invalid");
    seatByUserId.set(userId, { userId, seatNo, isBot: seat.is_bot === true });
  }

  const bots = [];
  let humanStack = null;
  for (const [userId, amount] of normalizedStacks) {
    const seat = seatByUserId.get(userId);
    if (!seat) return fail("claimant_seat_missing");
    if (userId === adminUserId) {
      if (seat.isBot || humanStack != null) return fail("human_claim_invalid");
      humanStack = amount;
      continue;
    }
    if (!seat.isBot || !identityEvidence.botUserIds.has(userId)) return fail("bot_claimant_unconfirmed");
    bots.push({ userId, seatNo: seat.seatNo, before: amount, after: amount });
  }
  bots.sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId));

  const delta = normalizedEscrow - claimTotal;
  if (!Number.isSafeInteger(delta)) return fail("delta_invalid");
  if (delta > 0) {
    if (bots.length === 0) return fail("missing_bot_for_positive_delta");
    const corrected = addSafe(bots[0].after, delta);
    if (corrected == null) return fail("claims_overflow");
    bots[0].after = corrected;
  } else if (delta < 0) {
    let remaining = Math.abs(delta);
    for (const bot of bots) {
      const deduction = Math.min(bot.after, remaining);
      bot.after -= deduction;
      remaining -= deduction;
      if (remaining === 0) break;
    }
    if (remaining !== 0) return fail("insufficient_bot_stacks");
  }

  const correctedStacks = { ...stacks };
  for (const bot of bots) correctedStacks[bot.userId] = bot.after;
  if (humanStack != null && correctedStacks[adminUserId] !== humanStack) return fail("human_stack_changed");
  const correctedTotal = Object.values(correctedStacks).reduce((sum, amount) => sum + Number(amount), 0);
  if (!Number.isSafeInteger(correctedTotal) || correctedTotal !== normalizedEscrow) {
    return fail("corrected_claims_mismatch");
  }

  return {
    ok: true,
    eligible: true,
    claimTotal,
    escrow: normalizedEscrow,
    delta,
    humanStack,
    correctedStacks,
    bots,
  };
}

async function loadRecoverySnapshotTx(tx, { tableId, lock }) {
  const lockClause = lock ? " for update" : "";
  const tableRows = await tx.unsafe(
    `select id, status, created_by from public.poker_tables where id = $1 limit 1${lockClause};`,
    [tableId],
  );
  const stateRows = await tx.unsafe(
    `select version, state from public.poker_state where table_id = $1 limit 1${lockClause};`,
    [tableId],
  );
  const seatRows = await tx.unsafe(
    `select user_id, seat_no, status, is_bot, stack from public.poker_seats where table_id = $1 order by seat_no asc${lockClause};`,
    [tableId],
  );
  const escrowRows = await tx.unsafe(
    `select id, account_type, system_key, status, balance from public.chips_accounts where system_key = $1 limit 1${lockClause};`,
    [`POKER_TABLE:${tableId}`],
  );
  return {
    table: tableRows?.[0] || null,
    stateRow: stateRows?.[0] || null,
    seats: Array.isArray(seatRows) ? seatRows : [],
    escrow: escrowRows?.[0] || null,
  };
}

async function loadRecoveryEvidenceTx(tx, { tableId, escrowAccountId }) {
  const [actions, requests, transactions, ledgerUsers, funding] = await Promise.all([
    tx.unsafe(
      "select user_id, action_type, meta from public.poker_actions where table_id = $1 order by created_at asc, id asc;",
      [tableId],
    ),
    tx.unsafe(
      "select user_id, request_id, kind, result_json from public.poker_requests where table_id = $1 order by created_at asc;",
      [tableId],
    ),
    tx.unsafe(
      `select id, user_id, tx_type, idempotency_key, metadata
       from public.chips_transactions
       where reference = $1 or coalesce(metadata->>'tableId', '') = $2
       order by created_at asc, id asc;`,
      [`table:${tableId}`, tableId],
    ),
    tx.unsafe(
      `select distinct a.user_id
       from public.chips_transactions t
       join public.chips_entries e on e.transaction_id = t.id
       join public.chips_accounts a on a.id = e.account_id
       where (t.reference = $1 or coalesce(t.metadata->>'tableId', '') = $2)
         and a.account_type = 'USER'
         and a.user_id is not null;`,
      [`table:${tableId}`, tableId],
    ),
    loadBotFundingRows(tx, { tableId, escrowAccountId }),
  ]);
  return {
    actions: Array.isArray(actions) ? actions : [],
    requests: Array.isArray(requests) ? requests : [],
    transactions: Array.isArray(transactions) ? transactions : [],
    ledgerUserIds: (Array.isArray(ledgerUsers) ? ledgerUsers : []).map((row) => row.user_id).filter(Boolean),
    funding,
  };
}

async function evaluateRecoveryTx(tx, {
  tableId,
  adminUserId,
  lock,
  snapshot: suppliedSnapshot = null,
  allowedPendingRequest = null,
}) {
  const snapshot = suppliedSnapshot || await loadRecoverySnapshotTx(tx, { tableId, lock });
  const table = snapshot.table;
  const stateVersion = normalizeNonNegativeInt(snapshot.stateRow?.version);
  const state = normalizeJsonObject(snapshot.stateRow?.state);
  if (!table || stateVersion == null || !state) return fail("table_or_state_missing");
  if (normalizeString(table.status).toUpperCase() !== "OPEN") return fail("table_not_open");
  if (normalizeString(state.phase).toUpperCase() !== "SETTLED") return fail("phase_not_settled");

  const pot = Object.prototype.hasOwnProperty.call(state, "pot") ? normalizeNonNegativeInt(state.pot) : 0;
  const potTotal = Object.prototype.hasOwnProperty.call(state, "potTotal") ? normalizeNonNegativeInt(state.potTotal) : pot;
  if (pot == null || potTotal == null || pot !== potTotal || potTotal !== 0) return fail("pot_not_zero");

  const escrowBefore = normalizeNonNegativeInt(snapshot.escrow?.balance);
  if (
    !UUID_RE.test(normalizeString(snapshot.escrow?.id))
    || normalizeString(snapshot.escrow?.account_type).toUpperCase() !== "ESCROW"
    || normalizeString(snapshot.escrow?.status).toLowerCase() !== "active"
    || escrowBefore == null
  ) {
    return fail("escrow_invalid");
  }

  const evidence = await loadRecoveryEvidenceTx(tx, {
    tableId,
    escrowAccountId: snapshot.escrow.id,
  });
  if (!evidence.funding?.ok) return fail(evidence.funding?.reason || "bot_funding_invalid");

  const pendingRequests = evidence.requests.filter((request) => request.result_json == null);
  const otherPendingRequests = pendingRequests.filter(
    (pending) => !(
      allowedPendingRequest
      && normalizeString(pending.request_id) === allowedPendingRequest.requestId
      && normalizeString(pending.user_id) === allowedPendingRequest.userId
      && normalizeString(pending.kind) === allowedPendingRequest.kind
    ),
  );
  if (otherPendingRequests.length > 0) return fail("other_request_pending");
  const blockingTerminalCashouts = evidence.transactions.filter(
    (transaction) => terminalCashoutEvidence(transaction, stateVersion).blocking,
  );
  if (blockingTerminalCashouts.length > 0) return fail("terminal_close_already_persisted");

  const identities = collectParticipantEvidence({
    adminUserId,
    table,
    state,
    seats: snapshot.seats,
    actions: evidence.actions,
    requests: evidence.requests,
    ledgerTransactions: evidence.transactions,
    ledgerUserIds: evidence.ledgerUserIds,
    fundingRecords: evidence.funding.records,
  });
  if (!identities.ok) return identities;

  const projection = projectBotClaimsRepair({
    state,
    seats: snapshot.seats,
    escrowBefore,
    adminUserId,
    identityEvidence: identities,
  });
  if (!projection.ok) return projection;

  return {
    ...projection,
    stateVersion,
    inputHash: buildInputHash({ escrowBefore, seats: snapshot.seats }),
    state,
  };
}

function toSafeResult(result) {
  return {
    ok: result.ok === true,
    eligible: result.eligible === true,
    reason: result.reason || null,
    stateVersion: result.stateVersion ?? null,
    finalStateVersion: result.finalStateVersion ?? null,
    inputHash: result.inputHash || null,
    claimTotal: result.claimTotal ?? null,
    escrow: result.escrow ?? null,
    delta: result.delta ?? null,
    humanStack: result.humanStack ?? null,
    bots: Array.isArray(result.bots)
      ? result.bots.map(({ seatNo, before, after }) => ({ seatNo, before, after }))
      : [],
    changed: result.changed === true,
    closed: result.closed === true,
    replayed: result.replayed === true,
    recoveryReason: result.recoveryReason || null,
  };
}

export async function preflightBotClaimsRecovery({ beginSql, tableId, adminUserId }) {
  if (typeof beginSql !== "function") throw new Error("bot_claims_recovery_begin_sql_missing");
  return beginSql(async (tx) => {
    const evaluated = await evaluateRecoveryTx(tx, { tableId, adminUserId, lock: false });
    return toSafeResult(evaluated);
  });
}

export async function executeBotClaimsRecovery({
  beginSql,
  tableId,
  adminUserId,
  requestId,
  expectedStateVersion,
  expectedInputHash,
  reason,
  hasActivePresence,
  klog = () => {},
}) {
  if (typeof beginSql !== "function") throw new Error("bot_claims_recovery_begin_sql_missing");
  return beginSql(async (tx) => {
    const snapshot = await loadRecoverySnapshotTx(tx, { tableId, lock: true });
    if (!snapshot.table || !snapshot.stateRow || !snapshot.escrow) throw conflict("table_or_state_missing");

    const request = await ensurePokerRequest(tx, {
      tableId,
      userId: adminUserId,
      requestId,
      kind: RECOVERY_KIND,
      pendingStaleSec: 30,
    });
    if (request.status === "stored") return { ...request.result, replayed: true };
    if (request.status === "pending") throw conflict("request_pending");

    const evaluated = await evaluateRecoveryTx(tx, {
      tableId,
      adminUserId,
      lock: true,
      snapshot,
      allowedPendingRequest: {
        requestId,
        userId: adminUserId,
        kind: RECOVERY_KIND,
      },
    });
    if (!evaluated.ok) throw conflict(evaluated.reason);
    if (evaluated.stateVersion !== expectedStateVersion) throw conflict("state_version_changed");
    if (expectedInputHash && evaluated.inputHash !== expectedInputHash) throw conflict("recovery_input_changed");
    if (typeof hasActivePresence === "function" && hasActivePresence()) {
      throw conflict("active_table_presence");
    }

    const correctedVersion = evaluated.stateVersion + 1;
    if (!Number.isSafeInteger(correctedVersion)) throw conflict("state_version_invalid");
    const correctedState = { ...evaluated.state, stacks: evaluated.correctedStacks };
    const updatedRows = await tx.unsafe(
      `update public.poker_state
       set version = version + 1, state = $3::jsonb, updated_at = now()
       where table_id = $1 and version = $2
       returning version;`,
      [tableId, evaluated.stateVersion, JSON.stringify(correctedState)],
    );
    if (Number(updatedRows?.[0]?.version) !== correctedVersion) throw conflict("state_version_changed");

    const closed = await executeTerminalPokerCloseInTx({
      tx,
      tableId,
      postTransaction,
      createdBy: adminUserId,
      closeReason: RECOVERY_CLOSE_REASON,
      successStatus: "bot_claims_recovered_closed",
      klog,
    });
    if (closed?.ok !== true || closed?.closed !== true || closed?.changed !== true) {
      throw conflict(closed?.reason || closed?.code || "terminal_close_failed");
    }

    const postRows = await tx.unsafe(
      `select
         t.status as table_status,
         s.version as state_version,
         s.state as state,
         a.balance as escrow_balance,
         (select count(*) from public.poker_seats ps where ps.table_id = $1 and ps.status <> 'INACTIVE') as active_seats
       from public.poker_tables t
       join public.poker_state s on s.table_id = t.id
       join public.chips_accounts a on a.system_key = $2
       where t.id = $1
       limit 1;`,
      [tableId, `POKER_TABLE:${tableId}`],
    );
    const post = postRows?.[0] || {};
    const postState = normalizeJsonObject(post.state);
    if (
      normalizeString(post.table_status).toUpperCase() !== "CLOSED"
      || normalizeNonNegativeInt(post.escrow_balance) !== 0
      || normalizeNonNegativeInt(post.active_seats) !== 0
      || normalizeString(postState?.phase).toUpperCase() !== "HAND_DONE"
      || Object.keys(normalizeJsonObject(postState?.stacks) || {}).length !== 0
    ) {
      throw conflict("recovery_postcondition_failed");
    }

    const result = toSafeResult({
      ...evaluated,
      changed: true,
      closed: true,
      finalStateVersion: normalizeNonNegativeInt(post.state_version),
      recoveryReason: normalizeString(reason),
    });
    await storePokerRequestResult(tx, {
      tableId,
      userId: adminUserId,
      requestId,
      kind: RECOVERY_KIND,
      result,
    });
    return result;
  });
}

export {
  RECOVERY_KIND,
  collectParticipantEvidence,
};
