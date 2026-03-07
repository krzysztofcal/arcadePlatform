import { applyCoreEvent, CORE_EVENT_TYPES, createInitialCoreState } from "../core/index.mjs";
import { projectRoomCoreSnapshot } from "../read-model/room-core-snapshot.mjs";
import {
  dealHoleCards,
  deriveDeck,
  toHoleCardCodeMap,
  toCardCodes
} from "../shared/poker-primitives.mjs";
import { applyAction as applyPokerAction } from "../shared/poker-action-reducer.mjs";

const DEFAULT_PRESENCE_TTL_MS = 10_000;
const DEFAULT_MAX_SEATS = 10;
const DEFAULT_ACTION_RESULT_CACHE_MAX = 256;
const MIN_PLAYERS_TO_BOOTSTRAP = 2;

function nextHandId(tableId, version, seatCount) {
  return `ws_hand_${tableId}_${version}_${seatCount}`;
}

function nextHandSeed(tableId, version, seatCount) {
  return `ws_seed_${tableId}_${version}_${seatCount}`;
}

function asLiveHandState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (typeof value.handId !== "string" || value.handId.trim() === "") {
    return null;
  }
  if (typeof value.phase !== "string" || !["PREFLOP", "FLOP", "TURN", "RIVER"].includes(value.phase)) {
    return null;
  }
  return value;
}

function orderedSeatMembers(coreState) {
  const members = Array.isArray(coreState?.members) ? coreState.members : [];
  return members
    .filter((member) => typeof member?.userId === "string" && Number.isInteger(member?.seat))
    .slice()
    .sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
}

function buildBootstrappedPokerState({ tableId, coreState }) {
  const members = orderedSeatMembers(coreState);
  if (members.length < MIN_PLAYERS_TO_BOOTSTRAP) {
    return null;
  }

  const userIds = members.map((member) => member.userId);
  const dealerIndex = 0;
  const isHeadsUp = members.length === 2;
  const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % members.length;
  const bbIndex = (sbIndex + 1) % members.length;
  const utgIndex = isHeadsUp ? dealerIndex : (bbIndex + 1) % members.length;
  const sbUserId = members[sbIndex]?.userId ?? null;
  const bbUserId = members[bbIndex]?.userId ?? null;
  const turnUserId = members[utgIndex]?.userId ?? members[dealerIndex]?.userId ?? null;
  const handSeed = nextHandSeed(tableId, coreState.version, members.length);
  const initialDeck = deriveDeck(handSeed);
  const dealt = dealHoleCards(initialDeck, userIds);
  const stacks = Object.fromEntries(userIds.map((userId) => [userId, 100]));
  const betThisRoundByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
  const toCallByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
  const actedThisRoundByUserId = Object.fromEntries(userIds.map((userId) => [userId, false]));
  const foldedByUserId = Object.fromEntries(userIds.map((userId) => [userId, false]));
  const contributionsByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));

  const postBlind = (userId, amount) => {
    if (!userId || !Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    const currentStack = Number(stacks[userId] ?? 0);
    const posted = Math.max(0, Math.min(currentStack, Math.trunc(amount)));
    stacks[userId] = currentStack - posted;
    betThisRoundByUserId[userId] = posted;
    contributionsByUserId[userId] = posted;
    return posted;
  };

  const sbPosted = postBlind(sbUserId, 1);
  const bbPosted = postBlind(bbUserId, 2);
  const currentBet = Math.max(sbPosted, bbPosted);
  for (const userId of userIds) {
    toCallByUserId[userId] = Math.max(0, currentBet - Number(betThisRoundByUserId[userId] ?? 0));
  }

  return {
    roomId: coreState.roomId || tableId,
    handId: nextHandId(tableId, coreState.version, members.length),
    handSeed,
    phase: "PREFLOP",
    dealerSeatNo: members[dealerIndex]?.seat ?? null,
    turnUserId,
    seats: members.map((member) => ({ userId: member.userId, seatNo: member.seat })),
    community: [],
    communityDealt: 0,
    potTotal: sbPosted + bbPosted,
    sidePots: [],
    currentBet,
    lastRaiseSize: bbPosted,
    stacks,
    toCallByUserId,
    betThisRoundByUserId,
    actedThisRoundByUserId,
    foldedByUserId,
    contributionsByUserId,
    holeCardsByUserId: toHoleCardCodeMap(dealt.holeCardsByUserId),
    deck: toCardCodes(dealt.deck)
  };
}

