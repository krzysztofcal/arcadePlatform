import { parseAdminUserIds } from "./admin-auth.mjs";
import { postTransaction } from "./chips-ledger.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./poker-idempotency.mjs";
import { parseStakes } from "./poker-stakes.mjs";
import { beginSql, executeSql, klog } from "./supabase-admin.mjs";
import { executeInactiveCleanup } from "../../../shared/poker-domain/inactive-cleanup.mjs";
import { executeTerminalPokerCloseInTx } from "../../../shared/poker-domain/terminal-close.mjs";
import { evaluateTableHealth } from "../../../ws-server/poker/runtime/table-janitor.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const POKER_REQUEST_PENDING_STALE_SEC = 30;

function badRequest(code, message) {
  const error = new Error(message || code);
  error.status = 400;
  error.code = code;
  return error;
}

function notFound(code, message) {
  const error = new Error(message || code);
  error.status = 404;
  error.code = code;
  return error;
}

function conflict(code, message) {
  const error = new Error(message || code);
  error.status = 409;
  error.code = code;
  return error;
}

function parseJsonBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (_error) {
    throw badRequest("invalid_json", "Body must be valid JSON");
  }
}

function parseUuid(value, code = "invalid_id") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!UUID_RE.test(normalized)) {
    throw badRequest(code, code);
  }
  return normalized;
}

