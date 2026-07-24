const TERMINAL_ACCOUNTING_ERROR = "terminal_accounting_invariant_failed";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_ACTION_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

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
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizePositiveInt(value) {
  const parsed = normalizeNonNegativeInt(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function normalizeStateChipAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeSeatNo(value) {
  return normalizePositiveInt(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuidLike(value) {
  return UUID_RE.test(normalizeString(value));
}

function invariantFailure(reason, extra = {}) {
  return {
    ok: false,
    code: TERMINAL_ACCOUNTING_ERROR,
    reason,
    changed: false,
    closed: false,
    retryable: false,
    ...extra
  };
}

function addSafe(left, right) {
  const total = left + right;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function toClosedInertState(state) {
  return {
    ...state,
    phase: "HAND_DONE",
    handId: "",
    handSeed: "",
    showdown: null,
    community: [],
    communityDealt: 0,
    pot: 0,
    potTotal: 0,
    sidePots: [],
    turnUserId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    lastAggressorUserId: null,
    currentBet: 0,
    toCallByUserId: {},
    betThisRoundByUserId: {},
    actedThisRoundByUserId: {},
    stacks: {}
  };
}

function normalizeFundingRows(rawRows, { tableId, escrowAccountId }) {
  const byTransactionId = new Map();
  for (const rawRow of Array.isArray(rawRows) ? rawRows : []) {
    const transactionId = normalizeString(rawRow?.transaction_id);
    if (!transactionId) return invariantFailure("bot_provenance_conflict");
    const current = byTransactionId.get(transactionId) || {
      transactionId,
      metadata: normalizeJsonObject(rawRow?.transaction_metadata),
      entries: []
    };
    current.entries.push({
      accountId: normalizeString(rawRow?.account_id),
      accountType: normalizeString(rawRow?.account_type).toUpperCase(),
      systemKey: normalizeString(rawRow?.system_key),
      status: normalizeString(rawRow?.account_status).toLowerCase(),
      amount: Number(rawRow?.amount)
    });
    byTransactionId.set(transactionId, current);
  }

  const records = [];
  for (const transaction of byTransactionId.values()) {
    const metadata = transaction.metadata;
    if (normalizeString(metadata?.actor).toUpperCase() !== "BOT") continue;
    const reason = normalizeString(metadata?.reason).toUpperCase();
    if (reason !== "BOT_SEED_BUY_IN" && reason !== "BOT_REPLACEMENT_BUY_IN") {
      return invariantFailure("bot_provenance_conflict");
    }
    if (normalizeString(metadata?.tableId) !== tableId || transaction.entries.length !== 2) {
      return invariantFailure("bot_provenance_conflict");
    }
    const escrowEntries = transaction.entries.filter((entry) => entry.accountId === escrowAccountId && entry.accountType === "ESCROW" && Number.isSafeInteger(entry.amount) && entry.amount > 0);
    const systemEntries = transaction.entries.filter((entry) => entry.accountType === "SYSTEM" && Number.isSafeInteger(entry.amount) && entry.amount < 0);
    if (escrowEntries.length !== 1 || systemEntries.length !== 1 || escrowEntries[0].amount + systemEntries[0].amount !== 0) {
      return invariantFailure("bot_provenance_conflict");
    }
    const source = systemEntries[0];
    if (!isUuidLike(source.accountId) || !source.systemKey || source.status !== "active") {
      return invariantFailure("source_system_missing_or_inactive");
    }
    const seatNo = normalizeSeatNo(metadata?.seatNo);
    if (!seatNo) return invariantFailure("bot_provenance_conflict");

    if (reason === "BOT_SEED_BUY_IN") {
      const botUserId = normalizeString(metadata?.botUserId);
      if (!isUuidLike(botUserId)) return invariantFailure("bot_provenance_conflict");
      records.push({
        kind: "seed",
        transactionId: transaction.transactionId,
        botUserId,
        seatNo,
        amount: escrowEntries[0].amount,
        sourceAccountId: source.accountId,
        sourceSystemKey: source.systemKey
      });
      continue;
    }

    const oldBotUserId = normalizeString(metadata?.oldBotUserId);
    const replacementBotUserId = normalizeString(metadata?.replacementBotUserId);
    const oldStack = normalizeNonNegativeInt(metadata?.oldStack);
    const targetStack = normalizePositiveInt(metadata?.targetStack);
    const fundingDelta = normalizePositiveInt(metadata?.fundingDelta);
    if (
      !isUuidLike(oldBotUserId)
      || !isUuidLike(replacementBotUserId)
      || oldBotUserId === replacementBotUserId
      || oldStack == null
      || targetStack == null
      || fundingDelta == null
      || targetStack - oldStack !== fundingDelta
      || fundingDelta !== escrowEntries[0].amount
    ) {
      return invariantFailure("bot_provenance_conflict");
    }
    records.push({
      kind: "replacement",
      transactionId: transaction.transactionId,
      oldBotUserId,
      replacementBotUserId,
      seatNo,
      oldStack,
      targetStack,
      fundingDelta,
      sourceAccountId: source.accountId,
      sourceSystemKey: source.systemKey
    });
  }
  return { ok: true, records };
}

export async function loadBotFundingRows(tx, { tableId, escrowAccountId }) {
  const rows = await tx.unsafe(
    `
select
  t.id as transaction_id,
  t.metadata as transaction_metadata,
  e.account_id,
  e.amount,
  a.account_type,
  a.system_key,
  a.status as account_status
from public.chips_transactions t
join public.chips_entries credited
  on credited.transaction_id = t.id
 and credited.account_id = $1
 and credited.amount > 0
join public.chips_entries e on e.transaction_id = t.id
join public.chips_accounts a on a.id = e.account_id
where t.tx_type = 'TABLE_BUY_IN'
order by t.created_at asc, t.id asc, e.id asc;
    `,
    [escrowAccountId]
  );
  return normalizeFundingRows(rows, { tableId, escrowAccountId });
}

export function resolveBotFundingSource({ botUserId, seatNo, rows }) {
  const normalizedBotUserId = normalizeString(botUserId);
  const normalizedSeatNo = normalizeSeatNo(seatNo);
  if (!isUuidLike(normalizedBotUserId) || !normalizedSeatNo) return invariantFailure("bot_identity_ambiguous");

  const seedByBotId = new Map();
  const replacementByBotId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row?.kind === "seed" ? normalizeString(row?.botUserId) : normalizeString(row?.replacementBotUserId);
    const target = row?.kind === "seed" ? seedByBotId : row?.kind === "replacement" ? replacementByBotId : null;
    if (!target || !key) continue;
    const existing = target.get(key);
    if (existing) return invariantFailure("bot_provenance_conflict");
    target.set(key, row);
  }

  const sourceByAccountId = new Map();
  const transactionIds = [];
  const visited = new Set();
  let currentBotUserId = normalizedBotUserId;
  for (let depth = 0; depth <= (Array.isArray(rows) ? rows.length : 0); depth += 1) {
    if (visited.has(currentBotUserId)) return invariantFailure("bot_provenance_cycle");
    visited.add(currentBotUserId);
    const seed = seedByBotId.get(currentBotUserId) || null;
    const replacement = replacementByBotId.get(currentBotUserId) || null;
    if ((seed && replacement) || (!seed && !replacement)) return invariantFailure("bot_provenance_missing");
    const record = replacement || seed;
    if (normalizeSeatNo(record?.seatNo) !== normalizedSeatNo) return invariantFailure("bot_provenance_conflict");
    const sourceAccountId = normalizeString(record?.sourceAccountId);
    const sourceSystemKey = normalizeString(record?.sourceSystemKey);
    if (!isUuidLike(sourceAccountId) || !sourceSystemKey) return invariantFailure("source_system_missing_or_inactive");
    if (sourceByAccountId.has(sourceAccountId) && sourceByAccountId.get(sourceAccountId) !== sourceSystemKey) {
      return invariantFailure("bot_provenance_conflict");
    }
    sourceByAccountId.set(sourceAccountId, sourceSystemKey);
    transactionIds.push(normalizeString(record?.transactionId));
    if (sourceByAccountId.size > 1) return invariantFailure("bot_provenance_mixed");
    if (seed || normalizeNonNegativeInt(replacement?.oldStack) === 0) {
      return {
        ok: true,
        sourceAccountId,
        sourceSystemKey,
        fundingTransactionIds: transactionIds
      };
    }
    currentBotUserId = normalizeString(replacement?.oldBotUserId);
    if (!isUuidLike(currentBotUserId)) return invariantFailure("bot_provenance_conflict");
  }
  return invariantFailure("bot_provenance_cycle");
}

export function buildBotCashoutIdempotencyKey({ tableId, toStateVersion, seatNo, botUserId }) {
  return `poker:bot-terminal-cashout:v1:${tableId}:${toStateVersion}:${seatNo}:${botUserId}`;
}

export async function postTerminalBotCashout({
  postTransaction,
  tx,
  tableId,
  toStateVersion,
  botUserId,
  seatNo,
  amount,
  sourceAccountId,
  sourceSystemKey,
  fundingTransactionIds,
  createdBy = null,
  closeReason = "TERMINAL_CLOSE"
}) {
  const normalizedAmount = normalizePositiveInt(amount);
  if (typeof postTransaction !== "function" || !normalizedAmount) throw new Error("terminal_bot_cashout_invalid");
  const idempotencyKey = buildBotCashoutIdempotencyKey({ tableId, toStateVersion, seatNo, botUserId });
  return postTransaction({
    userId: null,
    txType: "TABLE_CASH_OUT",
    idempotencyKey,
    reference: `table:${tableId}`,
    description: "Poker terminal bot cash-out",
    metadata: {
      actor: "BOT",
      reason: "BOT_TERMINAL_CASH_OUT",
      closeReason,
      tableId,
      botUserId,
      seatNo,
      fromStateVersion: toStateVersion - 1,
      toStateVersion,
      sourceSystemAccountId: sourceAccountId,
      sourceSystemKey,
      fundingTransactionIds
    },
    entries: [
      { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -normalizedAmount },
      { accountType: "SYSTEM", systemKey: sourceSystemKey, amount: normalizedAmount }
    ],
    createdBy,
    tx
  });
}

function projectTerminalClaimAmounts({ state, escrowBefore }) {
  const stacks = normalizeJsonObject(state?.stacks);
  if (!stacks) return invariantFailure("terminal_stack_state_invalid");
  const normalizedStacks = new Map();
  let stackTotal = 0;
  for (const [userIdRaw, amountRaw] of Object.entries(stacks)) {
    const userId = normalizeString(userIdRaw);
    const amount = normalizeStateChipAmount(amountRaw);
    if (!userId || amount == null || normalizedStacks.has(userId)) {
      return invariantFailure("terminal_stack_state_invalid");
    }
    normalizedStacks.set(userId, amount);
    stackTotal = addSafe(stackTotal, amount);
    if (stackTotal == null) return invariantFailure("terminal_claims_overflow");
  }

  const phase = normalizeString(state?.phase).toUpperCase();
  const liveActionPhase = LIVE_ACTION_PHASES.has(phase);
  const potPresent = hasOwn(state, "pot");
  const potTotalPresent = hasOwn(state, "potTotal");
  const pot = potPresent ? normalizeStateChipAmount(state.pot) : null;
  const potTotal = potTotalPresent ? normalizeStateChipAmount(state.potTotal) : null;
  if ((potPresent && pot == null) || (potTotalPresent && potTotal == null)) {
    return invariantFailure("terminal_pot_state_invalid");
  }
  if (potPresent && potTotalPresent && pot !== potTotal) {
    return invariantFailure("terminal_pot_state_mismatch");
  }
  if (liveActionPhase && !potPresent && !potTotalPresent) {
    return invariantFailure("terminal_pot_state_invalid");
  }
  const canonicalPotTotal = potTotalPresent ? potTotal : potPresent ? pot : 0;

  if (!liveActionPhase) {
    if (canonicalPotTotal !== 0) return invariantFailure("terminal_unresolved_pot");
    return {
      ok: true,
      claimAmounts: normalizedStacks,
      totalClaims: stackTotal,
      claimPolicy: "final_stacks",
      contributionTotal: 0,
      potTotal: canonicalPotTotal
    };
  }

  const contributions = normalizeJsonObject(state?.contributionsByUserId);
  if (!contributions) return invariantFailure("terminal_contribution_state_invalid");
  const normalizedContributions = new Map();
  let contributionTotal = 0;
  for (const [userIdRaw, amountRaw] of Object.entries(contributions)) {
    const userId = normalizeString(userIdRaw);
    const amount = normalizeStateChipAmount(amountRaw);
    if (!userId || amount == null || normalizedContributions.has(userId)) {
      return invariantFailure("terminal_contribution_state_invalid");
    }
    normalizedContributions.set(userId, amount);
    contributionTotal = addSafe(contributionTotal, amount);
    if (contributionTotal == null) return invariantFailure("terminal_claims_overflow");
  }
  if (contributionTotal !== canonicalPotTotal) {
    return invariantFailure("terminal_contribution_total_mismatch");
  }

  if (hasOwn(state, "sidePots")) {
    if (!Array.isArray(state.sidePots)) return invariantFailure("terminal_side_pot_state_invalid");
    if (state.sidePots.length > 0) {
      let sidePotTotal = 0;
      for (const sidePot of state.sidePots) {
        const amount = normalizeStateChipAmount(sidePot?.amount);
        if (!sidePot || typeof sidePot !== "object" || Array.isArray(sidePot) || amount == null) {
          return invariantFailure("terminal_side_pot_state_invalid");
        }
        sidePotTotal = addSafe(sidePotTotal, amount);
        if (sidePotTotal == null) return invariantFailure("terminal_claims_overflow");
      }
      if (sidePotTotal !== canonicalPotTotal) {
        return invariantFailure("terminal_side_pot_total_mismatch");
      }
    }
  }

  const settledHandId = normalizeString(state?.handSettlement?.handId);
  const handId = normalizeString(state?.handId);
  if (settledHandId && settledHandId !== handId) {
    return invariantFailure("terminal_settlement_hand_mismatch");
  }

  const conservedTotal = addSafe(stackTotal, canonicalPotTotal);
  if (conservedTotal == null) return invariantFailure("terminal_claims_overflow");
  if (conservedTotal !== escrowBefore) {
    return invariantFailure("terminal_claims_mismatch", { totalClaims: conservedTotal });
  }

  const claimUserIds = new Set([...normalizedStacks.keys(), ...normalizedContributions.keys()]);
  const claimAmounts = new Map();
  let totalClaims = 0;
  for (const userId of claimUserIds) {
    const amount = addSafe(normalizedStacks.get(userId) ?? 0, normalizedContributions.get(userId) ?? 0);
    if (amount == null) return invariantFailure("terminal_claims_overflow");
    claimAmounts.set(userId, amount);
    totalClaims = addSafe(totalClaims, amount);
    if (totalClaims == null) return invariantFailure("terminal_claims_overflow");
  }
  return {
    ok: true,
    claimAmounts,
    totalClaims,
    claimPolicy: "live_hand_cancellation_refund",
    contributionTotal,
    potTotal: canonicalPotTotal
  };
}

function classifyClaims({ state, seatRows, escrowBefore }) {
  const projected = projectTerminalClaimAmounts({ state, escrowBefore });
  if (!projected.ok) return projected;
  const seatByUserId = new Map();
  const seatByNo = new Map();
  for (const row of Array.isArray(seatRows) ? seatRows : []) {
    const userId = normalizeString(row?.user_id);
    const seatNo = normalizeSeatNo(row?.seat_no);
    if (!userId || !seatNo || seatByUserId.has(userId) || seatByNo.has(seatNo)) {
      return invariantFailure("terminal_seat_state_invalid");
    }
    seatByUserId.set(userId, row);
    seatByNo.set(seatNo, row);
  }
  const stateSeatByUserId = new Map();
  const stateUserIdBySeatNo = new Map();
  let invalidStateSeat = false;
  for (const stateSeat of Array.isArray(state?.seats) ? state.seats : []) {
    const userId = normalizeString(stateSeat?.userId ?? stateSeat?.user_id);
    const seatNo = normalizeSeatNo(stateSeat?.seatNo ?? stateSeat?.seat_no ?? stateSeat?.seat);
    if (!userId || !seatNo || stateUserIdBySeatNo.has(seatNo) || stateSeatByUserId.has(userId)) {
      invalidStateSeat = true;
      continue;
    }
    stateSeatByUserId.set(userId, seatNo);
    stateUserIdBySeatNo.set(seatNo, userId);
  }
  if (invalidStateSeat) return invariantFailure("terminal_seat_state_invalid");

  const occupiedClaimSeats = new Set();
  const humanClaims = [];
  const botClaims = [];
  for (const [userId, amount] of projected.claimAmounts.entries()) {
    if (amount === 0) continue;
    const directSeat = seatByUserId.get(userId) || null;
    const stateSeatNo = stateSeatByUserId.get(userId) || null;
    if (directSeat?.is_bot === false) {
      const seatNo = normalizeSeatNo(directSeat?.seat_no);
      if (
        !seatNo
        || stateSeatNo !== seatNo
        || stateUserIdBySeatNo.get(seatNo) !== userId
        || occupiedClaimSeats.has(seatNo)
      ) {
        return invariantFailure("terminal_seat_state_invalid");
      }
      occupiedClaimSeats.add(seatNo);
      humanClaims.push({ userId, seatNo, amount });
    } else {
      const seatNo = directSeat?.is_bot === true
        ? normalizeSeatNo(directSeat?.seat_no)
        : stateSeatNo;
      const projectedSeat = seatNo ? seatByNo.get(seatNo) : null;
      if (
        !seatNo
        || projectedSeat?.is_bot !== true
        || stateSeatByUserId.get(userId) !== seatNo
        || stateUserIdBySeatNo.get(seatNo) !== userId
        || occupiedClaimSeats.has(seatNo)
      ) {
        return invariantFailure("bot_identity_ambiguous");
      }
      occupiedClaimSeats.add(seatNo);
      botClaims.push({ botUserId: userId, seatNo, amount });
    }
  }
  return {
    ok: true,
    humanClaims,
    botClaims,
    totalClaims: projected.totalClaims,
    claimPolicy: projected.claimPolicy,
    contributionTotal: projected.contributionTotal,
    potTotal: projected.potTotal
  };
}

async function postTerminalHumanCashout({ postTransaction, tx, tableId, toStateVersion, claim, createdBy, closeReason }) {
  return postTransaction({
    userId: claim.userId,
    txType: "TABLE_CASH_OUT",
    idempotencyKey: `poker:human-terminal-cashout:v1:${tableId}:${toStateVersion}:${claim.seatNo}:${claim.userId}`,
    reference: `table:${tableId}`,
    description: "Poker terminal human cash-out",
    metadata: {
      actor: "HUMAN",
      reason: "HUMAN_TERMINAL_CASH_OUT",
      closeReason,
      tableId,
      seatNo: claim.seatNo,
      fromStateVersion: toStateVersion - 1,
      toStateVersion
    },
    entries: [
      { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -claim.amount },
      { accountType: "USER", amount: claim.amount }
    ],
    createdBy,
    tx
  });
}

export async function executeTerminalPokerCloseInTx({
  tx,
  tableId,
  postTransaction,
  createdBy = null,
  closeReason = "TERMINAL_CLOSE",
  successStatus = "cleaned_closed",
  klog = () => {}
}) {
  const fail = (reason, extra = {}) => {
    const result = invariantFailure(reason, extra);
    klog("poker_terminal_accounting_invariant_failed", {
      tableId,
      reason,
      stateVersion: extra?.stateVersion ?? null,
      escrowBefore: extra?.escrowBefore ?? null,
      totalClaims: extra?.totalClaims ?? null
    });
    return result;
  };
  if (!tx || typeof tx.unsafe !== "function" || typeof postTransaction !== "function") {
    throw new Error("terminal_close_dependencies_invalid");
  }

  const tableRows = await tx.unsafe(
    "select id, status from public.poker_tables where id = $1 limit 1 for update;",
    [tableId]
  );
  const table = tableRows?.[0] || null;
  if (!table) return fail("terminal_table_missing");
  if (normalizeString(table.status).toUpperCase() === "CLOSED") {
    return { ok: true, changed: false, closed: true, status: "already_closed", retryable: false };
  }
  if (normalizeString(table.status).toUpperCase() !== "OPEN") return fail("terminal_table_not_open");

  const stateRows = await tx.unsafe(
    "select version, state from public.poker_state where table_id = $1 limit 1 for update;",
    [tableId]
  );
  const stateRow = stateRows?.[0] || null;
  const stateVersion = normalizeNonNegativeInt(stateRow?.version);
  const state = normalizeJsonObject(stateRow?.state);
  if (stateVersion == null || !state) return fail("terminal_state_missing_or_invalid");
  const toStateVersion = stateVersion + 1;
  if (!Number.isSafeInteger(toStateVersion)) return fail("terminal_state_version_invalid", { stateVersion });

  const seatRows = await tx.unsafe(
    "select user_id, seat_no, status, is_bot, stack from public.poker_seats where table_id = $1 order by seat_no asc for update;",
    [tableId]
  );

  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  const escrowRows = await tx.unsafe(
    "select id, account_type, system_key, status, balance from public.chips_accounts where system_key = $1 limit 1 for update;",
    [escrowSystemKey]
  );
  const escrow = escrowRows?.[0] || null;
  const escrowBefore = normalizeNonNegativeInt(escrow?.balance);
  if (
    !isUuidLike(escrow?.id)
    || normalizeString(escrow?.account_type).toUpperCase() !== "ESCROW"
    || normalizeString(escrow?.system_key) !== escrowSystemKey
    || normalizeString(escrow?.status).toLowerCase() !== "active"
    || escrowBefore == null
  ) {
    return fail("escrow_account_missing_or_invalid", { stateVersion });
  }
  const claims = classifyClaims({ state, seatRows, escrowBefore });
  if (!claims.ok) return fail(claims.reason, {
    stateVersion,
    escrowBefore,
    totalClaims: claims.totalClaims ?? null
  });
  if (claims.totalClaims !== escrowBefore) {
    return fail("terminal_claims_mismatch", { stateVersion, escrowBefore, totalClaims: claims.totalClaims });
  }

  const funding = claims.botClaims.length > 0
    ? await loadBotFundingRows(tx, { tableId, escrowAccountId: escrow.id })
    : { ok: true, records: [] };
  if (!funding.ok) return fail(funding.reason, { stateVersion, escrowBefore, totalClaims: claims.totalClaims });

  const resolvedBotClaims = [];
  for (const claim of claims.botClaims) {
    const resolved = resolveBotFundingSource({ botUserId: claim.botUserId, seatNo: claim.seatNo, rows: funding.records });
    if (!resolved.ok) return fail(resolved.reason, { stateVersion, escrowBefore, totalClaims: claims.totalClaims });
    resolvedBotClaims.push({ ...claim, ...resolved });
  }

  const sourceAccountIds = [...new Set(resolvedBotClaims.map((claim) => claim.sourceAccountId))];
  if (sourceAccountIds.length > 0) {
    const sourceRows = await tx.unsafe(
      "select id, account_type, system_key, status from public.chips_accounts where id = any($1::uuid[]) order by id asc for update;",
      [sourceAccountIds]
    );
    const sourceById = new Map((Array.isArray(sourceRows) ? sourceRows : []).map((row) => [normalizeString(row?.id), row]));
    for (const claim of resolvedBotClaims) {
      const source = sourceById.get(claim.sourceAccountId) || null;
      if (
        normalizeString(source?.account_type).toUpperCase() !== "SYSTEM"
        || normalizeString(source?.system_key) !== claim.sourceSystemKey
        || normalizeString(source?.status).toLowerCase() !== "active"
      ) {
        return fail("source_system_missing_or_inactive", { stateVersion, escrowBefore, totalClaims: claims.totalClaims });
      }
    }
  }

  for (const claim of claims.humanClaims) {
    await postTerminalHumanCashout({ postTransaction, tx, tableId, toStateVersion, claim, createdBy, closeReason });
  }
  for (const claim of resolvedBotClaims) {
    await postTerminalBotCashout({
      postTransaction,
      tx,
      tableId,
      toStateVersion,
      botUserId: claim.botUserId,
      seatNo: claim.seatNo,
      amount: claim.amount,
      sourceAccountId: claim.sourceAccountId,
      sourceSystemKey: claim.sourceSystemKey,
      fundingTransactionIds: claim.fundingTransactionIds,
      createdBy,
      closeReason
    });
  }

  const finalEscrowRows = await tx.unsafe(
    "select balance from public.chips_accounts where id = $1 limit 1 for update;",
    [escrow.id]
  );
  if (normalizeNonNegativeInt(finalEscrowRows?.[0]?.balance) !== 0) {
    const error = new Error("terminal_escrow_not_zero");
    error.code = TERMINAL_ACCOUNTING_ERROR;
    throw error;
  }

  const stateUpdateRows = await tx.unsafe(
    "update public.poker_state set version = version + 1, state = $3::jsonb, updated_at = now() where table_id = $1 and version = $2 returning version;",
    [tableId, stateVersion, JSON.stringify(toClosedInertState(state))]
  );
  if (Number(stateUpdateRows?.[0]?.version) !== toStateVersion) {
    const error = new Error("terminal_state_conflict");
    error.code = "state_conflict";
    throw error;
  }
  await tx.unsafe(
    "update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1;",
    [tableId]
  );
  const closeRows = await tx.unsafe(
    "update public.poker_tables set status = 'CLOSED', updated_at = now(), last_activity_at = now() where id = $1 and status = 'OPEN' returning id;",
    [tableId]
  );
  if (!closeRows?.[0]?.id) {
    const error = new Error("terminal_table_conflict");
    error.code = "state_conflict";
    throw error;
  }

  const result = {
    ok: true,
    changed: true,
    closed: true,
    status: successStatus,
    retryable: false,
    stateVersion: toStateVersion,
    escrowBefore,
    claimPolicy: claims.claimPolicy,
    contributionTotal: claims.contributionTotal,
    potTotal: claims.potTotal,
    humanSeatCount: claims.humanClaims.length,
    botSeatCount: claims.botClaims.length
  };
  klog("poker_terminal_accounting_closed", {
    tableId,
    stateVersion: toStateVersion,
    escrowBefore,
    claimPolicy: result.claimPolicy,
    contributionTotal: result.contributionTotal,
    potTotal: result.potTotal,
    humanSeatCount: result.humanSeatCount,
    botSeatCount: result.botSeatCount
  });
  return result;
}

export { TERMINAL_ACCOUNTING_ERROR };
