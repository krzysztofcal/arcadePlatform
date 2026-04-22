import { asSeatSnapshot, computeTargetBotCount, getBotConfig, loadSeatRows, seedBotsForJoin, shouldSeedBotsOnJoin } from "./bots.mjs";

const BUY_IN_IDEMPOTENCY_CONSTRAINT = "chips_transactions_idempotency_key_unique";

async function resolvePostTransactionFn(postTransactionFn) {
  if (typeof postTransactionFn === "function") return postTransactionFn;
  const ledgerModule = await import("../../netlify/functions/_shared/chips-ledger.mjs");
  if (typeof ledgerModule?.postTransaction !== "function") {
    throw makeError("temporarily_unavailable");
  }
  return ledgerModule.postTransaction;
}

function parseStateValue(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw makeError("state_invalid");
      }
      return parsed;
    } catch {
      throw makeError("state_invalid");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw makeError("state_invalid");
  }
  return value;
}

function normalizeCardCodeForValidation(cardCode) {
  if (typeof cardCode !== "string") return null;
  const code = cardCode.trim().toUpperCase();
  if (!/^(10|[2-9TJQKA])[CDHS]$/.test(code)) return null;
  const suit = code.slice(-1);
  const rankCode = code.slice(0, -1);
  const rank = rankCode === "A"
    ? 14
    : rankCode === "K"
      ? 13
      : rankCode === "Q"
        ? 12
        : rankCode === "J"
          ? 11
          : rankCode === "T"
            ? 10
            : Number(rankCode);
  if (!Number.isInteger(rank) || rank < 2 || rank > 14) return null;
  return { r: rank, s: suit };
}

function normalizeCardArrayForValidation(cardsInput) {
  if (!Array.isArray(cardsInput)) {
    return cardsInput;
  }
  const normalizedCards = cardsInput.map((card) =>
    typeof card === "string" ? normalizeCardCodeForValidation(card) : card
  );
  if (normalizedCards.some((card) => !card)) {
    return cardsInput;
  }
  return normalizedCards;
}

function sanitizeStateForStorage(stateInput) {
  if (!stateInput || typeof stateInput !== "object" || Array.isArray(stateInput)) {
    return stateInput;
  }
  const { deck: _ignoredDeck, holeCardsByUserId: _ignoredHoleCards, ...stateBase } = stateInput;
  return stateBase;
}

function normalizeStateForStorageValidation(stateInput) {
  const sanitizedState = sanitizeStateForStorage(stateInput);
  if (!sanitizedState || typeof sanitizedState !== "object" || Array.isArray(sanitizedState)) {
    return sanitizedState;
  }
  const normalizedCommunity = normalizeCardArrayForValidation(sanitizedState.community);
  if (normalizedCommunity === sanitizedState.community) {
    return sanitizedState;
  }
  return { ...sanitizedState, community: normalizedCommunity };
}

function isStorageStateValid(validateStateForStorage, state) {
  return validateStateForStorage(normalizeStateForStorageValidation(state));
}

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isSeatConflictError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "seat_taken") return true;
  if (code === "23505") {
    const constraint = String(error?.constraint || "").toLowerCase();
    const detail = String(error?.detail || "").toLowerCase();
    if (constraint.includes("seat_no") || constraint.includes("user_id")) return true;
    if (detail.includes("seat_no") || detail.includes("user_id")) return true;
  }
  return false;
}

function normalizePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isBuyInIdempotencyDuplicate(error) {
  if (String(error?.code || "") !== "23505") return false;
  const constraint = String(error?.constraint || "");
  const message = String(error?.message || "");
  return constraint === BUY_IN_IDEMPOTENCY_CONSTRAINT || message.includes(BUY_IN_IDEMPOTENCY_CONSTRAINT);
}

function normalizeLockedStateResult(result) {
  if (!result?.ok) {
    if (result?.reason === "not_found") throw makeError("state_missing");
    throw makeError("state_invalid");
  }
  return {
    version: Number.isInteger(Number(result.version)) ? Number(result.version) : 0,
    state: parseStateValue(result.state)
  };
}