function parseOptionalUuid(value) {
  if (value == null || value === "") return null;
  return parseUuid(value);
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parsePageLimit(qs = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const page = parsePositiveInt(qs.page, 1, { min: 1, max: 10_000 });
  const limit = parsePositiveInt(qs.limit, defaultLimit, { min: 1, max: maxLimit });
  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

function buildPagination({ page, limit, total }) {
  const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
  return {
    page,
    limit,
    total: safeTotal,
    totalPages: safeTotal > 0 ? Math.ceil(safeTotal / limit) : 0,
    hasNextPage: page * limit < safeTotal,
    hasPrevPage: page > 1,
  };
}

function parseBoolFlag(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw badRequest("invalid_boolean", "Boolean flag expected");
}

function parseOptionalText(value, { maxLength = 240 } = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "";
  if (normalized.length > maxLength) {
    throw badRequest("text_too_long", "Text too long");
  }
  return normalized;
}

function parseReason(value, fallback) {
  const normalized = parseOptionalText(value, { maxLength: 240 });
  return normalized || String(fallback || "").trim() || "admin_action";
}

function parseIdempotencyKey(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw badRequest("missing_idempotency_key", "Idempotency key is required");
  }
  if (normalized.length > 140) {
    throw badRequest("invalid_idempotency_key", "Idempotency key is too long");
  }
  return normalized;
}

function parseTimestamp(value, code = "invalid_timestamp") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw badRequest(code, code);
  }
  return new Date(parsed).toISOString();
}

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function resolvePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function resolveJanitorConfig(env = process.env) {
  return {
    activeSeatFreshMs: resolvePositiveInt(env.WS_ACTIVE_SEAT_FRESH_MS, 120_000, { min: 1_000, max: 900_000 }),
    seatedReconnectGraceMs: resolvePositiveInt(env.WS_SEATED_RECONNECT_GRACE_MS, 90_000, { min: 1_000, max: 900_000 }),
    tableCloseGraceMs: resolvePositiveInt(env.POKER_TABLE_CLOSE_GRACE_MS, 60_000, { min: 1_000, max: 900_000 }),
    liveHandStaleMs: resolvePositiveInt(env.POKER_LIVE_HAND_STALE_MS, 15_000, { min: 1_000, max: 900_000 }),
  };
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
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function buildTableActionType(action) {
  switch (action) {
    case "stale_seat_cleanup":
      return "ADMIN_TABLE_STALE_SEAT_CLEANUP";
    case "inactive_cleanup":
      return "ADMIN_TABLE_INACTIVE_CLEANUP";
    case "zombie_cleanup":
      return "ADMIN_TABLE_ZOMBIE_CLEANUP";
    case "reconcile":
      return "ADMIN_TABLE_RECONCILE";
    case "force_close":
      return "ADMIN_TABLE_FORCE_CLOSE";
    default:
      return "ADMIN_TABLE_ACTION";
  }
}

function buildTableActionKind(action) {
  switch (action) {
    case "stale_seat_cleanup":
      return "ADMIN_STALE_SEAT_CLEANUP";
    case "inactive_cleanup":
      return "ADMIN_INACTIVE_CLEANUP";
    case "zombie_cleanup":
      return "ADMIN_ZOMBIE_CLEANUP";
    case "reconcile":
      return "ADMIN_RECONCILE";
    case "force_close":
      return "ADMIN_FORCE_CLOSE";
    default:
      return "ADMIN_TABLE_ACTION";
  }
}

function createTableMeta(snapshot = {}) {
  const table = snapshot.table || {};
  const state = normalizeState(snapshot.state);
  const seats = Array.isArray(snapshot.seats) ? snapshot.seats : [];
  const activeSeats = seats.filter((seat) => String(seat?.status || "").toUpperCase() === "ACTIVE");
  const humanSeats = activeSeats.filter((seat) => seat?.is_bot !== true);
  const botSeats = activeSeats.filter((seat) => seat?.is_bot === true);
  const stakesParsed = parseStakes(table.stakes);
  return {
    tableId: table.id || null,
    status: table.status || null,
    stakes: stakesParsed.ok ? stakesParsed.value : null,
    stakesLabel: stakesParsed.ok ? `${stakesParsed.value.sb}/${stakesParsed.value.bb}` : null,
    maxPlayers: Number.isInteger(Number(table.max_players)) ? Number(table.max_players) : null,
    createdAt: table.created_at || null,
    updatedAt: table.updated_at || null,
    lastActivityAt: table.last_activity_at || table.updated_at || table.created_at || null,
    phase: typeof state.phase === "string" ? state.phase : null,
    turnUserId: typeof state.turnUserId === "string" ? state.turnUserId : null,
    playerCount: activeSeats.length,
    humanCount: humanSeats.length,
    botCount: botSeats.length,
    staleHumanSeatCount: humanSeats.filter((seat) => seat.last_seen_at).length,
  };
}

function placeholders(values, start = 1) {
  return values.map((_, index) => `$${start + index}`).join(", ");
}

async function loadPersistedTableSnapshots(tableIds = []) {
  const ids = [...new Set((Array.isArray(tableIds) ? tableIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const tokens = placeholders(ids);
  const tables = await executeSql(
    `
select id, stakes, max_players, status, created_by, created_at, updated_at, last_activity_at
from public.poker_tables
where id in (${tokens});
    `,
    ids,
  );
  const states = await executeSql(
    `
select table_id, version, state, updated_at
from public.poker_state
where table_id in (${tokens});
    `,
    ids,
  );
  const seats = await executeSql(
    `
select table_id, user_id, seat_no, status, is_bot, bot_profile, leave_after_hand, stack, last_seen_at, joined_at, created_at
from public.poker_seats
where table_id in (${tokens})
order by table_id asc, seat_no asc, created_at asc;
    `,
    ids,
  );
  const byId = new Map();
  for (const table of Array.isArray(tables) ? tables : []) {
    byId.set(table.id, { table, seats: [], state: null, stateVersion: null, stateUpdatedAt: null });
  }
  for (const stateRow of Array.isArray(states) ? states : []) {
    const snapshot = byId.get(stateRow.table_id);
    if (!snapshot) continue;
    snapshot.state = stateRow.state || null;
    snapshot.stateVersion = Number.isInteger(Number(stateRow.version)) ? Number(stateRow.version) : null;
    snapshot.stateUpdatedAt = stateRow.updated_at || null;
  }
  for (const seat of Array.isArray(seats) ? seats : []) {
    const snapshot = byId.get(seat.table_id);
    if (!snapshot) continue;
    snapshot.seats.push(seat);
  }
  return byId;
}

async function loadPersistedTableSnapshot(tableId) {
  const snapshots = await loadPersistedTableSnapshots([tableId]);
  return snapshots.get(tableId) || null;
}

async function loadPersistedTableSnapshotTx(tx, tableId) {
  const tableRows = await tx.unsafe(
    `
select id, stakes, max_players, status, created_by, created_at, updated_at, last_activity_at
from public.poker_tables
where id = $1
limit 1
for update;
    `,
    [tableId],
  );
  const table = tableRows?.[0] || null;
  if (!table) return null;
  const stateRows = await tx.unsafe(
    "select table_id, version, state, updated_at from public.poker_state where table_id = $1 limit 1 for update;",
    [tableId],
  );
  const seatRows = await tx.unsafe(
    `
select table_id, user_id, seat_no, status, is_bot, bot_profile, leave_after_hand, stack, last_seen_at, joined_at, created_at
from public.poker_seats
where table_id = $1
order by seat_no asc, created_at asc
for update;
    `,
    [tableId],
  );
  return {
    table,
    seats: Array.isArray(seatRows) ? seatRows : [],
    state: stateRows?.[0]?.state || null,
    stateVersion: Number.isInteger(Number(stateRows?.[0]?.version)) ? Number(stateRows[0].version) : null,
    stateUpdatedAt: stateRows?.[0]?.updated_at || null,
  };
}

function evaluatePersistedTableSnapshot(snapshot, env = process.env) {
  if (!snapshot?.table?.id) {
    throw notFound("table_not_found", "table_not_found");
  }
  const config = resolveJanitorConfig(env);
  return evaluateTableHealth({
    tableId: snapshot.table.id,
    persistedTable: snapshot.table,
    persistedSeats: snapshot.seats || [],
    persistedState: snapshot.state || null,
    runtime: {},
    nowMs: Date.now(),
    activeSeatFreshMs: config.activeSeatFreshMs,
    seatedReconnectGraceMs: config.seatedReconnectGraceMs,
    tableCloseGraceMs: config.tableCloseGraceMs,
    liveHandStaleMs: config.liveHandStaleMs,
  });
}

async function insertTableAdminAction(tx, {
  tableId,
  adminUserId,
  requestId,
  actionType,
  reason,
  classification,
  result,
  requestedAction,
  effectiveAction,
  targetUserId = null,
}) {
  await tx.unsafe(
    `
insert into public.poker_actions (
  table_id,
  user_id,
  action_type,
  request_id,
  phase_from,
  phase_to,
  meta
)
values ($1, $2, $3, $4, $5, $6, $7::jsonb);
    `,
    [
      tableId,
      adminUserId,
      actionType,
      requestId,
      classification?.details?.phase || null,
      result?.closed === true ? "HAND_DONE" : classification?.details?.phase || null,
      JSON.stringify({
        source: "admin_page",
        adminUserId,
        targetUserId,
        targetTableId: tableId,
        requestedAction,
        effectiveAction,
        reason,
        idempotencyKey: requestId,
        classification,
        result,
      }),
    ],
  );
}

async function runCleanupActionInTx(tx, {
  adminUserId,
  tableId,
  requestId,
  requestedAction,
  effectiveAction,
  classification,
  reason,
  env = process.env,
}) {
  const result = await executeInactiveCleanup({
    beginSql: async (fn) => fn(tx),
    tableId,
    userId: effectiveAction === "stale_seat_cleanup" ? classification?.userId || null : null,
    requestId,
    env,
    klog,
    postTransaction: async (payload) => postTransaction({ ...payload, tx }),
    hasConnectedHumanPresence: () => false,
  });
  await insertTableAdminAction(tx, {
    tableId,
    adminUserId,
    requestId,
    actionType: buildTableActionType(requestedAction),
    reason,
    classification,
    result,
    requestedAction,
    effectiveAction,
    targetUserId: classification?.userId || null,
  });
  return {
    ...result,
    classification,
    requestedAction,
    effectiveAction,
  };
}

async function forceCloseTableInTx(tx, {
  adminUserId,
  tableId,
  requestId,
  reason,
  classification,
}) {
  const result = await executeTerminalPokerCloseInTx({
    tx,
    tableId,
    postTransaction,
    createdBy: adminUserId,
    closeReason: "ADMIN_FORCE_CLOSE",
    successStatus: "force_closed",
    klog,
  });
  await insertTableAdminAction(tx, {
    tableId,
    adminUserId,
    requestId,
    actionType: buildTableActionType("force_close"),
    reason,
    classification,
    result,
    requestedAction: "force_close",
    effectiveAction: "force_close",
    targetUserId: null,
  });
  return result;
}

function resolveRequestedTableAction(requestedAction, classification) {
  const normalized = typeof requestedAction === "string" ? requestedAction.trim() : "";
  if (!normalized) {
    throw badRequest("missing_action", "missing_action");
  }
  if (normalized === "reconcile") {
    return {
      requestedAction: normalized,
      effectiveAction: classification?.action || "noop",
    };
  }
  if (!["stale_seat_cleanup", "inactive_cleanup", "zombie_cleanup", "force_close"].includes(normalized)) {
    throw badRequest("invalid_action", "invalid_action");
  }
  if (normalized === "force_close") {
    return { requestedAction: normalized, effectiveAction: normalized };
  }
  if (classification?.action !== normalized) {
    throw conflict("action_not_applicable", "action_not_applicable");
  }
  return {
    requestedAction: normalized,
    effectiveAction: normalized,
  };
}

async function runAdminTableAction({
  adminUserId,
  tableId,
  requestedAction,
  idempotencyKey,
  reason,
  env = process.env,
}) {
  return beginSql(async (tx) => {
    const snapshot = await loadPersistedTableSnapshotTx(tx, tableId);
    if (!snapshot?.table) {
      throw notFound("table_not_found", "table_not_found");
    }
    const classification = evaluatePersistedTableSnapshot(snapshot, env);
    const resolved = resolveRequestedTableAction(requestedAction, classification);
    const requestInfo = await ensurePokerRequest(tx, {
      tableId,
      userId: adminUserId,
      requestId: idempotencyKey,
      kind: buildTableActionKind(resolved.requestedAction),
      pendingStaleSec: POKER_REQUEST_PENDING_STALE_SEC,
    });
    if (requestInfo.status === "stored") {
      return requestInfo.result;
    }
    if (requestInfo.status === "pending") {
      throw conflict("request_pending", "request_pending");
    }
    const effectiveReason = parseReason(reason, `manual ${resolved.requestedAction}`);
    let result = null;
    try {
      if (resolved.effectiveAction === "noop") {
        result = {
          ok: true,
          changed: false,
          skipped: true,
          status: "healthy_noop",
          classification,
          requestedAction: resolved.requestedAction,
          effectiveAction: resolved.effectiveAction,
        };
        await insertTableAdminAction(tx, {
          tableId,
          adminUserId,
          requestId: idempotencyKey,
          actionType: buildTableActionType(resolved.requestedAction),
          reason: effectiveReason,
          classification,
          result,
          requestedAction: resolved.requestedAction,
          effectiveAction: resolved.effectiveAction,
          targetUserId: classification?.userId || null,
        });
      } else if (resolved.effectiveAction === "force_close") {
        result = await forceCloseTableInTx(tx, {
          adminUserId,
          tableId,
          requestId: idempotencyKey,
          reason: effectiveReason,
          classification,
        });
      } else {
        result = await runCleanupActionInTx(tx, {
          adminUserId,
          tableId,
          requestId: idempotencyKey,
          requestedAction: resolved.requestedAction,
          effectiveAction: resolved.effectiveAction,
          classification,
          reason: effectiveReason,
          env,
        });
      }
      if (result?.ok === true || result?.retryable === false) {
        await storePokerRequestResult(tx, {
          tableId,
          userId: adminUserId,
          requestId: idempotencyKey,
          kind: buildTableActionKind(resolved.requestedAction),
          result,
        });
      } else {
        await deletePokerRequest(tx, {
          tableId,
          userId: adminUserId,
          requestId: idempotencyKey,
          kind: buildTableActionKind(resolved.requestedAction),
        });
      }
      return result;
    } catch (error) {
      await deletePokerRequest(tx, {
        tableId,
        userId: adminUserId,
        requestId: idempotencyKey,
        kind: buildTableActionKind(resolved.requestedAction),
      });
      throw error;
    }
  });
}

async function fetchWsHealth(env = process.env, fetchImpl = globalThis.fetch) {
  const baseUrl = typeof env.POKER_WS_INTERNAL_BASE_URL === "string" ? env.POKER_WS_INTERNAL_BASE_URL.trim() : "";
  if (!baseUrl) {
    return { available: false, ok: null, status: null };
  }
  if (typeof fetchImpl !== "function") {
    return { available: true, ok: null, status: null };
  }
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/healthz`, { method: "GET" });
    const body = await response.text().catch(() => "");
    return { available: true, ok: response.ok && body.trim() === "ok", status: response.status };
  } catch (_error) {
    return { available: true, ok: false, status: null };
  }
}

function resolveBuildId(env = process.env) {
  return env.COMMIT_REF || env.BUILD_ID || env.DEPLOY_ID || null;
}

function resolveEnvVisibility(env = process.env) {
  return {
    buildId: resolveBuildId(env),
    chipsEnabled: env.CHIPS_ENABLED === "1",
    adminUserIdsConfigured: parseAdminUserIds(env).length > 0,
    janitorConfig: {
      hasSystemActorUserId: UUID_RE.test(String(env.POKER_SYSTEM_ACTOR_USER_ID || "").trim()),
      hasWsInternalBaseUrl: !!String(env.POKER_WS_INTERNAL_BASE_URL || "").trim(),
      activeSeatFreshMs: resolveJanitorConfig(env).activeSeatFreshMs,
      seatedReconnectGraceMs: resolveJanitorConfig(env).seatedReconnectGraceMs,
      tableCloseGraceMs: resolveJanitorConfig(env).tableCloseGraceMs,
      liveHandStaleMs: resolveJanitorConfig(env).liveHandStaleMs,
      staleSeatSweepMs: resolvePositiveInt(env.WS_STALE_ACTIVE_SEAT_SWEEP_MS, 30_000, { min: 500, max: 60_000 }),
      openTableSweepBatch: resolvePositiveInt(env.WS_OPEN_TABLE_JANITOR_SWEEP_BATCH, 10, { min: 1, max: 100 }),
      zombieSweepBatch: resolvePositiveInt(env.WS_ZOMBIE_TABLE_SWEEP_BATCH, 25, { min: 1, max: 100 }),
    },
  };
}

export {
  UUID_RE,
  badRequest,
  buildPagination,
  conflict,
  createTableMeta,
  escapeLike,
  evaluatePersistedTableSnapshot,
  fetchWsHealth,
  loadPersistedTableSnapshot,
  loadPersistedTableSnapshots,
  notFound,
  parseBoolFlag,
  parseIdempotencyKey,
  parseJsonBody,
  parseOptionalText,
  parseOptionalUuid,
  parsePageLimit,
  parseReason,
  parseTimestamp,
  parseUuid,
  resolveBuildId,
  resolveEnvVisibility,
  resolveJanitorConfig,
  runAdminTableAction,
};
