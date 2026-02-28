const DEFAULT_PRESENCE_TTL_MS = 10_000;

export function createTableManager({ presenceTtlMs = DEFAULT_PRESENCE_TTL_MS } = {}) {
  const tables = new Map();
  const connStateBySocket = new Map();

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
        presenceByUserId: new Map(),
        subscribers: new Set()
      });
    }
    return tables.get(tableId);
  }

  function getOrderedMembers(table) {
    return [...table.presenceByUserId.values()]
      .filter((member) => member.connected !== false)
      .sort((a, b) => {
        if (a.seat !== b.seat) {
          return a.seat - b.seat;
        }
        return a.userId.localeCompare(b.userId);
      })
      .map((member) => ({ userId: member.userId, seat: member.seat }));
  }

  function tableState(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return { tableId, members: [] };
    }

    return {
      tableId,
      members: getOrderedMembers(table)
    };
  }

  function nextSeat(table) {
    const used = new Set([...table.presenceByUserId.values()].map((member) => member.seat));
    let candidate = 1;
    while (used.has(candidate)) {
      candidate += 1;
    }
    return candidate;
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

  function join({ ws, userId, tableId, nowTs = Date.now() }) {
    const conn = ensureConn(ws);
    if (conn.joinedTableId && conn.joinedTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already joined to a different table" };
    }

    const table = ensureTable(tableId);
    const alreadyJoined = table.presenceByUserId.has(userId);
    if (!alreadyJoined) {
      table.presenceByUserId.set(userId, {
        userId,
        seat: nextSeat(table),
        connected: true,
        lastSeenAt: nowTs,
        expiresAt: null
      });
    } else {
      markConnected(table.presenceByUserId.get(userId), nowTs);
    }

    table.subscribers.add(ws);
    conn.joinedTableId = tableId;
    conn.subscribedTableId = tableId;

    return {
      ok: true,
      changed: !alreadyJoined,
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

  function leave({ ws, userId, tableId }) {
    const conn = ensureConn(ws);
    const resolvedTableId = tableId || conn.joinedTableId;

    if (!resolvedTableId) {
      return { ok: true, changed: false, tableState: null };
    }

    const table = tables.get(resolvedTableId);
    if (!table) {
      conn.joinedTableId = null;
      if (conn.subscribedTableId === resolvedTableId) {
        conn.subscribedTableId = null;
      }
      return { ok: true, changed: false, tableState: tableState(resolvedTableId) };
    }

    const hadMember = table.presenceByUserId.delete(userId);
    table.subscribers.delete(ws);

    if (conn.joinedTableId === resolvedTableId) {
      conn.joinedTableId = null;
    }

    if (conn.subscribedTableId === resolvedTableId) {
      conn.subscribedTableId = null;
    }

    if (table.presenceByUserId.size === 0 && table.subscribers.size === 0) {
      tables.delete(resolvedTableId);
    }

    return {
      ok: true,
      changed: hadMember,
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
            membershipChanged = table.presenceByUserId.delete(userId);
          } else if (member.connected) {
            markDisconnected(member, nowTs);
            membershipChanged = true;
          }
        }

        table.subscribers.delete(ws);

        if (membershipChanged) {
          updates.push({ tableId: joinedTableId, tableState: tableState(joinedTableId) });
        }

        if (table.presenceByUserId.size === 0 && table.subscribers.size === 0) {
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
        if (table.presenceByUserId.size === 0 && table.subscribers.size === 0) {
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
        table.presenceByUserId.delete(userId);
        changed = true;
      }

      if (changed) {
        updates.push({ tableId, tableState: tableState(tableId) });
      }

      if (table.presenceByUserId.size === 0 && table.subscribers.size === 0) {
        tables.delete(tableId);
      }
    }

    return updates;
  }

  function orderedSubscribers(tableId, getOrderKey) {
    const table = tables.get(tableId);
    if (!table) {
      return [];
    }

    return [...table.subscribers].sort((a, b) => getOrderKey(a).localeCompare(getOrderKey(b)));
  }

  return {
    join,
    leave,
    subscribe,
    resync,
    touchPresence,
    tableState,
    cleanupConnection,
    orderedSubscribers,
    sweepExpiredPresence
  };
}