function writeLockedStateResult(result) {
  if (!result?.ok) {
    if (result?.reason === "not_found") throw makeError("state_missing");
    throw makeError("state_invalid");
  }
  const version = Number(result.newVersion);
  if (!Number.isInteger(version) || version <= 0) {
    throw makeError("authoritative_state_invalid");
  }
  return { version };
}

function requirePostMutationVersion({ previousVersion, nextVersion }) {
  if (!Number.isInteger(nextVersion) || nextVersion <= 0) {
    throw makeError("authoritative_state_invalid");
  }
  if (Number.isInteger(previousVersion) && nextVersion <= previousVersion) {
    throw makeError("authoritative_state_invalid");
  }
  return nextVersion;
}

function stateAlreadyRepresentsActiveSeatRows(state, seatRows, userId) {
  const stateSeats = Array.isArray(state?.seats) ? state.seats : [];
  const activeSeatRows = Array.isArray(seatRows)
    ? seatRows.filter((row) => String(row?.status || "ACTIVE").toUpperCase() === "ACTIVE")
    : [];
  const currentStacks = state?.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks)
    ? state.stacks
    : {};

  if (!Object.prototype.hasOwnProperty.call(currentStacks, userId)) {
    return false;
  }

  const stateSeatKeySet = new Set(
    stateSeats
      .map((seat) => {
        const seatUserId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
        const seatNo = Number(seat?.seatNo);
        return seatUserId && Number.isInteger(seatNo) && seatNo >= 1 ? `${seatUserId}:${seatNo}` : null;
      })
      .filter(Boolean)
  );

  return activeSeatRows.every((row) => {
    const seatUserId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
    const seatNo = Number(row?.seat_no);
    return seatUserId
      && Number.isInteger(seatNo)
      && seatNo >= 1
      && stateSeatKeySet.has(`${seatUserId}:${seatNo}`)
      && Number.isInteger(Number(currentStacks[seatUserId]))
      && Number(currentStacks[seatUserId]) > 0;
  });
}

function activeSeatRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => String(row?.status || "ACTIVE").toUpperCase() === "ACTIVE")
    : [];
}

function normalizeProjectionSeatNo(value, maxPlayers = Number.MAX_SAFE_INTEGER) {
  const seatNo = Number(value);
  return Number.isInteger(seatNo) && seatNo >= 1 && seatNo <= maxPlayers ? seatNo : null;
}

