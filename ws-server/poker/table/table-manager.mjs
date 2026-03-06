import { applyCoreEvent, CORE_EVENT_TYPES, createInitialCoreState } from "../core/index.mjs";

const DEFAULT_PRESENCE_TTL_MS = 10_000;
const DEFAULT_MAX_SEATS = 10;

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
  enableDebugCore = false,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  const tables = new Map();
  const connStateBySocket = new Map();
  function nextSyntheticRequestId(kind, tableId, userId, nowTs, discriminator) {
    return `${kind}:${tableId}:${userId}:${nowTs}:${discriminator}`;
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
        subscribers: new Set()
      });
    }
    return tables.get(tableId);
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
    if (!table) {
      return {
        tableId,
        stateVersion: 0,
        members: [],
        maxSeats,
        youSeat: null
      };
    }

    const seatedValue = table.coreState.seats[userId];
    const youSeat = Number.isInteger(seatedValue) ? seatedValue : null;

    return {
      tableId,
      stateVersion: table.coreState.version,
      members: normalizeMembers(table),
      maxSeats: table.coreState.maxSeats,
      youSeat
    };
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
      appliedRequestIdsLength: table.coreState.appliedRequestIds.length
    };
  }

  function orderedSubscribers(tableId, getOrderKey) {
    const table = tables.get(tableId);
    if (!table) {
      return [];
    }

    return [...table.subscribers].sort((a, b) => getOrderKey(a).localeCompare(getOrderKey(b)));
  }

  const manager = {
    join,
    leave,
    subscribe,
    resync,
    touchPresence,
    tableState,
    tableSnapshot,
    cleanupConnection,
    orderedSubscribers,
    sweepExpiredPresence
  };

  if (enableDebugCore && nodeEnv !== "production") {
    manager.__debugCore = __debugCore;
  }

  return manager;
}