function normalizeMembers(table) {
  const members = [];
  for (const coreMember of table.coreState.members) {
    const presence = table.presenceByUserId.get(coreMember.userId);
    if (presence && presence.connected !== false) {
      members.push({ userId: coreMember.userId, seat: coreMember.seat });
    }
  }

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
  enableDebugCore = false,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  const normalizedActionResultCacheMax = Number.isInteger(actionResultCacheMax) && actionResultCacheMax > 0
    ? actionResultCacheMax
    : DEFAULT_ACTION_RESULT_CACHE_MAX;
  const tables = new Map();
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
      tables.set(tableId, {
        tableId,
        coreState: createInitialCoreState({ roomId: tableId, maxSeats }),
        presenceByUserId: new Map(),
        subscribers: new Set(),
        actionResultsByRequestId: new Map()
      });
    }
    return tables.get(tableId);
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
    const members = table ? normalizeMembers(table) : [];
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

  function bootstrapHand(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return { ok: false, code: "table_missing", bootstrap: "table_missing" };
    }

    const existingLiveState = asLiveHandState(table.coreState?.pokerState);
    if (existingLiveState) {
      return {
        ok: true,
        changed: false,
        bootstrap: "already_live",
        handId: existingLiveState.handId,
        stateVersion: table.coreState.version
      };
    }

    const nextPokerState = buildBootstrappedPokerState({ tableId, coreState: table.coreState });
    if (!nextPokerState) {
      return { ok: true, changed: false, bootstrap: "not_eligible", stateVersion: table.coreState.version };
    }

    table.coreState = {
      ...table.coreState,
      version: table.coreState.version + 1,
      pokerState: nextPokerState
    };

    return {
      ok: true,
      changed: true,
      bootstrap: "started",
      handId: nextPokerState.handId,
      stateVersion: table.coreState.version
    };
  }

  function applyAction({ tableId, handId, userId, requestId, action, amount }) {
    const table = tables.get(tableId);
    if (!table) {
      return rejectAction({ reason: "table_not_found", stateVersion: 0 });
    }

    const replayKey = makeActionReplayKey({ userId, requestId });
    if (replayKey && table.actionResultsByRequestId.has(replayKey)) {
      return asReplayedResult(table.actionResultsByRequestId.get(replayKey));
    }

    const liveState = asLiveHandState(table.coreState?.pokerState);
    if (!liveState) {
      const rejected = rejectAction({ reason: "hand_not_live", stateVersion: table.coreState.version });
      rememberActionResult(table, requestId, { ...rejected, userId });
      return rejected;
    }

    if (typeof handId !== "string" || handId !== liveState.handId) {
      const rejected = rejectAction({ reason: "hand_mismatch", stateVersion: table.coreState.version });
      rememberActionResult(table, requestId, { ...rejected, userId });
      return rejected;
    }

    const seat = Number.isInteger(table.coreState.seats?.[userId]) ? table.coreState.seats[userId] : null;
    if (!Number.isInteger(seat)) {
      const rejected = rejectAction({ reason: "not_seated", stateVersion: table.coreState.version });
      rememberActionResult(table, requestId, { ...rejected, userId });
      return rejected;
    }

    const applied = applyPokerAction({
      pokerState: liveState,
      userId,
      action,
      amount
    });

    if (!applied.ok) {
      const rejected = rejectAction({ reason: applied.reason || "action_rejected", stateVersion: table.coreState.version });
      rememberActionResult(table, requestId, { ...rejected, userId });
      return rejected;
    }

    table.coreState = {
      ...table.coreState,
      version: table.coreState.version + 1,
      pokerState: applied.state
    };

    const accepted = {
      ok: true,
      accepted: true,
      changed: true,
      replayed: false,
      reason: null,
      action: applied.action,
      stateVersion: table.coreState.version,
      handId: applied.state.handId
    };

    rememberActionResult(table, requestId, { ...accepted, userId });

    return accepted;
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

  function join({ ws, userId, tableId, requestId, nowTs = Date.now() }) {
    const conn = ensureConn(ws);
    if (conn.joinedTableId && conn.joinedTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already joined to a different table" };
    }

    const table = ensureTable(tableId);
    const joinResult = applyCoreEvent(table.coreState, {
      type: CORE_EVENT_TYPES.JOIN,
      requestId,
      userId
    });

    if (!joinResult.ok) {
      return { ok: false, code: joinResult.error.code, message: joinResult.error.code, tableState: tableState(tableId) };
    }

    table.coreState = joinResult.state;

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

    table.subscribers.add(ws);
    conn.joinedTableId = tableId;
    conn.subscribedTableId = tableId;

    const changed = joinResult.effects.some((effect) => effect.type === "member_joined");
    return {
      ok: true,
      changed,
      effects: joinResult.effects,
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
    const resolvedTableId = tableId || conn.joinedTableId;

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

    const leaveResult = applyCoreEvent(table.coreState, {
      type: CORE_EVENT_TYPES.LEAVE,
      requestId,
      userId
    });

    if (!leaveResult.ok) {
      return { ok: false, code: leaveResult.error.code, message: leaveResult.error.code, tableState: tableState(resolvedTableId) };
    }

    table.coreState = leaveResult.state;

    const hasMember = table.coreState.members.some((member) => member.userId === userId);
    if (!hasMember) {
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

    const changed = leaveResult.effects.some((effect) => effect.type === "member_left");
    return {
      ok: true,
      changed,
      effects: leaveResult.effects,
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

  const manager = {
    join,
    leave,
    subscribe,
    resync,
    touchPresence,
    tableState,
    tableSnapshot,
    bootstrapHand,
    applyAction,
    cleanupConnection,
    orderedSubscribers,
    orderedConnectionsForTable,
    sweepExpiredPresence
  };

  if (enableDebugCore && nodeEnv !== "production") {
    manager.__debugCore = __debugCore;
  }

  return manager;
}
