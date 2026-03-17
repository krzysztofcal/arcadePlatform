import { applyCoreEvent, CORE_EVENT_TYPES, createInitialCoreState } from "../core/index.mjs";
import { projectRoomCoreSnapshot } from "../read-model/room-core-snapshot.mjs";
import {
  applyCoreStateAction,
  applyCoreStateTurnTimeout,
  asLiveHandState,
  decideCoreStateTurnTimeout,
  bootstrapCoreStateHand,
  buildBootstrappedPokerState,
  buildNextHandStateFromSettled,
  isContinuationEligibleByStack,
  orderedEligibleSeatMembers,
  resolveNextDealerSeatNo
} from "../engine/poker-engine.mjs";

const DEFAULT_PRESENCE_TTL_MS = 10_000;
const DEFAULT_MAX_SEATS = 10;
const DEFAULT_ACTION_RESULT_CACHE_MAX = 256;
export const __testOnly = {
  isContinuationEligibleByStack,
  orderedEligibleSeatMembers,
  resolveNextDealerSeatNo,
  buildNextHandStateFromSettled,
  buildBootstrappedPokerState
};

function normalizeMembers(table) {
  const sourceMembers = Array.isArray(table?.coreState?.members) ? table.coreState.members : [];
  const members = sourceMembers
    .map((member) => {
      const userId = typeof member?.userId === "string" ? member.userId.trim() : "";
      const seat = Number.isInteger(member?.seat) ? member.seat : null;
      if (!userId || !Number.isInteger(seat)) return null;
      const presence = table?.presenceByUserId instanceof Map ? table.presenceByUserId.get(userId) : null;
      if (!presence || presence.connected === false) return null;
      return { userId, seat };
    })
    .filter(Boolean);

  return members.sort((a, b) => {
    if (a.seat !== b.seat) {
      return a.seat - b.seat;
    }
    return a.userId.localeCompare(b.userId);
  });
}

function normalizeAuthoritativeMembers(table) {
  const sourceMembers = Array.isArray(table?.coreState?.members) ? table.coreState.members : [];
  const members = sourceMembers
    .map((member) => {
      const userId = typeof member?.userId === "string" ? member.userId.trim() : "";
      const seat = Number.isInteger(member?.seat) ? member.seat : null;
      if (!userId || !Number.isInteger(seat)) return null;
      return { userId, seat };
    })
    .filter(Boolean);

  return members.sort((a, b) => {
    if (a.seat !== b.seat) {
      return a.seat - b.seat;
    }
    return a.userId.localeCompare(b.userId);
  });
}

