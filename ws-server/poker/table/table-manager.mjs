export function createTableManager() {
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

  function join({ ws, userId, tableId }) {
    const conn = ensureConn(ws);
    if (conn.joinedTableId && conn.joinedTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already joined to a different table" };
    }

    const table = ensureTable(tableId);
    const alreadyJoined = table.presenceByUserId.has(userId);
    if (!alreadyJoined) {
      table.presenceByUserId.set(userId, {
        userId,
        seat: nextSeat(table)
      });
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

  function cleanupConnection({ ws, userId }) {
    const conn = connStateBySocket.get(ws);
    if (!conn) {
      return [];
    }

    const updates = [];

    if (conn.joinedTableId) {
      const leaveResult = leave({ ws, userId, tableId: conn.joinedTableId });
      if (leaveResult.tableState) {
        updates.push({ tableId: leaveResult.tableState.tableId, tableState: leaveResult.tableState });
      }
    }

    if (conn.subscribedTableId && conn.subscribedTableId !== conn.joinedTableId) {
      const table = tables.get(conn.subscribedTableId);
      if (table) {
        table.subscribers.delete(ws);
        updates.push({ tableId: conn.subscribedTableId, tableState: tableState(conn.subscribedTableId) });
      }
    }

    connStateBySocket.delete(ws);
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
    tableState,
    cleanupConnection,
    orderedSubscribers
  };
}