function normalizeProjectionSeatRows(seatRows, maxPlayers) {
  if (!Array.isArray(seatRows)) {
    return [];
  }
  const normalized = [];
  const seenSeatNos = new Set();
  const seenUserIds = new Set();
  for (const row of seatRows) {
    if (String(row?.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    const seatNo = normalizeProjectionSeatNo(row?.seat_no, maxPlayers);
    const userId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
    if (!seatNo || !userId || seenSeatNos.has(seatNo) || seenUserIds.has(userId)) {
      continue;
    }
    seenSeatNos.add(seatNo);
    seenUserIds.add(userId);
    normalized.push({
      seat: seatNo,
      userId,
      isBot: row?.is_bot === true,
      ...(typeof row?.bot_profile === "string" && row.bot_profile.trim() ? { botProfile: row.bot_profile.trim() } : {}),
      ...(row?.leave_after_hand === true ? { leaveAfterHand: true } : {}),
      ...(Number.isFinite(Number(row?.stack)) && Number(row.stack) >= 0 ? { stack: Number(row.stack) } : {})
    });
  }
  normalized.sort((left, right) => left.seat - right.seat || left.userId.localeCompare(right.userId));
  return normalized;
}

function mergeProjectionSeatMetadata(seat, metadata) {
  const merged = { ...seat };
  if (metadata?.isBot === true) merged.isBot = true;
  if (!merged.botProfile && metadata?.botProfile) merged.botProfile = metadata.botProfile;
  if (metadata?.leaveAfterHand === true || merged.leaveAfterHand === true) merged.leaveAfterHand = true;
  if (!Number.isFinite(Number(merged.stack)) && Number.isFinite(Number(metadata?.stack))) merged.stack = Number(metadata.stack);
  return merged;
}

function mergeProjectionStateSeatsWithSeatRows(pokerState, normalizedSeatRows) {
  const stateSeats = Array.isArray(pokerState?.seats) ? pokerState.seats : [];
  const seatRows = Array.isArray(normalizedSeatRows) ? normalizedSeatRows : [];
  const metadataByUserId = new Map(seatRows.map((seat) => [seat.userId, seat]));
  const metadataBySeatNo = new Map(seatRows.map((seat) => [seat.seat, seat]));
  const leftTableByUserId = pokerState?.leftTableByUserId && typeof pokerState.leftTableByUserId === "object" && !Array.isArray(pokerState.leftTableByUserId)
    ? pokerState.leftTableByUserId
    : {};
  const replacementSeatNos = new Set();
  const mergedStateSeats = Array.isArray(stateSeats)
    ? stateSeats
        .map((seat) => {
          const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
          const seatNo = normalizeProjectionSeatNo(seat?.seatNo ?? seat?.seat_no ?? seat?.seat);
          if (!userId || !seatNo) {
            return null;
          }
          const directMetadata = metadataByUserId.get(userId) || null;
          const sameSeatMetadata = metadataBySeatNo.get(seatNo) || null;
          const replacementBotMetadata = !directMetadata && sameSeatMetadata?.isBot === true ? sameSeatMetadata : null;
          if (!directMetadata && !replacementBotMetadata && leftTableByUserId[userId] !== true) {
            return null;
          }
          if (replacementBotMetadata) replacementSeatNos.add(seatNo);
          return mergeProjectionSeatMetadata({
            userId,
            seat: seatNo,
            ...(seat?.isBot === true ? { isBot: true } : {}),
            ...(typeof seat?.botProfile === "string" && seat.botProfile ? { botProfile: seat.botProfile } : {}),
            ...(seat?.leaveAfterHand === true ? { leaveAfterHand: true } : {}),
            ...(Number.isFinite(Number(seat?.stack)) ? { stack: Number(seat.stack) } : {})
          }, directMetadata || replacementBotMetadata);
        })
        .filter(Boolean)
    : [];

  return {
    stateSeats: mergedStateSeats.length > 0 ? mergedStateSeats : seatRows.map((seat) => ({ ...seat })),
    replacementSeatNos,
    leftTableByUserId
  };
}

function buildProjectionRuntimeSeats({ seatRows, stateSeats, replacementSeatNos, leftTableByUserId }) {
  const runtimeSeats = [];
  const seenUserIds = new Set();
  const seenSeatNos = new Set();
  const metadataByUserId = new Map((seatRows || []).map((seat) => [seat.userId, seat]));
  const metadataBySeatNo = new Map((seatRows || []).map((seat) => [seat.seat, seat]));

  for (const stateSeat of stateSeats || []) {
    const userId = typeof stateSeat?.userId === "string" ? stateSeat.userId.trim() : "";
    const seatNo = normalizeProjectionSeatNo(stateSeat?.seatNo ?? stateSeat?.seat_no ?? stateSeat?.seat);
    if (!userId || !seatNo || leftTableByUserId?.[userId] === true) {
      continue;
    }
    const seatMetadata = metadataByUserId.get(userId) || metadataBySeatNo.get(seatNo) || null;
    const isReplacementSeat = replacementSeatNos?.has(seatNo) === true && !metadataByUserId.has(userId);
    runtimeSeats.push({
      userId,
      seat: seatNo,
      isBot: stateSeat?.isBot === true || seatMetadata?.isBot === true,
      ...(typeof stateSeat?.botProfile === "string" && stateSeat.botProfile ? { botProfile: stateSeat.botProfile } : seatMetadata?.botProfile ? { botProfile: seatMetadata.botProfile } : {}),
      ...(stateSeat?.leaveAfterHand === true || seatMetadata?.leaveAfterHand === true ? { leaveAfterHand: true } : {}),
      ...(isReplacementSeat ? { preferStatePublicStack: true } : {}),
      ...(Number.isFinite(Number(stateSeat?.stack))
        ? { stack: Number(stateSeat.stack) }
        : Number.isFinite(Number(seatMetadata?.stack))
          ? { stack: Number(seatMetadata.stack) }
          : {})
    });
    seenUserIds.add(userId);
    seenSeatNos.add(seatNo);
  }

  for (const seat of seatRows || []) {
    if (replacementSeatNos?.has(seat.seat)) continue;
    if (seenUserIds.has(seat.userId) || seenSeatNos.has(seat.seat)) continue;
    runtimeSeats.push({ ...seat });
  }

  runtimeSeats.sort((left, right) => left.seat - right.seat || left.userId.localeCompare(right.userId));
  return runtimeSeats;
}

function projectEffectiveRuntimeSeats({ state, seatRows, maxPlayers }) {
  const normalizedSeatRows = normalizeProjectionSeatRows(seatRows, maxPlayers);
  const { stateSeats, replacementSeatNos, leftTableByUserId } = mergeProjectionStateSeatsWithSeatRows(state, normalizedSeatRows);
  const runtimeSeats = buildProjectionRuntimeSeats({
    seatRows: normalizedSeatRows,
    stateSeats,
    replacementSeatNos,
    leftTableByUserId
  });
  return { runtimeSeats };
}

function runtimeSeatEntries(runtimeSeats) {
  return (Array.isArray(runtimeSeats) ? runtimeSeats : [])
    .map((seat) => asSeatSnapshot({
      user_id: seat.userId,
      seat_no: seat.seat,
      status: "ACTIVE",
      is_bot: seat.isBot === true,
      bot_profile: seat.botProfile || null,
      leave_after_hand: seat.leaveAfterHand === true
    }))
    .filter(Boolean);
}

function runtimeStackEntries(runtimeSeats) {
  return (Array.isArray(runtimeSeats) ? runtimeSeats : [])
    .map((seat) => {
      const stack = Number(seat?.stack);
      return typeof seat?.userId === "string" && seat.userId && Number.isInteger(stack) && stack > 0
        ? [seat.userId, stack]
        : null;
    })
    .filter(Boolean);
}

function applyAuthoritativeSeatRowsToState(state, { tableId, seatEntries = [], stackEntries = [] } = {}) {
  const currentState = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const incomingSeats = (Array.isArray(seatEntries) ? seatEntries : []).map(asSeatSnapshot).filter(Boolean);
  const incomingUserIds = new Set(incomingSeats.map((seat) => seat.userId));
  const incomingSeatNos = new Set(incomingSeats.map((seat) => seat.seatNo));
  const currentSeats = (Array.isArray(currentState.seats) ? currentState.seats : []).map(asSeatSnapshot).filter(Boolean);
  const removedUserIds = new Set();
  const preservedSeats = currentSeats.filter((seat) => {
    const conflict = incomingUserIds.has(seat.userId) || incomingSeatNos.has(seat.seatNo);
    if (conflict) removedUserIds.add(seat.userId);
    return !conflict;
  });
  const stacks = currentState.stacks && typeof currentState.stacks === "object" && !Array.isArray(currentState.stacks)
    ? { ...currentState.stacks }
    : {};
  for (const removedUserId of removedUserIds) {
    delete stacks[removedUserId];
  }
  for (const entry of Array.isArray(stackEntries) ? stackEntries : []) {
    const userId = typeof entry?.[0] === "string" ? entry[0] : "";
    const stack = Number(entry?.[1]);
    if (!userId || !Number.isInteger(stack) || stack < 0) continue;
    stacks[userId] = stack;
  }
  return {
    ...currentState,
    tableId: currentState.tableId || tableId,
    seats: [...preservedSeats, ...incomingSeats].sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId)),
    stacks
  };
}