export function createTableManager({
  presenceTtlMs = DEFAULT_PRESENCE_TTL_MS,
  maxSeats = DEFAULT_MAX_SEATS,
  actionResultCacheMax = DEFAULT_ACTION_RESULT_CACHE_MAX,
  tableBootstrapLoader = null,
  observeOnlyJoin = false,
  enableDebugCore = false,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  const normalizedActionResultCacheMax = Number.isInteger(actionResultCacheMax) && actionResultCacheMax > 0
    ? actionResultCacheMax
    : DEFAULT_ACTION_RESULT_CACHE_MAX;
  const tables = new Map();
  const pendingBootstrapByTableId = new Map();
  const connStateBySocket = new Map();
  function nextSyntheticRequestId(kind, tableId, userId, nowTs, discriminator) {
    return `${kind}:${tableId}:${userId}:${nowTs}:${discriminator}`;
  }

  function rememberActionResult(table, requestId, result) {
    const replayKey = makeActionReplayKey({ userId: result?.userId ?? null, requestId });
    if (!replayKey) {
      return;
    }

    while (table.actionResultsByRequestId.size >= normalizedActionResultCacheMax) {
      const oldestKey = table.actionResultsByRequestId.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      table.actionResultsByRequestId.delete(oldestKey);
    }

    table.actionResultsByRequestId.set(replayKey, result);
  }

  function makeActionReplayKey({ userId, requestId }) {
    if (typeof userId !== "string" || userId.trim() === "") {
      return null;
    }
    if (typeof requestId !== "string" || requestId.trim() === "") {
      return null;
    }
    return `${userId}:${requestId}`;
  }

  function resolveNowMs({ nowMs }) {
    if (Number.isFinite(nowMs)) {
      return Math.trunc(nowMs);
    }
    return Date.now();
  }

  function asReplayedResult(result) {
    const { userId: _ignoredUserId, ...rest } = result || {};
    return {
      ...rest,
      changed: false,
      replayed: true
    };
  }

  function ensureConn(ws) {
    if (!connStateBySocket.has(ws)) {
      connStateBySocket.set(ws, {
        joinedTableId: null,
        subscribedTableId: null
      });
    }
    return connStateBySocket.get(ws);
  }

  function ensureTable(tableId) {
    if (!tables.has(tableId)) {
      const initialCoreState = createInitialCoreState({ roomId: tableId, maxSeats });
      tables.set(tableId, {
        tableId,
        coreState: initialCoreState,
        persistedStateVersion: Number.isInteger(initialCoreState.version) ? initialCoreState.version : 0,
        presenceByUserId: new Map(),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      });
    }
    return tables.get(tableId);
  }

  async function ensureTableLoaded(tableId, { allowCreate = false } = {}) {
    if (tables.has(tableId)) {
      return { ok: true, table: tables.get(tableId), cached: true };
    }

    if (pendingBootstrapByTableId.has(tableId)) {
      return pendingBootstrapByTableId.get(tableId);
    }

    const bootstrapPromise = (async () => {
      if (typeof tableBootstrapLoader !== "function") {
        if (!allowCreate) {
          return {
            ok: false,
            code: "table_bootstrap_unavailable",
            message: "table_bootstrap_unavailable"
          };
        }
        const table = ensureTable(tableId);
        return { ok: true, table, cached: false };
      }

      const loaded = await tableBootstrapLoader({ tableId, maxSeats });
      if (!loaded?.ok) {
        return {
          ok: false,
          code: loaded?.code || "table_not_found",
          message: loaded?.message || loaded?.code || "table_not_found"
        };
      }

      const loadedTable = loaded.table;
      const loadedVersion = Number(loadedTable?.coreState?.version);
      loadedTable.persistedStateVersion = Number.isInteger(loadedVersion) && loadedVersion >= 0 ? loadedVersion : 0;
      tables.set(tableId, loadedTable);
      return { ok: true, table: loadedTable, cached: false };
    })();

    pendingBootstrapByTableId.set(tableId, bootstrapPromise);

    try {
      return await bootstrapPromise;
    } finally {
      pendingBootstrapByTableId.delete(tableId);
    }
  }

  function rejectAction({ reason, stateVersion }) {
    return {
      ok: true,
      accepted: false,
      changed: false,
      replayed: false,
      reason,
      stateVersion
    };
  }

  function tableState(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return { tableId, members: [] };
    }

    return {
      tableId,
      members: normalizeMembers(table)
    };
  }

  function tableSnapshot(tableId, userId) {
    const table = tables.get(tableId);
    const members = table ? normalizeAuthoritativeMembers(table) : [];
    const roomId = table?.coreState?.roomId || tableId;
    const youSeatValue = table?.coreState?.seats?.[userId];
    const youSeat = Number.isInteger(youSeatValue) ? youSeatValue : null;
    const roomCore = projectRoomCoreSnapshot({
      tableId,
      roomId,
      coreState: table?.coreState ?? null,
      members,
      userId,
      youSeat
    });

    if (!table) {
      return {
        tableId,
        roomId,
        stateVersion: 0,
        members,
        memberCount: 0,
        maxSeats,
        youSeat,
        ...roomCore
      };
    }

    return {
      tableId,
      roomId,
      stateVersion: table.coreState.version,
      members,
      memberCount: members.length,
      maxSeats: table.coreState.maxSeats,
      youSeat,
      ...roomCore
    };
  }

  function bootstrapHand(tableId, { nowMs } = {}) {
    const table = tables.get(tableId);
    if (!table) {
      return { ok: false, code: "table_missing", bootstrap: "table_missing" };
    }

    const result = bootstrapCoreStateHand({ tableId, coreState: table.coreState, nowMs: resolveNowMs({ nowMs }) });
    table.coreState = result.coreState;

    return {
      ok: result.ok,
      changed: result.changed,
      bootstrap: result.bootstrap,
      handId: result.handId,
      stateVersion: result.stateVersion
    };
  }

  function applyAction({ tableId, handId, userId, requestId, action, amount, nowIso, nowMs }) {
    const table = tables.get(tableId);
    if (!table) {
      return rejectAction({ reason: "table_not_found", stateVersion: 0 });
    }

    const replayKey = makeActionReplayKey({ userId, requestId });
    if (replayKey && table.actionResultsByRequestId.has(replayKey)) {
      return asReplayedResult(table.actionResultsByRequestId.get(replayKey));
    }

    const applied = applyCoreStateAction({
      tableId,
      coreState: table.coreState,
      handId,
      userId,
      action,
      amount,
      nowIso,
      nowMs: resolveNowMs({ nowMs })
    });

    if (!applied.accepted) {
      const rejected = rejectAction({ reason: applied.reason || "action_rejected", stateVersion: applied.stateVersion });
      rememberActionResult(table, requestId, { ...rejected, userId });
      return rejected;
    }

    table.coreState = applied.coreState;

    const accepted = {
      ok: true,
      accepted: true,
      changed: true,
      replayed: false,
      reason: null,
      action: applied.action,
      stateVersion: applied.stateVersion,
      handId: applied.handId
    };

    rememberActionResult(table, requestId, { ...accepted, userId });

    return accepted;
  }

  function timeoutRequestId({ tableId, pokerState }) {
    const handId = typeof pokerState?.handId === "string" && pokerState.handId.trim() ? pokerState.handId.trim() : "unknown";
    const actor = typeof pokerState?.turnUserId === "string" && pokerState.turnUserId.trim() ? pokerState.turnUserId.trim() : "unknown";
    const phase = typeof pokerState?.phase === "string" ? pokerState.phase : "unknown";
    const deadline = Number.isFinite(Number(pokerState?.turnDeadlineAt)) ? Math.trunc(Number(pokerState.turnDeadlineAt)) : -1;
    return `timeout:${tableId}:${handId}:${phase}:${actor}:${deadline}`;
  }

  function maybeApplyTurnTimeout({ tableId, nowMs = Date.now() } = {}) {
    const table = tables.get(tableId);
    if (!table) {
      return { ok: false, changed: false, reason: "table_not_found", stateVersion: 0 };
    }

    const liveState = asLiveHandState(table.coreState?.pokerState);
    if (!liveState) {
      return { ok: true, changed: false, reason: "hand_not_live", stateVersion: table.coreState.version };
    }

    const timeoutDecision = decideCoreStateTurnTimeout({ coreState: table.coreState, nowMs });
    if (!timeoutDecision.due) {
      return { ok: true, changed: false, reason: timeoutDecision.reason, stateVersion: timeoutDecision.stateVersion };
    }

    const requestId = timeoutRequestId({ tableId, pokerState: timeoutDecision.liveState });
    const replayKey = makeActionReplayKey({ userId: timeoutDecision.decision.actorUserId, requestId });
    if (replayKey && table.actionResultsByRequestId.has(replayKey)) {
      return {
        ok: true,
        changed: false,
        replayed: true,
        reason: "already_applied",
        stateVersion: table.coreState.version
      };
    }

    const timeoutApplied = applyCoreStateTurnTimeout({ tableId, coreState: table.coreState, nowMs });
    if (!timeoutApplied.changed) {
      rememberActionResult(table, requestId, {
        ok: true,
        accepted: false,
        changed: false,
        replayed: false,
        reason: timeoutApplied.reason || "timeout_rejected",
        stateVersion: table.coreState.version,
        userId: timeoutDecision.decision.actorUserId
      });
      return { ok: true, changed: false, reason: timeoutApplied.reason, stateVersion: timeoutApplied.stateVersion };
    }

    table.coreState = timeoutApplied.coreState;
    rememberActionResult(table, requestId, {
      ok: true,
      accepted: true,
      changed: true,
      replayed: false,
      reason: null,
      action: timeoutApplied.action,
      stateVersion: timeoutApplied.stateVersion,
      handId: table.coreState?.pokerState?.handId ?? null,
      userId: timeoutApplied.actorUserId
    });

    return {
      ok: true,
      changed: true,
      replayed: false,
      requestId,
      action: timeoutApplied.action,
      actorUserId: timeoutApplied.actorUserId,
      stateVersion: timeoutApplied.stateVersion
    };
  }

  function sweepTurnTimeouts({ nowMs = Date.now() } = {}) {
    const updates = [];
    for (const [tableId] of tables.entries()) {
      const timeoutResult = maybeApplyTurnTimeout({ tableId, nowMs });
      if (timeoutResult.ok && timeoutResult.changed) {
        updates.push({ tableId, stateVersion: timeoutResult.stateVersion });
      }
    }
    return updates;
  }

  function markConnected(member, nowMs) {
    member.connected = true;
    member.lastSeenAt = nowMs;
    member.expiresAt = null;
  }

  function markDisconnected(member, nowMs) {
    member.connected = false;
    member.lastSeenAt = nowMs;
    member.expiresAt = nowMs + presenceTtlMs;
  }

  function join({ ws, userId, tableId, requestId, nowTs = Date.now(), authoritativeSeatNo = null }) {
    const conn = ensureConn(ws);
    const activeTableId = conn.joinedTableId || conn.subscribedTableId;
    if (activeTableId && activeTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already joined to a different table" };
    }

    const table = ensureTable(tableId);
    const isAuthoritativeMember = table.coreState.members.some((member) => member.userId === userId);
    const authoritativeSeat = Number.isInteger(authoritativeSeatNo) && authoritativeSeatNo >= 1 ? authoritativeSeatNo : null;
    const shouldMutateMembership = !observeOnlyJoin;

    if (isAuthoritativeMember || shouldMutateMembership) {
      if (shouldMutateMembership && Number.isInteger(authoritativeSeat)) {
        if (authoritativeSeat > table.coreState.maxSeats) {
          return { ok: false, code: "invalid_seat_no", message: "invalid_seat_no", tableState: tableState(tableId) };
        }

        const seatOwnedByOther = table.coreState.members.some((member) => member.userId !== userId && member.seat === authoritativeSeat);
        if (seatOwnedByOther) {
          return { ok: false, code: "seat_taken", message: "seat_taken", tableState: tableState(tableId) };
        }

        const existingMember = table.coreState.members.find((member) => member.userId === userId) ?? null;
        const nextMembers = table.coreState.members
          .filter((member) => member.userId !== userId)
          .concat({ userId, seat: authoritativeSeat })
          .sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
        const nextSeats = { ...table.coreState.seats, [userId]: authoritativeSeat };
        table.coreState = {
          ...table.coreState,
          members: nextMembers,
          seats: nextSeats
        };

        const changed = !existingMember || existingMember.seat !== authoritativeSeat;
        const seat = authoritativeSeat;
        if (!table.presenceByUserId.has(userId)) {
          table.presenceByUserId.set(userId, {
            userId,
            seat,
            connected: true,
            lastSeenAt: nowTs,
            expiresAt: null
          });
        } else {
          const existingPresence = table.presenceByUserId.get(userId);
          existingPresence.seat = seat;
          markConnected(existingPresence, nowTs);
        }

        table.subscribers.add(ws);
        conn.joinedTableId = tableId;
        conn.subscribedTableId = tableId;
        return {
          ok: true,
          changed,
          effects: changed
            ? [{ type: existingMember ? "member_reseated" : "member_joined", userId, seat }]
            : [{ type: "presence_connected" }],
          tableState: tableState(tableId)
        };
      }

      if (shouldMutateMembership && !isAuthoritativeMember) {
        const joinResult = applyCoreEvent(table.coreState, {
          type: CORE_EVENT_TYPES.JOIN,
          requestId,
          userId
        });

        if (!joinResult.ok) {
          return { ok: false, code: joinResult.error.code, message: joinResult.error.code, tableState: tableState(tableId) };
        }

        table.coreState = joinResult.state;
      }

      const seat = table.coreState.seats[userId];
      if (!table.presenceByUserId.has(userId)) {
        table.presenceByUserId.set(userId, {
          userId,
          seat,
          connected: true,
          lastSeenAt: nowTs,
          expiresAt: null
        });
      } else {
        const existingPresence = table.presenceByUserId.get(userId);
        existingPresence.seat = seat;
        markConnected(existingPresence, nowTs);
      }
    }

    table.subscribers.add(ws);
    conn.joinedTableId = (isAuthoritativeMember || shouldMutateMembership) ? tableId : null;
    conn.subscribedTableId = tableId;

    return {
      ok: true,
      changed: shouldMutateMembership && !isAuthoritativeMember,
      effects: isAuthoritativeMember
        ? [{ type: "presence_connected" }]
        : shouldMutateMembership
          ? [{ type: "member_joined" }]
          : [{ type: "observer_connected" }],
      tableState: tableState(tableId)
    };
  }

  function touchPresence({ tableId, userId, nowTs = Date.now() }) {
    const table = tables.get(tableId);
    if (!table) {
      return { ok: false, changed: false, tableState: tableState(tableId) };
    }

    const member = table.presenceByUserId.get(userId);
    if (!member) {
      return { ok: false, changed: false, tableState: tableState(tableId) };
    }

    const changed = !member.connected;
    markConnected(member, nowTs);
    return { ok: true, changed, tableState: tableState(tableId) };
  }

  function resync({ ws, userId, tableId, nowTs = Date.now() }) {
    const conn = ensureConn(ws);
    if (conn.subscribedTableId && conn.subscribedTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already subscribed to a different table" };
    }

    const table = ensureTable(tableId);
    table.subscribers.add(ws);
    conn.subscribedTableId = tableId;

    const touched = touchPresence({ tableId, userId, nowTs });
    conn.joinedTableId = touched.ok ? tableId : null;

    return {
      ok: true,
      changed: false,
      tableState: tableState(tableId)
    };
  }

  function leave({ ws, userId, tableId, requestId }) {
    const conn = ensureConn(ws);
    const resolvedTableId = tableId || conn.joinedTableId || conn.subscribedTableId;

    if (!resolvedTableId) {
      return { ok: true, changed: false, effects: [{ type: "noop", reason: "not_joined" }], tableState: null };
    }

    const table = tables.get(resolvedTableId);
    if (!table) {
      conn.joinedTableId = null;
      if (conn.subscribedTableId === resolvedTableId) {
        conn.subscribedTableId = null;
      }
      return { ok: true, changed: false, effects: [{ type: "noop", reason: "table_missing" }], tableState: tableState(resolvedTableId) };
    }

    const hasMember = table.coreState.members.some((member) => member.userId === userId);
    let effects = [{ type: "observer_left" }];
    let changed = false;

    if (hasMember) {
      const leaveResult = applyCoreEvent(table.coreState, {
        type: CORE_EVENT_TYPES.LEAVE,
        requestId,
        userId
      });

      if (!leaveResult.ok) {
        return { ok: false, code: leaveResult.error.code, message: leaveResult.error.code, tableState: tableState(resolvedTableId) };
      }

      table.coreState = leaveResult.state;
      effects = leaveResult.effects;
      changed = leaveResult.effects.some((effect) => effect.type === "member_left");

      const stillMember = table.coreState.members.some((member) => member.userId === userId);
      if (!stillMember) {
        table.presenceByUserId.delete(userId);
      }
    } else {
      table.presenceByUserId.delete(userId);
    }

    table.subscribers.delete(ws);

    if (conn.joinedTableId === resolvedTableId) {
      conn.joinedTableId = null;
    }

    if (conn.subscribedTableId === resolvedTableId) {
      conn.subscribedTableId = null;
    }

    if (table.coreState.members.length === 0 && table.subscribers.size === 0) {
      tables.delete(resolvedTableId);
    }

    return {
      ok: true,
      changed,
      effects,
      tableState: tableState(resolvedTableId)
    };
  }



  function hasValidAuthoritativeSeats(stateSeats) {
    if (!Array.isArray(stateSeats)) return false;
    return stateSeats.every((seatEntry) => {
      const rawSeatNo = seatEntry?.seatNo;
      const rawSeatAlias = seatEntry?.seat;
      const normalizedSeat = Number.isInteger(Number(rawSeatNo))
        ? Number(rawSeatNo)
        : Number.isInteger(Number(rawSeatAlias))
          ? Number(rawSeatAlias)
          : null;
      const seatUserId = typeof seatEntry?.userId === "string" ? seatEntry.userId.trim() : "";
      return Number.isInteger(normalizedSeat) && seatUserId.length > 0;
    });
  }

  function authoritativeSeatsContainUser(stateSeats, userId) {
    if (!Array.isArray(stateSeats)) return false;
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) return false;
    return stateSeats.some((seatEntry) => {
      const seatUserId = typeof seatEntry?.userId === "string" ? seatEntry.userId.trim() : "";
      return seatUserId === normalizedUserId;
    });
  }

  function syncAuthoritativeLeave({ ws, userId, tableId, stateVersion = null, pokerState = null }) {
    const conn = ensureConn(ws);
    const resolvedTableId = tableId || conn.joinedTableId || conn.subscribedTableId;
    if (!resolvedTableId) {
      return { ok: true, changed: false, tableState: null };
    }

    const table = tables.get(resolvedTableId);
    if (!table) {
      if (conn.joinedTableId === resolvedTableId) {
        conn.joinedTableId = null;
      }
      if (conn.subscribedTableId === resolvedTableId) {
        conn.subscribedTableId = null;
      }
      return { ok: true, changed: false, tableState: tableState(resolvedTableId) };
    }

    const previousMembers = JSON.stringify(table.coreState.members);
    const previousSeats = JSON.stringify(table.coreState.seats || {});
    const previousVersion = Number(table.coreState.version);
    const previousPokerState = JSON.stringify(table.coreState.pokerState ?? null);

    const normalizedState = pokerState && typeof pokerState === "object" && !Array.isArray(pokerState) ? pokerState : null;
    const stateTableId = typeof normalizedState?.tableId === "string" ? normalizedState.tableId : "";
    const stateSeats = normalizedState?.seats;
    const authoritativeStateValid = normalizedState
      && stateTableId === resolvedTableId
      && hasValidAuthoritativeSeats(stateSeats);

    if (!authoritativeStateValid || authoritativeSeatsContainUser(stateSeats, userId)) {
      return {
        ok: false,
        code: "authoritative_state_invalid",
        changed: false,
        tableState: tableState(resolvedTableId)
      };
    }

    const nextMembers = stateSeats
      .map((seatEntry) => {
        const rawSeatNo = seatEntry?.seatNo;
        const rawSeatAlias = seatEntry?.seat;
        const normalizedSeat = Number.isInteger(Number(rawSeatNo))
          ? Number(rawSeatNo)
          : Number.isInteger(Number(rawSeatAlias))
            ? Number(rawSeatAlias)
            : null;
        const userId = typeof seatEntry?.userId === "string" ? seatEntry.userId.trim() : "";
        if (!Number.isInteger(normalizedSeat) || !userId) {
          return null;
        }
        return { userId, seat: normalizedSeat };
      })
      .filter(Boolean)
      .sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
    const nextSeats = {};
    for (const member of nextMembers) {
      nextSeats[member.userId] = member.seat;
    }

    table.coreState.members = nextMembers;
    table.coreState.seats = nextSeats;
    if (Number.isInteger(stateVersion) && stateVersion >= 0) {
      table.coreState.version = stateVersion;
    }
    table.coreState.pokerState = { ...normalizedState };

    for (const [presenceUserId, presence] of table.presenceByUserId.entries()) {
      if (!Object.prototype.hasOwnProperty.call(nextSeats, presenceUserId)) {
        table.presenceByUserId.delete(presenceUserId);
        continue;
      }
      presence.seat = nextSeats[presenceUserId];
    }
    table.presenceByUserId.delete(userId);

    table.subscribers.delete(ws);
    if (conn.joinedTableId === resolvedTableId) {
      conn.joinedTableId = null;
    }
    if (conn.subscribedTableId === resolvedTableId) {
      conn.subscribedTableId = null;
    }

    if (table.coreState.members.length === 0 && table.subscribers.size === 0) {
      tables.delete(resolvedTableId);
    }

    const nextMembersJson = JSON.stringify(nextMembers);
    const nextSeatsJson = JSON.stringify(nextSeats);
    const nextVersion = Number(table.coreState.version);
    const nextPokerState = JSON.stringify(table.coreState.pokerState ?? null);
    const changed = previousMembers !== nextMembersJson
      || previousSeats !== nextSeatsJson
      || previousVersion !== nextVersion
      || previousPokerState !== nextPokerState;

    return {
      ok: true,
      changed,
      tableState: tableState(resolvedTableId)
    };
  }

  function subscribe({ ws, tableId }) {
    const conn = ensureConn(ws);
    if (conn.subscribedTableId && conn.subscribedTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already subscribed to a different table" };
    }

    const table = ensureTable(tableId);
    table.subscribers.add(ws);
    conn.subscribedTableId = tableId;

    return {
      ok: true,
      tableState: tableState(tableId)
    };
  }

  function cleanupConnection({ ws, userId, nowTs = Date.now(), activeSockets = [] }) {
    const conn = connStateBySocket.get(ws);
    if (!conn) {
      return [];
    }

    const updates = [];

    if (conn.joinedTableId) {
      const joinedTableId = conn.joinedTableId;
      const table = tables.get(joinedTableId);
      if (table) {
        const member = table.presenceByUserId.get(userId);
        const hasTableAssociatedConnection = activeSockets.some((socket) => {
          const activeConn = connStateBySocket.get(socket);
          return activeConn && (activeConn.joinedTableId === joinedTableId || activeConn.subscribedTableId === joinedTableId);
        });

        let membershipChanged = false;
        if (member && !hasTableAssociatedConnection) {
          if (presenceTtlMs === 0) {
            const leaveResult = applyCoreEvent(table.coreState, {
              type: CORE_EVENT_TYPES.LEAVE,
              requestId: nextSyntheticRequestId("disconnect", joinedTableId, userId, nowTs, table.coreState.version),
              userId
            });
            if (leaveResult.ok) {
              table.coreState = leaveResult.state;
              table.presenceByUserId.delete(userId);
              membershipChanged = leaveResult.effects.some((effect) => effect.type === "member_left");
            }
          } else if (member.connected) {
            markDisconnected(member, nowTs);
            membershipChanged = true;
          }
        }

        table.subscribers.delete(ws);

        if (membershipChanged) {
          updates.push({ tableId: joinedTableId, tableState: tableState(joinedTableId) });
        }

        if (table.coreState.members.length === 0 && table.subscribers.size === 0) {
          tables.delete(joinedTableId);
        }
      }

      if (conn.subscribedTableId === joinedTableId) {
        conn.subscribedTableId = null;
      }
      conn.joinedTableId = null;
    }

    if (conn.subscribedTableId) {
      const subscribedTableId = conn.subscribedTableId;
      const table = tables.get(subscribedTableId);
      if (table) {
        table.subscribers.delete(ws);
        if (table.coreState.members.length === 0 && table.subscribers.size === 0) {
          tables.delete(subscribedTableId);
        }
      }
      conn.subscribedTableId = null;
    }

    connStateBySocket.delete(ws);
    return updates;
  }

  function sweepExpiredPresence({ nowTs = Date.now() } = {}) {
    const updates = [];

    for (const [tableId, table] of tables.entries()) {
      let changed = false;
      const expiredUserIds = [];

      for (const [userId, member] of table.presenceByUserId.entries()) {
        if (!member.connected && typeof member.expiresAt === "number" && member.expiresAt <= nowTs) {
          expiredUserIds.push(userId);
        }
      }

      for (const userId of expiredUserIds) {
        const leaveResult = applyCoreEvent(table.coreState, {
          type: CORE_EVENT_TYPES.LEAVE,
          requestId: nextSyntheticRequestId("sweep", tableId, userId, nowTs, table.coreState.version),
          userId
        });
        if (leaveResult.ok) {
          table.coreState = leaveResult.state;
          table.presenceByUserId.delete(userId);
          changed = changed || leaveResult.effects.some((effect) => effect.type === "member_left");
        }
      }

      if (changed) {
        updates.push({ tableId, tableState: tableState(tableId) });
      }

      if (table.coreState.members.length === 0 && table.subscribers.size === 0) {
        tables.delete(tableId);
      }
    }

    return updates;
  }



  function persistedPokerState(tableId) {
    const table = tables.get(tableId);
    const pokerState = table?.coreState?.pokerState;
    if (!pokerState || typeof pokerState !== "object" || Array.isArray(pokerState)) {
      return null;
    }
    return { ...pokerState };
  }

  function setPersistedStateVersion(tableId, stateVersion) {
    const table = tables.get(tableId);
    if (!table || !Number.isInteger(stateVersion) || stateVersion < 0) {
      return { ok: false };
    }
    table.persistedStateVersion = stateVersion;
    return { ok: true };
  }

  function persistedStateVersion(tableId) {
    const table = tables.get(tableId);
    const stateVersion = Number(table?.persistedStateVersion);
    if (!Number.isInteger(stateVersion) || stateVersion < 0) {
      return null;
    }
    return stateVersion;
  }

  function restoreTableFromPersisted(tableId, restoredTable) {
    const restoredCoreState = restoredTable?.coreState;
    if (!restoredCoreState || typeof restoredCoreState !== "object") {
      return { ok: false, reason: "invalid_restored_table" };
    }

    const table = ensureTable(tableId);
    const previousPresenceByUserId = table.presenceByUserId;
    const restoredPresenceByUserId = restoredTable?.presenceByUserId instanceof Map
      ? restoredTable.presenceByUserId
      : new Map();
    const nextPresenceByUserId = new Map();

    for (const [userId, restoredPresence] of restoredPresenceByUserId.entries()) {
      const previousPresence = previousPresenceByUserId.get(userId);
      nextPresenceByUserId.set(userId, {
        ...restoredPresence,
        connected: Boolean(previousPresence?.connected),
        lastSeenAt: previousPresence?.lastSeenAt ?? null,
        expiresAt: previousPresence?.expiresAt ?? null
      });
    }

    table.coreState = restoredCoreState;
    table.persistedStateVersion = Number.isInteger(restoredCoreState.version) && restoredCoreState.version >= 0
      ? restoredCoreState.version
      : table.persistedStateVersion;
    table.presenceByUserId = nextPresenceByUserId;
    table.actionResultsByRequestId.clear();
    return { ok: true };
  }

  function __debugPokerState(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return null;
    }

    if (!table.coreState?.pokerState || typeof table.coreState.pokerState !== "object") {
      return null;
    }

    return { ...table.coreState.pokerState };
  }

  function __debugCore(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return null;
    }

    return {
      version: table.coreState.version,
      appliedRequestIdsLength: table.coreState.appliedRequestIds.length,
      actionResultsCacheSize: table.actionResultsByRequestId.size
    };
  }

  function orderedSubscribers(tableId, getOrderKey) {
    const table = tables.get(tableId);
    if (!table) {
      return [];
    }

    return [...table.subscribers].sort((a, b) => getOrderKey(a).localeCompare(getOrderKey(b)));
  }

  function orderedConnectionsForTable(tableId, getOrderKey) {
    const sockets = [];
    for (const [socket, conn] of connStateBySocket.entries()) {
      if (conn?.joinedTableId === tableId || conn?.subscribedTableId === tableId) {
        sockets.push(socket);
      }
    }
    return sockets.sort((a, b) => getOrderKey(a).localeCompare(getOrderKey(b)));
  }

  function resolveImplicitLeaveTableId({ ws, userId }) {
    const conn = connStateBySocket.get(ws);
    if (conn?.joinedTableId) {
      return conn.joinedTableId;
    }
    if (conn?.subscribedTableId) {
      return conn.subscribedTableId;
    }

    const matches = [];
    for (const [tableId, table] of tables.entries()) {
      const hasMember = table?.coreState?.members?.some((member) => member?.userId === userId);
      if (hasMember) {
        matches.push(tableId);
      }
    }

    return matches.length === 1 ? matches[0] : null;
  }

  const manager = {
    ensureTableLoaded,
    join,
    leave,
    syncAuthoritativeLeave,
    subscribe,
    resync,
    touchPresence,
    tableState,
    tableSnapshot,
    bootstrapHand,
    applyAction,
    maybeApplyTurnTimeout,
    sweepTurnTimeouts,
    cleanupConnection,
    orderedSubscribers,
    orderedConnectionsForTable,
    resolveImplicitLeaveTableId,
    sweepExpiredPresence,
    persistedPokerState,
    persistedStateVersion,
    setPersistedStateVersion,
    restoreTableFromPersisted
  };

  if (enableDebugCore && nodeEnv !== "production") {
    manager.__debugCore = __debugCore;
    manager.__debugPokerState = __debugPokerState;
  }

  return manager;
}
