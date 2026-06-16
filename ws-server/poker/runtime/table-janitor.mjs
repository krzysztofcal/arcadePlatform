const DEFAULT_ACTIVE_SEAT_FRESH_MS = 120_000;
const DEFAULT_SEATED_RECONNECT_GRACE_MS = 90_000;
const DEFAULT_TABLE_CLOSE_GRACE_MS = 60_000;
const DEFAULT_LIVE_HAND_STALE_MS = 15_000;
const LIVE_HAND_PHASES = new Set(["POSTING_BLINDS", "PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]);
const ACTION_HAND_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeStatus(value, fallback = "OPEN") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return normalized || fallback;
}

function normalizeState(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function parseTimestampMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOpenTableJanitorCursor(cursor) {
  const tableId = typeof cursor?.tableId === "string"
    ? cursor.tableId.trim()
    : typeof cursor?.id === "string"
      ? cursor.id.trim()
      : "";
  const updatedAtMs = parseTimestampMs(cursor?.updatedAtMs ?? cursor?.updatedAt ?? cursor?.updated_at);
  if (!tableId || updatedAtMs == null) {
    return null;
  }
  return { tableId, updatedAtMs };
}

function normalizeOpenTableJanitorRow(row) {
  const tableId = typeof row?.tableId === "string"
    ? row.tableId.trim()
    : typeof row?.id === "string"
      ? row.id.trim()
      : "";
  if (!tableId) {
    return null;
  }
  const updatedAtMs = parseTimestampMs(row?.updatedAtMs ?? row?.updatedAt ?? row?.updated_at) ?? 0;
  return { tableId, updatedAtMs };
}

function compareOpenTableJanitorRows(left, right) {
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  return left.tableId.localeCompare(right.tableId);
}

function isOpenTableRowAfterCursor(row, cursor) {
  if (!cursor) {
    return true;
  }
  const compared = compareOpenTableJanitorRows(row, cursor);
  return compared > 0;
}

function hasLiveHandSignal(state) {
  const phase = typeof state?.phase === "string" ? state.phase.trim().toUpperCase() : "";
  return LIVE_HAND_PHASES.has(phase);
}

function listActiveHumanSeats(seats) {
  return (Array.isArray(seats) ? seats : [])
    .filter((seat) => seat?.status === "ACTIVE" && seat?.is_bot !== true)
    .map((seat) => ({
      ...seat,
      user_id: typeof seat?.user_id === "string" ? seat.user_id.trim() : ""
    }))
    .filter((seat) => seat.user_id);
}

function resolveConnectedUserIds(runtime) {
  const value = runtime?.connectedUserIds;
  if (value instanceof Set) {
    return new Set([...value].filter((entry) => typeof entry === "string" && entry.trim()));
  }
  if (Array.isArray(value)) {
    return new Set(value.filter((entry) => typeof entry === "string" && entry.trim()));
  }
  if (value && typeof value === "object") {
    return new Set(Object.keys(value).filter((userId) => value[userId] === true));
  }
  return new Set();
}

function buildConcerns({ tableStatus, runtime }) {
  const concerns = [];
  if (tableStatus !== "OPEN") {
    return concerns;
  }
  if (runtime?.loaded === false) {
    concerns.push("runtime_missing_for_open_table");
  }
  if (runtime?.loaded === true && normalizeStatus(runtime?.tableStatus, "OPEN") === "CLOSED") {
    concerns.push("runtime_closed_while_db_open");
  }
  return concerns;
}

function resolveTableCreatedAtMs(table) {
  return parseTimestampMs(table?.created_at ?? table?.createdAt ?? table?.createdAtMs);
}

function resolveTableLastActivityAtMs(table) {
  return parseTimestampMs(table?.last_activity_at ?? table?.lastActivityAt ?? table?.lastActivityAtMs)
    ?? parseTimestampMs(table?.updated_at ?? table?.updatedAt)
    ?? resolveTableCreatedAtMs(table);
}

function sortSeatsByOldestLastSeen(left, right) {
  const leftLastSeenAtMs = parseTimestampMs(left?.last_seen_at);
  const rightLastSeenAtMs = parseTimestampMs(right?.last_seen_at);
  if (leftLastSeenAtMs == null && rightLastSeenAtMs == null) return 0;
  if (leftLastSeenAtMs == null) return -1;
  if (rightLastSeenAtMs == null) return 1;
  if (leftLastSeenAtMs !== rightLastSeenAtMs) return leftLastSeenAtMs - rightLastSeenAtMs;
  return String(left?.user_id || "").localeCompare(String(right?.user_id || ""));
}

function findStaleHumanSeat({ activeHumanSeats, connectedUserIds, nowMs, activeSeatFreshMs, seatedReconnectGraceMs }) {
  const staleAfterMs = Math.max(
    normalizePositiveInt(activeSeatFreshMs, DEFAULT_ACTIVE_SEAT_FRESH_MS),
    normalizePositiveInt(seatedReconnectGraceMs, DEFAULT_SEATED_RECONNECT_GRACE_MS)
  );
  const orderedSeats = activeHumanSeats.slice().sort(sortSeatsByOldestLastSeen);
  for (const seat of orderedSeats) {
    if (connectedUserIds.has(seat.user_id)) {
      continue;
    }
    const lastSeenAtMs = parseTimestampMs(seat?.last_seen_at);
    if (lastSeenAtMs == null) {
      return {
        userId: seat.user_id,
        reasonCode: "stale_human_last_seen_missing",
        lastSeenAtMs: null,
        staleForMs: null
      };
    }
    const staleForMs = nowMs - lastSeenAtMs;
    if (staleForMs >= staleAfterMs) {
      return {
        userId: seat.user_id,
        reasonCode: "stale_human_last_seen_expired",
        lastSeenAtMs,
        staleForMs
      };
    }
  }
  return null;
}

function resolveLiveHandReasonCode({ state, tableLastActivityAtMs, nowMs, liveHandStaleMs }) {
  if (!hasLiveHandSignal(state)) {
    return null;
  }
  const phase = typeof state?.phase === "string" ? state.phase.trim().toUpperCase() : "";
  if (ACTION_HAND_PHASES.has(phase)) {
    const turnUserId = typeof state?.turnUserId === "string" ? state.turnUserId.trim() : "";
    if (!turnUserId) {
      return "live_hand_missing_turn_user";
    }
    const turnDeadlineAt = Number(state?.turnDeadlineAt);
    if (Number.isFinite(turnDeadlineAt) && turnDeadlineAt > 0 && nowMs >= turnDeadlineAt + liveHandStaleMs) {
      return "live_hand_turn_deadline_expired";
    }
  }
  if (tableLastActivityAtMs != null && nowMs - tableLastActivityAtMs >= liveHandStaleMs) {
    return "live_hand_table_activity_stale";
  }
  return null;
}

function buildClassification({
  tableId,
  healthy,
  classification,
  action,
  reasonCode,
  concerns,
  userId = null,
  details = null
}) {
  return {
    tableId: typeof tableId === "string" ? tableId : null,
    healthy,
    classification,
    action,
    reasonCode,
    concerns: Array.isArray(concerns) ? concerns.slice() : [],
    userId: typeof userId === "string" && userId ? userId : null,
    details: details && typeof details === "object" ? { ...details } : null
  };
}

export function evaluateTableHealth({
  tableId,
  persistedTable = null,
  persistedSeats = [],
  persistedState = null,
  runtime = {},
  nowMs = Date.now(),
  activeSeatFreshMs = DEFAULT_ACTIVE_SEAT_FRESH_MS,
  seatedReconnectGraceMs = DEFAULT_SEATED_RECONNECT_GRACE_MS,
  tableCloseGraceMs = DEFAULT_TABLE_CLOSE_GRACE_MS,
  liveHandStaleMs = DEFAULT_LIVE_HAND_STALE_MS
} = {}) {
  const tableStatus = normalizeStatus(persistedTable?.status, "OPEN");
  const state = normalizeState(persistedState);
  const activeHumanSeats = listActiveHumanSeats(persistedSeats);
  const connectedUserIds = resolveConnectedUserIds(runtime);
  const concerns = buildConcerns({ tableStatus, runtime });
  if (tableStatus !== "OPEN") {
    return buildClassification({
      tableId,
      healthy: true,
      classification: "healthy",
      action: "noop",
      reasonCode: "table_not_open",
      concerns
    });
  }

  const staleHumanSeat = findStaleHumanSeat({
    activeHumanSeats,
    connectedUserIds,
    nowMs,
    activeSeatFreshMs,
    seatedReconnectGraceMs
  });
  if (staleHumanSeat) {
    return buildClassification({
      tableId,
      healthy: false,
      classification: "stale_human_seat",
      action: "stale_seat_cleanup",
      reasonCode: staleHumanSeat.reasonCode,
      concerns,
      userId: staleHumanSeat.userId,
      details: {
        lastSeenAtMs: staleHumanSeat.lastSeenAtMs,
        staleForMs: staleHumanSeat.staleForMs
      }
    });
  }

  const normalizedLiveHandStaleMs = normalizePositiveInt(liveHandStaleMs, DEFAULT_LIVE_HAND_STALE_MS);
  const tableLastActivityAtMs = resolveTableLastActivityAtMs(persistedTable);
  const hasRuntimeHumanPresence = runtime?.hasConnectedHumanPresence === true || connectedUserIds.size > 0;
  const liveHandReasonCode = resolveLiveHandReasonCode({
    state,
    tableLastActivityAtMs,
    nowMs,
    liveHandStaleMs: normalizedLiveHandStaleMs
  });
  if (liveHandReasonCode && !hasRuntimeHumanPresence) {
    return buildClassification({
      tableId,
      healthy: false,
      classification: "abandoned_live_hand",
      action: "inactive_cleanup",
      reasonCode: liveHandReasonCode,
      concerns,
      details: {
        phase: typeof state?.phase === "string" ? state.phase : null,
        turnUserId: typeof state?.turnUserId === "string" ? state.turnUserId : null,
        tableLastActivityAtMs
      }
    });
  }

  if (hasLiveHandSignal(state)) {
    return buildClassification({
      tableId,
      healthy: true,
      classification: "healthy",
      action: "noop",
      reasonCode: activeHumanSeats.length > 0 ? "healthy_live_hand_active" : "healthy_live_hand_preserved",
      concerns,
      details: {
        phase: typeof state?.phase === "string" ? state.phase : null
      }
    });
  }

  if (activeHumanSeats.length === 0) {
    const normalizedCloseGraceMs = normalizePositiveInt(tableCloseGraceMs, DEFAULT_TABLE_CLOSE_GRACE_MS);
    const tableCreatedAtMs = resolveTableCreatedAtMs(persistedTable);
    if (tableCreatedAtMs != null && nowMs - tableCreatedAtMs < normalizedCloseGraceMs) {
      return buildClassification({
        tableId,
        healthy: true,
        classification: "healthy",
        action: "noop",
        reasonCode: "open_table_close_grace",
        concerns,
        details: {
          createdAtMs: tableCreatedAtMs
        }
      });
    }
    return buildClassification({
      tableId,
      healthy: false,
      classification: "open_inert_table",
      action: "zombie_cleanup",
      reasonCode: "open_table_without_active_humans",
      concerns,
      details: {
        tableLastActivityAtMs
      }
    });
  }

  return buildClassification({
    tableId,
    healthy: true,
    classification: "healthy",
    action: "noop",
    reasonCode: concerns.length > 0 ? "healthy_runtime_db_mismatch_observed" : "healthy_active_human_present",
    concerns,
    details: {
      activeHumanCount: activeHumanSeats.length
    }
  });
}

export function selectOpenTableJanitorBatch({
  tables = [],
  limit = 10,
  cursor = null
} = {}) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 10;
  const orderedTables = (Array.isArray(tables) ? tables : [])
    .map(normalizeOpenTableJanitorRow)
    .filter(Boolean)
    .sort(compareOpenTableJanitorRows);
  const normalizedCursor = normalizeOpenTableJanitorCursor(cursor);
  if (orderedTables.length === 0) {
    return {
      tableIds: [],
      batch: [],
      cursor: null,
      wrapped: false,
      total: 0
    };
  }

  let startIndex = 0;
  if (normalizedCursor) {
    const nextIndex = orderedTables.findIndex((row) => isOpenTableRowAfterCursor(row, normalizedCursor));
    startIndex = nextIndex >= 0 ? nextIndex : 0;
  }

  let wrapped = normalizedCursor ? startIndex === 0 : false;
  let batch = orderedTables.slice(startIndex, startIndex + boundedLimit);
  if (batch.length < boundedLimit && orderedTables.length > batch.length) {
    const remaining = Math.min(boundedLimit - batch.length, startIndex);
    if (remaining > 0) {
      batch = batch.concat(orderedTables.slice(0, remaining));
      wrapped = true;
    }
  }

  const nextCursor = batch.length > 0
    ? {
        tableId: batch[batch.length - 1].tableId,
        updatedAtMs: batch[batch.length - 1].updatedAtMs
      }
    : normalizedCursor;
  return {
    tableIds: batch.map((row) => row.tableId),
    batch,
    cursor: nextCursor,
    wrapped,
    total: orderedTables.length
  };
}

export async function runTableJanitor({
  classification,
  trigger = "table_janitor",
  requestId = null,
  primitives = {},
  klog = () => {}
} = {}) {
  const normalizedClassification = classification && typeof classification === "object"
    ? classification
    : buildClassification({
        tableId: null,
        healthy: true,
        classification: "healthy",
        action: "noop",
        reasonCode: "invalid_classification",
        concerns: []
      });
  const action = typeof normalizedClassification?.action === "string" && normalizedClassification.action
    ? normalizedClassification.action
    : "noop";
  klog("ws_table_janitor_classified", {
    tableId: normalizedClassification.tableId || null,
    trigger,
    requestId: requestId || null,
    classification: normalizedClassification.classification || null,
    action,
    reasonCode: normalizedClassification.reasonCode || null,
    userId: normalizedClassification.userId || null,
    healthy: normalizedClassification.healthy === true,
    concerns: Array.isArray(normalizedClassification.concerns) ? normalizedClassification.concerns : []
  });

  if (action === "noop") {
    const result = {
      ok: true,
      changed: false,
      skipped: true,
      status: "healthy_noop",
      reasonCode: normalizedClassification.reasonCode || null
    };
    klog("ws_table_janitor_result", {
      tableId: normalizedClassification.tableId || null,
      trigger,
      requestId: requestId || null,
      action,
      status: result.status,
      ok: true,
      changed: false,
      reasonCode: normalizedClassification.reasonCode || null
    });
    return result;
  }

  const primitive = primitives?.[action];
  if (typeof primitive !== "function") {
    const result = {
      ok: false,
      changed: false,
      code: "janitor_primitive_missing",
      retryable: false,
      status: "primitive_missing"
    };
    klog("ws_table_janitor_result", {
      tableId: normalizedClassification.tableId || null,
      trigger,
      requestId: requestId || null,
      action,
      status: result.status,
      ok: false,
      changed: false,
      reasonCode: normalizedClassification.reasonCode || null,
      code: result.code
    });
    return result;
  }

  const result = await primitive({
    tableId: normalizedClassification.tableId || null,
    userId: normalizedClassification.userId || null,
    trigger,
    requestId,
    reasonCode: normalizedClassification.reasonCode || null,
    classification: normalizedClassification
  });
  klog("ws_table_janitor_result", {
    tableId: normalizedClassification.tableId || null,
    trigger,
    requestId: requestId || null,
    action,
    status: result?.status || null,
    ok: result?.ok === true,
    changed: result?.changed === true,
    reasonCode: normalizedClassification.reasonCode || null,
    code: result?.code || null
  });
  return result;
}