function buildProjectedSnapshot({ state, seatRows, maxPlayers, stateVersion }) {
  const { runtimeSeats } = projectEffectiveRuntimeSeats({ state, seatRows, maxPlayers });
  const stateStacks = state?.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks)
    ? state.stacks
    : {};
  const stacks = Object.fromEntries(runtimeSeats.map((seat) => {
    const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
    const stateStack = Number(stateStacks[userId]);
    const seatStack = Number(seat?.stack);
    const stack = seat?.preferStatePublicStack === true && Number.isFinite(stateStack) && stateStack >= 0
      ? stateStack
      : seatStack;
    return userId && Number.isFinite(stack) ? [userId, stack] : null;
  }).filter(Boolean));
  return {
    stateVersion,
    seats: runtimeSeatEntries(runtimeSeats),
    stacks
  };
}

function activeStackEntries(rows) {
  return activeSeatRows(rows)
    .map((row) => {
      const rowUserId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
      const rowStack = Number(row?.stack);
      return rowUserId && Number.isInteger(rowStack) && rowStack > 0 ? [rowUserId, rowStack] : null;
    })
    .filter(Boolean);
}

function assertAuthoritativeJoinStateComplete({ seatRows, state, version, userId, seatNo, stack, maxPlayers, botCfg }) {
  const persistedSeatKeys = new Set(
    activeSeatRows(seatRows)
      .map((row) => {
        const rowUserId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
        const rowSeatNo = Number(row?.seat_no);
        return rowUserId && Number.isInteger(rowSeatNo) && rowSeatNo >= 1 ? `${rowUserId}:${rowSeatNo}` : null;
      })
      .filter(Boolean)
  );
  const stateSeatKeys = new Set(
    (Array.isArray(state?.seats) ? state.seats : [])
      .map((entry) => {
        const entryUserId = typeof entry?.userId === "string" ? entry.userId.trim() : "";
        const entrySeatNo = Number(entry?.seatNo);
        return entryUserId && Number.isInteger(entrySeatNo) && entrySeatNo >= 1 ? `${entryUserId}:${entrySeatNo}` : null;
      })
      .filter(Boolean)
  );
  const stateStacks = state?.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks) ? state.stacks : {};

  if (!Number.isInteger(version) || version <= 0) throw makeError("authoritative_state_invalid");
  if (!persistedSeatKeys.has(`${userId}:${seatNo}`) || Number(stateStacks[userId]) !== Number(stack)) {
    throw makeError("authoritative_state_invalid");
  }
  for (const persistedSeatKey of persistedSeatKeys) {
    if (!stateSeatKeys.has(persistedSeatKey)) throw makeError("authoritative_state_invalid");
  }
  for (const [stackUserId, persistedStack] of activeStackEntries(seatRows)) {
    if (Number(stateStacks[stackUserId]) !== persistedStack) throw makeError("authoritative_state_invalid");
  }

  const activeRows = activeSeatRows(seatRows);
  const humanCount = activeRows.filter((row) => !row?.is_bot).length;
  const expectedBotCount = botCfg?.enabled && shouldSeedBotsOnJoin({ humanCount })
    ? computeTargetBotCount({ maxPlayers, humanCount, maxBots: botCfg.maxPerTable })
    : 0;
  const activeBotCount = activeRows.filter((row) => row?.is_bot).length;
  if (activeBotCount < expectedBotCount) throw makeError("authoritative_state_invalid");
}

