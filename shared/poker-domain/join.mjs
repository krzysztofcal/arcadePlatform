import { applySeatsAndStacksToState, asSeatSnapshot, computeTargetBotCount, getBotConfig, loadSeatRows, seedBotsForJoin, shouldSeedBotsOnJoin } from "./bots.mjs";

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
  const nextState = applySeatsAndStacksToState(stateRow.state, {
    tableId,
    seatEntries: activeSeatRows(seatRows).map(asSeatSnapshot).filter(Boolean),
    stackEntries: activeStackEntries(seatRows)
  });
  if (!validateStateForStorage(nextState)) {
    throw makeError("state_invalid");
  }
  const updated = writeLockedStateResult(await updateStateLocked(tx, { tableId, nextState }));
  const version = requirePostMutationVersion({ previousVersion: stateRow.version, nextVersion: updated.version });
  assertAuthoritativeJoinStateComplete({ seatRows, state: nextState, version, userId, seatNo, stack, maxPlayers, botCfg });
  return { version, state: nextState };
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

      const existingRows = await tx.unsafe(
        "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
        [tableId, userId]
      );
      const existingSeatNo = Number(existingRows?.[0]?.seat_no);
      if (Number.isInteger(existingSeatNo) && existingSeatNo >= 1) {
        if (String(table.status || "").toUpperCase() === "CLOSED") throw makeError("table_closed");
        await tx.unsafe(
          "update public.poker_seats set status = 'ACTIVE', last_seen_at = now() where table_id = $1 and user_id = $2;",
          [tableId, userId]
        );
        const persisted = await readPersistedSeatStack({ tx, tableId, userId });
        const stateRow = normalizeLockedStateResult(await loadStateForUpdate(tx, tableId));
        const seatRows = await loadSeatRows(tx, tableId);
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
            snapshot: {
              stateVersion: stateRow.version,
              seats: Array.isArray(stateRow.state?.seats) ? stateRow.state.seats : [],
              stacks: stateRow.state?.stacks && typeof stateRow.state.stacks === "object" ? stateRow.state.stacks : {}
            }
          };
        }
        const nextState = applySeatsAndStacksToState(stateRow.state, {
          tableId,
          seatEntries: seatRows.map(asSeatSnapshot).filter(Boolean),
          stackEntries: activeStackEntries(seatRows)
        });
        if (!validateStateForStorage(nextState)) {
          throw makeError("state_invalid");
        }
        const updatedState = writeLockedStateResult(await updateStateLocked(tx, { tableId, nextState }));
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
          snapshot: {
            stateVersion: snapshotVersion,
            seats: Array.isArray(nextState.seats) ? nextState.seats : [],
            stacks: nextState.stacks && typeof nextState.stacks === "object" ? nextState.stacks : {}
          }
        };
      }

    const status = String(table.status || "").toUpperCase();
    if (status === "CLOSED") throw makeError("table_closed");
    if (status && status !== "OPEN") throw makeError("table_not_open");

    const maxPlayers = Number(table.max_players);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1) throw makeError("table_not_open");

    const occupiedRows = await tx.unsafe(
      "select seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
      [tableId]
    );
    const occupied = new Set((occupiedRows || []).map((row) => Number(row?.seat_no)).filter((n) => Number.isInteger(n) && n >= 1));
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
      try {
        await tx.unsafe(
          "insert into public.poker_seats (table_id, user_id, seat_no, status, last_seen_at, joined_at, stack) values ($1, $2, $3, 'ACTIVE', now(), now(), 0);",
          [tableId, userId, resolvedSeatNo]
        );
        break;
      } catch (error) {
        if (!isSeatConflictError(error)) throw error;
        if (requestedSeatNo !== null && !autoSeat) throw makeError("seat_taken");
        occupied.add(resolvedSeatNo);
        const retrySeatNo = nextAutoSeatCandidate();
        if (!Number.isInteger(retrySeatNo)) throw makeError("table_full");
        resolvedSeatNo = retrySeatNo;
        klog("shared_join_seat_retry", { seatNo: resolvedSeatNo, occupiedCount: occupied.size });
      }
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
      const stateRow = await syncStateSeatAndStack({
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
      klog("shared_join_state_written", { previousVersion: null, newVersion: stateRow.version });
      await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
      klog("ws_join_authoritative_persisted", { tableId, userId, seatNo: resolvedSeatNo, autoSeat: autoSeat === true, preferredSeatNo: preferredSeatNoRequested, buyIn: resolvedBuyIn, fundedStack });
      klog("shared_join_success", { seatNo: resolvedSeatNo, stack: fundedStack, snapshotVersion: stateRow.version });
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
        snapshot: {
          stateVersion: stateRow.version,
          seats: Array.isArray(stateRow.state?.seats) ? stateRow.state.seats : [],
          stacks: stateRow.state?.stacks && typeof stateRow.state.stacks === "object" ? stateRow.state.stacks : {}
        }
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