async function syncStateSeatAndStack({ tx, tableId, userId, seatNo, stack, loadStateForUpdate, updateStateLocked, validateStateForStorage, maxPlayers, botCfg }) {
  const stateRow = normalizeLockedStateResult(await loadStateForUpdate(tx, tableId));
  const seatRows = await loadSeatRows(tx, tableId);
  const nextState = applyAuthoritativeSeatRowsToState(stateRow.state, {
    tableId,
    seatEntries: activeSeatRows(seatRows).map(asSeatSnapshot).filter(Boolean),
    stackEntries: activeStackEntries(seatRows)
  });
  const nextStateForStorage = sanitizeStateForStorage(nextState);
  if (!isStorageStateValid(validateStateForStorage, nextStateForStorage)) {
    throw makeError("state_invalid");
  }
  const updated = writeLockedStateResult(await updateStateLocked(tx, { tableId, nextState: nextStateForStorage }));
  const version = requirePostMutationVersion({ previousVersion: stateRow.version, nextVersion: updated.version });
  assertAuthoritativeJoinStateComplete({ seatRows, state: nextStateForStorage, version, userId, seatNo, stack, maxPlayers, botCfg });
  return { version, state: nextStateForStorage, seatRows };
}

async function readPersistedSeatStack({ tx, tableId, userId }) {
  const rows = await tx.unsafe(
    "select seat_no, stack from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
    [tableId, userId]
  );
  const seatNo = Number(rows?.[0]?.seat_no);
  const stack = Number(rows?.[0]?.stack);
  if (!Number.isInteger(seatNo) || seatNo < 1 || !Number.isInteger(stack) || stack <= 0) {
    throw makeError("state_invalid");
  }
  return { seatNo, stack };
}

async function insertSeatRow({ tx, tableId, userId, seatNo }) {
  try {
    return await tx.unsafe(
      "insert into public.poker_seats (table_id, user_id, seat_no, status, last_seen_at, joined_at, stack) values ($1, $2, $3, 'ACTIVE', now(), now(), 0) on conflict do nothing returning seat_no;",
      [tableId, userId, seatNo]
    );
  } catch (error) {
    if (!isSeatConflictError(error)) {
      throw error;
    }
    return [];
  }
}

export async function executePokerJoinAuthoritative({ beginSql, tableId, userId, requestId, seatNo = null, autoSeat = false, preferredSeatNo = null, buyIn = null, klog = () => {}, postTransactionFn = null, loadStateForUpdate, updateStateLocked, validateStateForStorage }) {
  if (typeof loadStateForUpdate !== "function" || typeof updateStateLocked !== "function" || typeof validateStateForStorage !== "function") {
    throw makeError("temporarily_unavailable");
  }
  const runPostTransaction = await resolvePostTransactionFn(postTransactionFn);
  klog("shared_join_start", { tableId, userId, seatNo, autoSeat: autoSeat === true, preferredSeatNo, buyIn });
  return beginSql(async (tx) => {
    try {
      const resolvedBuyIn = normalizePositiveInt(buyIn);
      if (!resolvedBuyIn) throw makeError("invalid_buy_in");

      const tableRows = await tx.unsafe(
        "select id, status, max_players, stakes from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) throw makeError("table_not_found");
      const maxPlayers = Number(table.max_players);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 1) throw makeError("table_not_open");

      const stateRow = normalizeLockedStateResult(await loadStateForUpdate(tx, tableId));
      const seatRows = await loadSeatRows(tx, tableId);

      const existingSeatNo = Number(
        activeSeatRows(seatRows).find((row) => {
          const rowUserId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
          return rowUserId === userId;
        })?.seat_no
      );
      if (Number.isInteger(existingSeatNo) && existingSeatNo >= 1) {
        if (String(table.status || "").toUpperCase() === "CLOSED") throw makeError("table_closed");
        await tx.unsafe(
          "update public.poker_seats set status = 'ACTIVE', last_seen_at = now() where table_id = $1 and user_id = $2;",
          [tableId, userId]
        );
        const persisted = await readPersistedSeatStack({ tx, tableId, userId });
        if (stateAlreadyRepresentsActiveSeatRows(stateRow.state, seatRows, userId)) {
          if (!Number.isInteger(stateRow.version) || stateRow.version <= 0) {
            throw makeError("authoritative_state_invalid");
          }
          await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
          klog("shared_join_success", { seatNo: persisted.seatNo, stack: persisted.stack, snapshotVersion: stateRow.version });
          return {
            ok: true,
            tableId,
            userId,
            seatNo: persisted.seatNo,
            stack: persisted.stack,
            rejoin: true,
            requestId: requestId || null,
            me: { seated: true },
            snapshot: buildProjectedSnapshot({
              state: stateRow.state,
              seatRows,
              maxPlayers,
              stateVersion: stateRow.version
            })
          };
        }
        const nextState = applyAuthoritativeSeatRowsToState(stateRow.state, {
          tableId,
          seatEntries: seatRows.map(asSeatSnapshot).filter(Boolean),
          stackEntries: activeStackEntries(seatRows)
        });
        const nextStateForStorage = sanitizeStateForStorage(nextState);
        if (!isStorageStateValid(validateStateForStorage, nextStateForStorage)) {
          throw makeError("state_invalid");
        }
        const updatedState = writeLockedStateResult(await updateStateLocked(tx, { tableId, nextState: nextStateForStorage }));
        const snapshotVersion = requirePostMutationVersion({ previousVersion: stateRow.version, nextVersion: updatedState.version });
        klog("shared_join_state_written", { previousVersion: stateRow.version, newVersion: snapshotVersion });
        await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
        klog("shared_join_success", { seatNo: persisted.seatNo, stack: persisted.stack, snapshotVersion });
        return {
          ok: true,
          tableId,
          userId,
          seatNo: persisted.seatNo,
          stack: persisted.stack,
          rejoin: true,
          requestId: requestId || null,
          me: { seated: true },
          snapshot: buildProjectedSnapshot({
            state: nextStateForStorage,
            seatRows,
            maxPlayers,
            stateVersion: snapshotVersion
          })
        };
      }

      const status = String(table.status || "").toUpperCase();
      if (status === "CLOSED") throw makeError("table_closed");
      if (status && status !== "OPEN") throw makeError("table_not_open");

      const occupied = new Set(activeSeatRows(seatRows).map((row) => Number(row?.seat_no)).filter((n) => Number.isInteger(n) && n >= 1));
    const requestedSeatNo = seatNo === null || seatNo === undefined ? null : (Number.isInteger(Number(seatNo)) ? Number(seatNo) : null);
    const preferredSeatNoRequested = preferredSeatNo === null || preferredSeatNo === undefined ? null : (Number.isInteger(Number(preferredSeatNo)) ? Number(preferredSeatNo) : null);

    if (requestedSeatNo !== null && requestedSeatNo < 1) throw makeError("invalid_seat_no");
    if (preferredSeatNoRequested !== null && preferredSeatNoRequested < 1) throw makeError("invalid_seat_no");

    const startSeat = Number.isInteger(preferredSeatNoRequested) && preferredSeatNoRequested >= 1 && preferredSeatNoRequested <= maxPlayers ? preferredSeatNoRequested : 1;
    const nextAutoSeatCandidate = () => {
      for (let offset = 0; offset < maxPlayers; offset += 1) {
        const candidate = ((startSeat - 1 + offset) % maxPlayers) + 1;
        if (!occupied.has(candidate)) {
          return candidate;
        }
      }
      return null;
    };

    let resolvedSeatNo = null;
    if (requestedSeatNo !== null && !autoSeat) {
      if (requestedSeatNo < 1 || requestedSeatNo > maxPlayers) throw makeError("invalid_seat_no");
      if (occupied.has(requestedSeatNo)) throw makeError("seat_taken");
      resolvedSeatNo = requestedSeatNo;
    }

    if (!Number.isInteger(resolvedSeatNo)) {
      resolvedSeatNo = nextAutoSeatCandidate();
    }

    if (!Number.isInteger(resolvedSeatNo)) throw makeError("table_full");
    klog("shared_join_seat_selected", { seatNo: resolvedSeatNo, occupiedCount: occupied.size });

    while (true) {
      const insertedRows = await insertSeatRow({
        tx,
        tableId,
        userId,
        seatNo: resolvedSeatNo
      });
      const insertedSeatNo = Number(insertedRows?.[0]?.seat_no);
      if (Number.isInteger(insertedSeatNo) && insertedSeatNo >= 1) {
        break;
      }
      if (requestedSeatNo !== null && !autoSeat) throw makeError("seat_taken");
      occupied.add(resolvedSeatNo);
      const retrySeatNo = nextAutoSeatCandidate();
      if (!Number.isInteger(retrySeatNo)) throw makeError("table_full");
      resolvedSeatNo = retrySeatNo;
      klog("shared_join_seat_retry", { seatNo: resolvedSeatNo, occupiedCount: occupied.size });
    }

    const escrowSystemKey = `POKER_TABLE:${tableId}`;
    const idempotencyKey = requestId
      ? `join-buyin:${tableId}:${userId}:${requestId}`
      : `join-buyin:${tableId}:${userId}:${resolvedSeatNo}:${resolvedBuyIn}`;

      let buyInDuplicated = false;
      klog("shared_join_ledger_start", { buyIn: resolvedBuyIn });
      try {
        await runPostTransaction({
        userId,
        txType: "TABLE_BUY_IN",
        idempotencyKey,
        entries: [
          { accountType: "USER", amount: -resolvedBuyIn },
          { accountType: "ESCROW", systemKey: escrowSystemKey, amount: resolvedBuyIn }
        ],
        createdBy: userId,
        tx
        });
      } catch (error) {
        if (!isBuyInIdempotencyDuplicate(error)) throw error;
        buyInDuplicated = true;
        klog("ws_join_authoritative_buyin_duplicate_idempotency", { tableId, userId, idempotencyKey });
      }
      klog("shared_join_ledger_result", { ok: true });

      let fundedStack = resolvedBuyIn;
      if (buyInDuplicated) {
        const persisted = await readPersistedSeatStack({ tx, tableId, userId });
        if (persisted.seatNo !== resolvedSeatNo) {
          throw makeError("state_invalid");
        }
        fundedStack = persisted.stack;
      } else {
        await tx.unsafe(
          "update public.poker_seats set stack = $4 where table_id = $1 and user_id = $2 and seat_no = $3;",
          [tableId, userId, resolvedSeatNo, resolvedBuyIn]
        );
      }
      klog("shared_join_stack_updated", { userId, stack: fundedStack });

      const botCfg = getBotConfig(process.env);
      const seededBots = await seedBotsForJoin({
      tx,
      tableId,
      maxPlayers,
      tableStakes: table.stakes,
      cfg: botCfg,
      humanUserId: userId,
      postTransaction: runPostTransaction,
      klog
      });
      klog("shared_join_bots_seeded", {
        botCount: Array.isArray(seededBots) ? seededBots.length : 0,
        botSeats: Array.isArray(seededBots) ? seededBots.map((bot) => Number(bot?.seatNo)).filter((botSeatNo) => Number.isInteger(botSeatNo) && botSeatNo >= 1) : []
      });
      const updatedStateRow = await syncStateSeatAndStack({
      tx,
      tableId,
      userId,
      seatNo: resolvedSeatNo,
      stack: fundedStack,
      loadStateForUpdate,
      updateStateLocked,
      validateStateForStorage,
      maxPlayers,
      botCfg
      });
      klog("shared_join_state_written", { previousVersion: null, newVersion: updatedStateRow.version });
      await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
      klog("ws_join_authoritative_persisted", { tableId, userId, seatNo: resolvedSeatNo, autoSeat: autoSeat === true, preferredSeatNo: preferredSeatNoRequested, buyIn: resolvedBuyIn, fundedStack });
      klog("shared_join_success", { seatNo: resolvedSeatNo, stack: fundedStack, snapshotVersion: updatedStateRow.version });
      return {
        ok: true,
        tableId,
        userId,
        seatNo: resolvedSeatNo,
        stack: fundedStack,
        rejoin: false,
        requestId: requestId || null,
        me: { seated: true },
        seededBots,
        snapshot: buildProjectedSnapshot({
          state: updatedStateRow.state,
          seatRows: updatedStateRow.seatRows,
          maxPlayers,
          stateVersion: updatedStateRow.version
        })
      };
    } catch (error) {
      klog("shared_join_error", {
        code: typeof error?.code === "string" ? error.code : "authoritative_join_failed",
        message: error?.message || "unknown"
      });
      throw error;
    }
  });
}
