import { applyCoreEvent, CORE_EVENT_TYPES, createInitialCoreState } from "../core/index.mjs";
import { projectRoomCoreSnapshot } from "../read-model/room-core-snapshot.mjs";
import { normalizePublicPokerIdentity } from "../read-model/public-poker-identity.mjs";
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
  replaceBrokeBotsForNextHand,
  resolveNextDealerSeatNo
} from "../engine/poker-engine.mjs";
import { deriveDeterministicRuntimeHandState } from "../shared/runtime-hand-state.mjs";
import { stampTurnDeadline } from "../shared/poker-turn-timeout.mjs";

const DEFAULT_PRESENCE_TTL_MS = 10_000;
const DEFAULT_MAX_SEATS = 10;
const DEFAULT_ACTION_RESULT_CACHE_MAX = 256;
const DEFAULT_PUBLIC_PROFILE_FRESH_MS = 60_000;
const DEFAULT_PUBLIC_PROFILE_TIMEOUT_MS = 750;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function isCoreStateBotUser(coreState, userId) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) {
    return false;
  }
  const seatDetails = coreState?.seatDetailsByUserId;
  if (!seatDetails || typeof seatDetails !== "object" || Array.isArray(seatDetails)) {
    return false;
  }
  return seatDetails?.[normalizedUserId]?.isBot === true;
}

function isObservedRuntimeDisconnectPresence(presence) {
  const rawExpiresAt = presence?.expiresAt;
  const expiresAt = rawExpiresAt === null || rawExpiresAt === undefined
    ? Number.NaN
    : Number(rawExpiresAt);
  return presence?.connected === false && Number.isFinite(expiresAt);
}

function normalizeHandEligibleMembers({ table, coreState = table?.coreState, nowMs = Date.now() } = {}) {
  const sourceMembers = Array.isArray(coreState?.members) ? coreState.members : [];
  const hasBotMembers = sourceMembers.some((member) => isCoreStateBotUser(coreState, member?.userId));
  const members = sourceMembers
    .map((member) => {
      const userId = typeof member?.userId === "string" ? member.userId.trim() : "";
      const seat = Number.isInteger(member?.seat) ? member.seat : null;
      if (!userId || !Number.isInteger(seat)) {
        return null;
      }
      if (isCoreStateBotUser(coreState, userId)) {
        return { userId, seat };
      }
      const presence = table?.presenceByUserId instanceof Map ? table.presenceByUserId.get(userId) : null;
      const observedRuntimeDisconnect = isObservedRuntimeDisconnectPresence(presence);
      if (!hasBotMembers && observedRuntimeDisconnect) {
        return null;
      }
      if (!hasBotMembers) {
        return { userId, seat };
      }
      const expiresAt = Number(presence?.expiresAt);
      const withinDisconnectGrace = Number.isFinite(expiresAt) && expiresAt > nowMs;
      if (!presence || (presence.connected !== true && !withinDisconnectGrace)) {
        return null;
      }
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

function hasHandEligibleHumanMember({ table, coreState = table?.coreState, nowMs = Date.now() } = {}) {
  const sourceMembers = Array.isArray(coreState?.members) ? coreState.members : [];
  const hasBotMembers = sourceMembers.some((member) => isCoreStateBotUser(coreState, member?.userId));
  return sourceMembers.some((member) => {
    const userId = typeof member?.userId === "string" ? member.userId.trim() : "";
    if (!userId || isCoreStateBotUser(coreState, userId)) {
      return false;
    }
    const presence = table?.presenceByUserId instanceof Map ? table.presenceByUserId.get(userId) : null;
    const observedRuntimeDisconnect = isObservedRuntimeDisconnectPresence(presence);
    if (!hasBotMembers && observedRuntimeDisconnect) {
      return false;
    }
    if (!hasBotMembers) {
      return true;
    }
    const expiresAt = Number(presence?.expiresAt);
    return presence?.connected === true || (Number.isFinite(expiresAt) && expiresAt > nowMs);
  });
}

function buildHandEligibleCoreState({ table, coreState = table?.coreState, nowMs = Date.now() } = {}) {
  const members = normalizeHandEligibleMembers({ table, coreState, nowMs });
  return {
    ...coreState,
    members
  };
}

function normalizeTableStatus(value) {
  if (typeof value !== "string") return "OPEN";
  const normalized = value.trim().toUpperCase();
  return normalized || "OPEN";
}

function normalizeTimestampMs(value) {
  if (Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTableMeta(value, fallbackMaxPlayers, { defaultCreatedAtMs = null, defaultLastActivityAtMs = null } = {}) {
  const maxPlayersRaw = Number(value?.maxPlayers);
  const maxPlayers = Number.isInteger(maxPlayersRaw) && maxPlayersRaw >= 1
    ? maxPlayersRaw
    : fallbackMaxPlayers;
  const stakes = value?.stakes && typeof value.stakes === "object" && !Array.isArray(value.stakes)
    ? {
        sb: Number.isInteger(Number(value.stakes.sb)) ? Number(value.stakes.sb) : null,
        bb: Number.isInteger(Number(value.stakes.bb)) ? Number(value.stakes.bb) : null
      }
    : null;
  const createdAtMs = normalizeTimestampMs(value?.createdAtMs ?? value?.created_at ?? value?.createdAt) ?? defaultCreatedAtMs;
  const lastActivityAtMs = normalizeTimestampMs(value?.lastActivityAtMs ?? value?.last_activity_at ?? value?.lastActivityAt)
    ?? createdAtMs
    ?? defaultLastActivityAtMs
    ?? defaultCreatedAtMs;
  return {
    maxPlayers,
    stakes: stakes && Number.isInteger(stakes.sb) && Number.isInteger(stakes.bb)
      ? stakes
      : null,
    createdAtMs,
    lastActivityAtMs
  };
}

function buildEmptyLobbyPokerState(tableId) {
  return {
    tableId,
    phase: "INIT",
    seats: [],
    stacks: {},
    leftTableByUserId: {},
    waitingForNextHandByUserId: {}
  };
}

function normalizeNumberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readPotTotal(state) {
  return normalizeNumberOrNull(state?.potTotal ?? state?.pot);
}

function readActorStack(state, userId) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !userId) {
    return null;
  }
  return normalizeNumberOrNull(state?.stacks?.[userId]);
}

function buildAcceptedActionAudit({ tableId, coreStateBefore, coreStateAfter, userId, requestId, action, amount, isBot }) {
  const before = coreStateBefore?.pokerState;
  const after = coreStateAfter?.pokerState;
  const handId = typeof before?.handId === "string" && before.handId.trim()
    ? before.handId.trim()
    : (typeof after?.handId === "string" ? after.handId.trim() : "");
  const actionType = typeof action === "string" ? action.trim().toUpperCase() : "";
  const actorUserId = typeof userId === "string" ? userId.trim() : "";
  if (!tableId || !handId || !actorUserId || !actionType) {
    return null;
  }
  const stackBefore = readActorStack(before, actorUserId);
  const stackAfter = readActorStack(after, actorUserId);
  const stackContribution = stackBefore !== null && stackAfter !== null && stackBefore >= stackAfter
    ? stackBefore - stackAfter
    : null;
  const actionAmount = normalizeNumberOrNull(amount);
  const toCall = normalizeNumberOrNull(before?.toCallByUserId?.[actorUserId]);

  return {
    tableId,
    handId,
    actorUserId,
    isBot: isBot === true,
    action: actionType,
    amount: actionAmount !== null ? actionAmount : stackContribution,
    requestId: typeof requestId === "string" && requestId.trim() ? requestId.trim() : null,
    phaseFrom: typeof before?.phase === "string" ? before.phase : null,
    phaseTo: typeof after?.phase === "string" ? after.phase : null,
    stateVersionBefore: Number.isInteger(coreStateBefore?.version) ? coreStateBefore.version : null,
    stateVersionAfter: Number.isInteger(coreStateAfter?.version) ? coreStateAfter.version : null,
    potTotalBefore: readPotTotal(before),
    potTotalAfter: readPotTotal(after),
    currentBetBefore: normalizeNumberOrNull(before?.currentBet),
    currentBetAfter: normalizeNumberOrNull(after?.currentBet),
    toCall,
    actorStackBefore: stackBefore,
    actorStackAfter: stackAfter
  };
}

function needsPersistedBootstrap(table) {
  return table?.pendingPersistedBootstrap === true;
}

export function createTableManager({
  presenceTtlMs = DEFAULT_PRESENCE_TTL_MS,
  maxSeats = DEFAULT_MAX_SEATS,
  actionResultCacheMax = DEFAULT_ACTION_RESULT_CACHE_MAX,
  tableBootstrapLoader = null,
  publicProfileLoader = null,
  publicProfileStorageBaseUrl = "",
  publicProfileFreshMs = DEFAULT_PUBLIC_PROFILE_FRESH_MS,
  publicProfileTimeoutMs = DEFAULT_PUBLIC_PROFILE_TIMEOUT_MS,
  publicProfileLog = null,
  observeOnlyJoin = false,
  enableDebugCore = false,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  const normalizedActionResultCacheMax = Number.isInteger(actionResultCacheMax) && actionResultCacheMax > 0
    ? actionResultCacheMax
    : DEFAULT_ACTION_RESULT_CACHE_MAX;
  const normalizedPublicProfileFreshMs = Number.isFinite(Number(publicProfileFreshMs)) && Number(publicProfileFreshMs) >= 0
    ? Math.trunc(Number(publicProfileFreshMs))
    : DEFAULT_PUBLIC_PROFILE_FRESH_MS;
  const normalizedPublicProfileTimeoutMs = Number.isFinite(Number(publicProfileTimeoutMs)) && Number(publicProfileTimeoutMs) > 0
    ? Math.trunc(Number(publicProfileTimeoutMs))
    : DEFAULT_PUBLIC_PROFILE_TIMEOUT_MS;
  const tables = new Map();
  const pendingBootstrapByTableId = new Map();
  const connStateBySocket = new Map();

  function ensurePublicProfileState(table) {
    if (!table) return;
    if (!table.publicProfilesByUserId || typeof table.publicProfilesByUserId !== "object" || Array.isArray(table.publicProfilesByUserId)) {
      table.publicProfilesByUserId = {};
    }
    if (!Number.isFinite(table.publicProfilesLoadedAtMs)) table.publicProfilesLoadedAtMs = null;
    if (typeof table.publicProfilesSeatFingerprint !== "string") table.publicProfilesSeatFingerprint = "";
    if (!Number.isInteger(table.publicProfilesRefreshGeneration) || table.publicProfilesRefreshGeneration < 0) {
      table.publicProfilesRefreshGeneration = 0;
    }
    if (!table.publicProfilesRefreshPromise || typeof table.publicProfilesRefreshPromise !== "object") {
      table.publicProfilesRefreshPromise = null;
    }
  }

  function buildPublicProfileCandidates(table) {
    const members = Array.isArray(table?.coreState?.members) ? table.coreState.members : [];
    const seatDetails = table?.coreState?.seatDetailsByUserId;
    const configuredMax = Number(table?.tableMeta?.maxPlayers);
    const coreMax = Number(table?.coreState?.maxSeats);
    const capacity = Math.min(
      DEFAULT_MAX_SEATS,
      Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_SEATS,
      Number.isInteger(coreMax) && coreMax > 0 ? coreMax : DEFAULT_MAX_SEATS
    );
    const userIds = [...new Set(members
      .filter((member) => seatDetails?.[member?.userId]?.isBot !== true)
      .map((member) => typeof member?.userId === "string" ? member.userId.trim() : "")
      .filter((userId) => UUID_RE.test(userId)))]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, capacity);
    return { userIds, fingerprint: userIds.join("|") };
  }

  function invalidatePublicProfilesForSeatChange(table) {
    if (!table) return { userIds: [], fingerprint: "" };
    ensurePublicProfileState(table);
    const candidates = buildPublicProfileCandidates(table);
    if (table.publicProfilesSeatFingerprint !== candidates.fingerprint) {
      table.publicProfilesByUserId = {};
      table.publicProfilesLoadedAtMs = null;
      table.publicProfilesSeatFingerprint = candidates.fingerprint;
      table.publicProfilesRefreshGeneration += 1;
    }
    return candidates;
  }

  function publicProfilesForSnapshot(table) {
    const candidates = invalidatePublicProfilesForSeatChange(table);
    const allowed = new Set(candidates.userIds);
    return Object.fromEntries(Object.entries(table?.publicProfilesByUserId || {})
      .filter(([userId]) => allowed.has(userId))
      .map(([userId, profile]) => [userId, normalizePublicPokerIdentity(profile, { storageBaseUrl: publicProfileStorageBaseUrl })])
      .filter(([, profile]) => profile));
  }

  function withProfileTimeout(promise) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("public_profile_timeout")), normalizedPublicProfileTimeoutMs);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function emitPublicProfileLog(data) {
    if (typeof publicProfileLog !== "function") return;
    try {
      publicProfileLog("ws_public_profiles_refresh", data);
    } catch {
      // Profile telemetry must never affect table behavior.
    }
  }

  async function refreshPublicProfiles(tableId, { force = false, nowMs = Date.now() } = {}) {
    const table = tables.get(tableId);
    if (!table) return { ok: true, skipped: true, reason: "table_missing" };
    const candidates = invalidatePublicProfilesForSeatChange(table);
    if (candidates.userIds.length === 0 || typeof publicProfileLoader !== "function") {
      table.publicProfilesByUserId = {};
      table.publicProfilesLoadedAtMs = nowMs;
      return { ok: true, skipped: true, count: 0 };
    }
    const ageMs = Number.isFinite(table.publicProfilesLoadedAtMs) ? nowMs - table.publicProfilesLoadedAtMs : Number.POSITIVE_INFINITY;
    if (!force && ageMs >= 0 && ageMs < normalizedPublicProfileFreshMs) {
      return { ok: true, cached: true, count: Object.keys(table.publicProfilesByUserId).length };
    }
    const inFlight = table.publicProfilesRefreshPromise;
    if (inFlight?.fingerprint === candidates.fingerprint && inFlight?.promise) {
      return inFlight.promise;
    }

    const generation = table.publicProfilesRefreshGeneration;
    const startedAt = Date.now();
    let refreshPromise;
    refreshPromise = (async () => {
      try {
        const loaded = await withProfileTimeout(publicProfileLoader(candidates.userIds));
        const currentTable = tables.get(tableId);
        if (!currentTable) return { ok: true, stale: true, reason: "table_missing" };
        const currentCandidates = invalidatePublicProfilesForSeatChange(currentTable);
        if (currentCandidates.fingerprint !== candidates.fingerprint || currentTable.publicProfilesRefreshGeneration !== generation) {
          return { ok: true, stale: true, reason: "seat_set_changed" };
        }
        const allowedIds = new Set(candidates.userIds);
        const profiles = Object.fromEntries(Object.entries(loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {})
          .filter(([userId]) => allowedIds.has(userId))
          .map(([userId, profile]) => [userId, normalizePublicPokerIdentity(profile, { storageBaseUrl: publicProfileStorageBaseUrl })])
          .filter(([, profile]) => profile));
        currentTable.publicProfilesByUserId = profiles;
        currentTable.publicProfilesLoadedAtMs = nowMs;
        emitPublicProfileLog({
          status: "ok",
          candidates: candidates.userIds.length,
          profiles: Object.keys(profiles).length,
          latencyMs: Date.now() - startedAt
        });
        return { ok: true, count: Object.keys(profiles).length };
      } catch (error) {
        const currentTable = tables.get(tableId);
        if (currentTable) {
          const currentCandidates = invalidatePublicProfilesForSeatChange(currentTable);
          if (currentCandidates.fingerprint === candidates.fingerprint && currentTable.publicProfilesRefreshGeneration === generation) {
            currentTable.publicProfilesLoadedAtMs = null;
          }
        }
        emitPublicProfileLog({
          status: error?.message === "public_profile_timeout" ? "timeout" : "error",
          candidates: candidates.userIds.length,
          latencyMs: Date.now() - startedAt
        });
        return { ok: false, fallback: true, reason: error?.message || "public_profile_load_failed" };
      } finally {
        const currentTable = tables.get(tableId);
        if (currentTable?.publicProfilesRefreshPromise?.promise === refreshPromise) {
          currentTable.publicProfilesRefreshPromise = null;
        }
      }
    })();
    table.publicProfilesRefreshPromise = { fingerprint: candidates.fingerprint, promise: refreshPromise };
    return refreshPromise;
  }
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
      const nowMs = Date.now();
      tables.set(tableId, {
        tableId,
        tableStatus: "OPEN",
        tableMeta: normalizeTableMeta(null, initialCoreState.maxSeats, {
          defaultCreatedAtMs: nowMs,
          defaultLastActivityAtMs: nowMs
        }),
        coreState: initialCoreState,
        persistedStateVersion: Number.isInteger(initialCoreState.version) ? initialCoreState.version : 0,
        pendingPersistedBootstrap: false,
        presenceByUserId: new Map(),
        subscribers: new Set(),
        actionResultsByRequestId: new Map(),
        publicProfilesByUserId: {},
        publicProfilesLoadedAtMs: null,
        publicProfilesSeatFingerprint: "",
        publicProfilesRefreshPromise: null,
        publicProfilesRefreshGeneration: 0
      });
    }
    const table = tables.get(tableId);
    ensurePublicProfileState(table);
    return table;
  }

  function touchTableActivity(table, nowMs = Date.now()) {
    if (!table) {
      return;
    }
    table.tableMeta = normalizeTableMeta(table.tableMeta, table?.coreState?.maxSeats || maxSeats, {
      defaultCreatedAtMs: table?.tableMeta?.createdAtMs ?? nowMs,
      defaultLastActivityAtMs: nowMs
    });
  }

  function materializeLobbyTable({ tableId, tableMeta = null, nowMs = Date.now() } = {}) {
    const normalizedTableId = typeof tableId === "string" ? tableId.trim() : "";
    if (!normalizedTableId) {
      return { ok: false, code: "invalid_table_id" };
    }
    const existed = tables.has(normalizedTableId);
    const table = ensureTable(normalizedTableId);
    if (!existed) {
      table.pendingPersistedBootstrap = true;
    }
    if (!table.coreState?.pokerState || typeof table.coreState.pokerState !== "object" || Array.isArray(table.coreState.pokerState)) {
      table.coreState = {
        ...table.coreState,
        pokerState: buildEmptyLobbyPokerState(normalizedTableId)
      };
    }
    table.tableStatus = normalizeTableStatus(table.tableStatus);
    table.tableMeta = normalizeTableMeta({ ...table.tableMeta, ...(tableMeta || {}) }, table?.coreState?.maxSeats || maxSeats, {
      defaultCreatedAtMs: table?.tableMeta?.createdAtMs ?? nowMs,
      defaultLastActivityAtMs: nowMs
    });
    return { ok: true, existed, table };
  }


  function materializeGuestTable({ tableId, guestUserId, nickname = null, maxPlayers = 6, botCount = 3, stack = 100, nowMs = Date.now() } = {}) {
    const normalizedTableId = typeof tableId === "string" ? tableId.trim() : "";
    const normalizedGuestUserId = typeof guestUserId === "string" ? guestUserId.trim() : "";
    if (!normalizedTableId || !normalizedGuestUserId) {
      return { ok: false, code: "invalid_guest_table" };
    }
    const resolvedMaxPlayers = Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= maxSeats ? maxPlayers : Math.min(6, maxSeats);
    const resolvedBotCount = Math.max(1, Math.min(resolvedMaxPlayers - 1, Number.isInteger(botCount) ? botCount : 3));
    const resolvedStack = Number.isFinite(Number(stack)) && Number(stack) > 0 ? Math.trunc(Number(stack)) : 100;
    const existed = tables.has(normalizedTableId);
    const table = ensureTable(normalizedTableId);
    if (existed && Array.isArray(table.coreState?.members) && table.coreState.members.some((member) => member?.userId === normalizedGuestUserId)) {
      touchTableActivity(table, nowMs);
      return { ok: true, existed: true, table };
    }
    const members = [{ userId: normalizedGuestUserId, seat: 1 }];
    const seats = { [normalizedGuestUserId]: 1 };
    const seatDetailsByUserId = {
      [normalizedGuestUserId]: { isBot: false, botProfile: null, leaveAfterHand: false, nickname }
    };
    const publicStacks = { [normalizedGuestUserId]: resolvedStack };
    for (let idx = 0; idx < resolvedBotCount; idx += 1) {
      const seatNo = idx + 2;
      const botUserId = `bot_guest_${seatNo}_${normalizedTableId}`.slice(0, 120);
      members.push({ userId: botUserId, seat: seatNo });
      seats[botUserId] = seatNo;
      seatDetailsByUserId[botUserId] = {
        isBot: true,
        botProfile: idx % 3 === 0 ? "NORMAL" : idx % 3 === 1 ? "TIGHT" : "LOOSE",
        leaveAfterHand: false
      };
      publicStacks[botUserId] = resolvedStack;
    }
    table.tableStatus = "OPEN";
    table.tableMeta = normalizeTableMeta({ maxPlayers: resolvedMaxPlayers, stakes: { sb: 1, bb: 2 }, createdAtMs: nowMs, lastActivityAtMs: nowMs }, resolvedMaxPlayers, {
      defaultCreatedAtMs: nowMs,
      defaultLastActivityAtMs: nowMs
    });
    table.coreState = {
      ...table.coreState,
      roomId: normalizedTableId,
      maxSeats: resolvedMaxPlayers,
      version: existed ? Number(table.coreState.version || 0) : 0,
      members,
      seats,
      seatDetailsByUserId,
      publicStacks,
      pokerState: buildEmptyLobbyPokerState(normalizedTableId)
    };
    invalidatePublicProfilesForSeatChange(table);
    table.pendingPersistedBootstrap = false;
    touchTableActivity(table, nowMs);
    return { ok: true, existed, table };
  }

  async function ensureTableLoaded(tableId, { allowCreate = false } = {}) {
    const existingTable = tables.get(tableId);
    if (existingTable && !needsPersistedBootstrap(existingTable)) {
      return { ok: true, table: existingTable, cached: true };
    }

    if (pendingBootstrapByTableId.has(tableId)) {
      return pendingBootstrapByTableId.get(tableId);
    }

    const bootstrapPromise = (async () => {
      if (typeof tableBootstrapLoader !== "function") {
        if (existingTable) {
          return { ok: true, table: existingTable, cached: true };
        }
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
      ensurePublicProfileState(loadedTable);
      loadedTable.tableStatus = normalizeTableStatus(loadedTable.tableStatus);
      loadedTable.tableMeta = normalizeTableMeta(loadedTable.tableMeta, loadedTable?.coreState?.maxSeats || maxSeats);
      const loadedVersion = Number(loadedTable?.coreState?.version);
      loadedTable.persistedStateVersion = Number.isInteger(loadedVersion) && loadedVersion >= 0 ? loadedVersion : 0;
      const currentTable = tables.get(tableId);
      if (needsPersistedBootstrap(currentTable)) {
        const restored = restoreTableFromPersisted(tableId, loadedTable);
        if (!restored?.ok) {
          return {
            ok: false,
            code: restored?.reason || "invalid_restored_table",
            message: restored?.reason || "invalid_restored_table"
          };
        }
        await refreshPublicProfiles(tableId, { force: true });
        return { ok: true, table: tables.get(tableId), cached: false };
      }
      loadedTable.pendingPersistedBootstrap = false;
      tables.set(tableId, loadedTable);
      await refreshPublicProfiles(tableId, { force: true });
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
    const tableStatus = table ? normalizeTableStatus(table.tableStatus) : null;
    const roomCore = projectRoomCoreSnapshot({
      tableId,
      roomId,
      coreState: table?.coreState ?? null,
      members,
      userId,
      youSeat,
      tableStatus,
      publicProfilesByUserId: table ? publicProfilesForSnapshot(table) : {},
      publicProfileStorageBaseUrl
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
      status: tableStatus,
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

    const resolvedNowMs = resolveNowMs({ nowMs });
    const existingLiveState = asLiveHandState(table.coreState?.pokerState);
    if (!existingLiveState && !hasHandEligibleHumanMember({ table, nowMs: resolvedNowMs })) {
      return {
        ok: true,
        changed: false,
        bootstrap: "not_eligible",
        stateVersion: table.coreState.version,
        handId: null
      };
    }
    const handEligibleCoreState = existingLiveState
      ? table.coreState
      : buildHandEligibleCoreState({ table, nowMs: resolvedNowMs });
    const result = bootstrapCoreStateHand({ tableId, coreState: handEligibleCoreState, nowMs: resolvedNowMs });
    table.coreState = result.changed && !existingLiveState
      ? {
          ...table.coreState,
          version: result.stateVersion,
          pokerState: result.coreState?.pokerState ?? table.coreState.pokerState
        }
      : result.coreState;
    if (result.changed) {
      touchTableActivity(table, resolvedNowMs);
    }

    return {
      ok: result.ok,
      changed: result.changed,
      bootstrap: result.bootstrap,
      handId: result.handId,
      stateVersion: result.stateVersion
    };
  }

  function applyAction({ tableId, handId, userId, requestId, action, amount, nowIso, nowMs, useActionReplayCache = true }) {
    const table = tables.get(tableId);
    if (!table) {
      return rejectAction({ reason: "table_not_found", stateVersion: 0 });
    }

    const replayKey = makeActionReplayKey({ userId, requestId });
    if (useActionReplayCache && replayKey && table.actionResultsByRequestId.has(replayKey)) {
      return asReplayedResult(table.actionResultsByRequestId.get(replayKey));
    }

    const resolvedNowMs = resolveNowMs({ nowMs });
    const coreStateBefore = table.coreState;
    const applied = applyCoreStateAction({
      tableId,
      coreState: coreStateBefore,
      handId,
      userId,
      action,
      amount,
      nowIso,
      nowMs: resolvedNowMs
    });

    if (!applied.accepted) {
      const rejected = rejectAction({ reason: applied.reason || "action_rejected", stateVersion: applied.stateVersion });
      if (useActionReplayCache) rememberActionResult(table, requestId, { ...rejected, userId });
      return rejected;
    }

    table.coreState = applied.coreState;
    touchTableActivity(table, resolvedNowMs);

    const accepted = {
      ok: true,
      accepted: true,
      changed: true,
      replayed: false,
      reason: null,
      action: applied.action,
      stateVersion: applied.stateVersion,
      handId: applied.handId,
      acceptedActionAudit: buildAcceptedActionAudit({
        tableId,
        coreStateBefore,
        coreStateAfter: applied.coreState,
        userId,
        requestId,
        action: applied.action,
        amount,
        isBot: isCoreStateBotUser(applied.coreState, userId)
      })
    };

    if (useActionReplayCache) rememberActionResult(table, requestId, { ...accepted, userId });

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

    const coreStateBefore = table.coreState;
    let timeoutApplied;
    try {
      timeoutApplied = applyCoreStateTurnTimeout({ tableId, coreState: coreStateBefore, nowMs });
    } catch (error) {
      return {
        ok: false,
        changed: false,
        reason: error?.message || "timeout_apply_failed",
        stateVersion: table.coreState.version
      };
    }
    if (timeoutApplied?.ok === false) {
      return {
        ok: false,
        changed: false,
        reason: timeoutApplied.reason || "timeout_apply_failed",
        stateVersion: table.coreState.version
      };
    }
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
    touchTableActivity(table, nowMs);
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
      stateVersion: timeoutApplied.stateVersion,
      acceptedActionAudit: buildAcceptedActionAudit({
        tableId,
        coreStateBefore,
        coreStateAfter: timeoutApplied.coreState,
        userId: timeoutApplied.actorUserId,
        requestId,
        action: timeoutApplied.action,
        amount: null,
        isBot: isCoreStateBotUser(timeoutApplied.coreState, timeoutApplied.actorUserId)
      })
    };
  }

  function normalizedReplacementFundingShape(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => ({
      seatNo: entry?.seatNo,
      oldBotUserId: entry?.oldBotUserId,
      replacementBotUserId: entry?.replacementBotUserId,
      oldStack: entry?.oldStack,
      targetStack: entry?.targetStack,
      fundingDelta: entry?.fundingDelta,
      settledHandId: entry?.settledHandId,
      fromStateVersion: entry?.fromStateVersion,
      toStateVersion: entry?.toStateVersion
    }));
  }

  function replacementFundingPlansEqual(left, right) {
    return JSON.stringify(normalizedReplacementFundingShape(left)) === JSON.stringify(normalizedReplacementFundingShape(right));
  }

  function replacementFundingReceiptMatches({ tableId, expectedVersion, stateVersion, replacementFundings, persistenceReceipt }) {
    if (!persistenceReceipt || persistenceReceipt.ok !== true) {
      return false;
    }
    if (persistenceReceipt.tableId !== tableId
      || persistenceReceipt.expectedVersion !== expectedVersion
      || persistenceReceipt.newVersion !== stateVersion
      || persistenceReceipt.replacementFundingCommitted !== true) {
      return false;
    }
    const funded = Array.isArray(persistenceReceipt.fundedReplacements)
      ? persistenceReceipt.fundedReplacements
      : [];
    if (funded.length !== replacementFundings.length) {
      return false;
    }
    return replacementFundings.every((entry, index) => {
      const receiptEntry = funded[index];
      const expectedKey = `poker:bot-replacement-buyin:v1:${tableId}:${stateVersion}:${entry.seatNo}`;
      return receiptEntry?.seatNo === entry.seatNo
        && receiptEntry?.idempotencyKey === expectedKey
        && receiptEntry?.fundingDelta === entry.fundingDelta
        && typeof receiptEntry?.transactionId === "string"
        && receiptEntry.transactionId.length > 0
        && typeof receiptEntry?.payloadHash === "string"
        && receiptEntry.payloadHash.length > 0;
    });
  }

  function normalizedHumanStackUpdates({ coreState, settledState, fromStateVersion, toStateVersion }) {
    const members = Array.isArray(coreState?.members) ? coreState.members : [];
    const humanMembers = members.filter((member) => !isCoreStateBotUser(coreState, member?.userId));
    const updates = humanMembers.map((member) => ({
        userId: member.userId,
        seatNo: member.seat,
        stack: Number(settledState?.stacks?.[member.userId]),
        settledHandId: typeof settledState?.handId === "string" ? settledState.handId : null,
        fromStateVersion,
        toStateVersion
      }));
    if (updates.some((entry) => !entry.userId || !Number.isInteger(entry.seatNo) || !Number.isInteger(entry.stack) || entry.stack < 0 || !entry.settledHandId)) {
      return null;
    }
    return updates.sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId));
  }

  function humanStackReceiptMatches({ tableId, expectedVersion, stateVersion, humanStackUpdates, persistenceReceipt }) {
    if (!persistenceReceipt || persistenceReceipt.ok !== true
      || persistenceReceipt.tableId !== tableId
      || persistenceReceipt.expectedVersion !== expectedVersion
      || persistenceReceipt.newVersion !== stateVersion
      || persistenceReceipt.humanStackProjectionCommitted !== true) return false;
    const projected = Array.isArray(persistenceReceipt.projectedHumanStacks) ? persistenceReceipt.projectedHumanStacks : [];
    return JSON.stringify(projected) === JSON.stringify(humanStackUpdates.map(({ userId, seatNo, stack }) => ({ userId, seatNo, stack })));
  }

  function isEconomyFreeRollover({ tableId, economyMode }) {
    return typeof tableBootstrapLoader !== "function"
      || (economyMode === "none" && typeof tableId === "string" && tableId.startsWith("guest_table_"));
  }

  function prepareSettledHandRollover({ tableId, nowMs = Date.now() } = {}) {
    const table = tables.get(tableId);
    if (!table) {
      return { ok: false, changed: false, reason: "table_not_found", stateVersion: 0 };
    }

    const settledState = table.coreState?.pokerState;
    if (!settledState || typeof settledState !== "object" || Array.isArray(settledState)) {
      return { ok: true, changed: false, reason: "state_missing", stateVersion: table.coreState.version };
    }
    if (settledState.phase !== "SETTLED") {
      return { ok: true, changed: false, reason: "hand_not_settled", stateVersion: table.coreState.version };
    }

    const nextVersion = Number(table.coreState.version || 0) + 1;
    const recycled = replaceBrokeBotsForNextHand({
      coreState: table.coreState,
      settledState,
      nextVersion
    });
    if (!recycled?.ok) {
      return {
        ok: false,
        changed: false,
        reason: recycled?.reason || "bot_replacement_invalid",
        stateVersion: table.coreState.version
      };
    }
    if (!hasHandEligibleHumanMember({ table, coreState: recycled.coreState, nowMs })) {
      return {
        ok: true,
        changed: false,
        reason: "not_enough_players",
        stateVersion: table.coreState.version
      };
    }
    const nextHandState = buildNextHandStateFromSettled({
      tableId,
      coreState: buildHandEligibleCoreState({ table, coreState: recycled.coreState, nowMs }),
      settledState: recycled.settledState,
      nextVersion
    });

    if (!nextHandState) {
      return {
        ok: true,
        changed: false,
        reason: "not_enough_players",
        stateVersion: table.coreState.version
      };
    }

    const humanStackUpdates = normalizedHumanStackUpdates({
      coreState: recycled.coreState,
      settledState: recycled.settledState,
      fromStateVersion: Number(table.coreState.version),
      toStateVersion: nextVersion
    });
    if (!humanStackUpdates) {
      return { ok: false, changed: false, reason: "human_stack_ambiguous", stateVersion: table.coreState.version };
    }
    const projectedPublicStacks = { ...(recycled.coreState.publicStacks || {}) };
    for (const update of humanStackUpdates) projectedPublicStacks[update.userId] = update.stack;
    const nextCoreState = {
      ...recycled.coreState,
      version: nextVersion,
      publicStacks: projectedPublicStacks,
      pokerState: stampTurnDeadline(nextHandState, resolveNowMs({ nowMs }))
    };

    return {
      ok: true,
      changed: true,
      reason: null,
      expectedVersion: Number(table.coreState.version),
      stateVersion: nextVersion,
      nextCoreState,
      handId: nextCoreState?.pokerState?.handId ?? null,
      replacementFundings: normalizedReplacementFundingShape(recycled.replacementFundings),
      humanStackUpdates
    };
  }

  function commitSettledHandRollover({
    tableId,
    expectedVersion,
    nextCoreState,
    replacementFundings = [],
    humanStackUpdates = [],
    persistenceReceipt = null,
    economyMode = null,
    nowMs = Date.now()
  } = {}) {
    const table = tables.get(tableId);
    if (!table) {
      return { ok: false, changed: false, reason: "table_not_found", stateVersion: 0 };
    }
    const currentVersion = Number(table.coreState?.version);
    const nextVersion = Number(nextCoreState?.version);
    if (!Number.isInteger(expectedVersion)
      || currentVersion !== expectedVersion
      || nextVersion !== expectedVersion + 1
      || table.coreState?.pokerState?.phase !== "SETTLED") {
      return { ok: false, changed: false, reason: "runtime_version_conflict", stateVersion: currentVersion };
    }

    const recalculated = replaceBrokeBotsForNextHand({
      coreState: table.coreState,
      settledState: table.coreState.pokerState,
      nextVersion
    });
    if (!recalculated?.ok || !replacementFundingPlansEqual(recalculated.replacementFundings, replacementFundings)) {
      return { ok: false, changed: false, reason: "replacement_funding_mismatch", stateVersion: currentVersion };
    }

    const normalizedFundings = normalizedReplacementFundingShape(replacementFundings);
    const economyFree = isEconomyFreeRollover({ tableId, economyMode });
    if (normalizedFundings.length > 0 && !economyFree && !replacementFundingReceiptMatches({
      tableId,
      expectedVersion,
      stateVersion: nextVersion,
      replacementFundings: normalizedFundings,
      persistenceReceipt
    })) {
      return { ok: false, changed: false, reason: "replacement_funding_unconfirmed", stateVersion: currentVersion };
    }
    const expectedHumanUpdates = normalizedHumanStackUpdates({
      coreState: recalculated.coreState,
      settledState: recalculated.settledState,
      fromStateVersion: expectedVersion,
      toStateVersion: nextVersion
    });
    if (!expectedHumanUpdates || JSON.stringify(expectedHumanUpdates) !== JSON.stringify(humanStackUpdates)) {
      return { ok: false, changed: false, reason: "human_stack_projection_mismatch", stateVersion: currentVersion };
    }
    if (!economyFree && !humanStackReceiptMatches({
      tableId,
      expectedVersion,
      stateVersion: nextVersion,
      humanStackUpdates,
      persistenceReceipt
    })) {
      return { ok: false, changed: false, reason: "human_stack_projection_unconfirmed", stateVersion: currentVersion };
    }

    table.coreState = nextCoreState;
    touchTableActivity(table, nowMs);
    return {
      ok: true,
      changed: true,
      reason: null,
      stateVersion: nextVersion,
      handId: nextCoreState?.pokerState?.handId ?? null,
      replacementFundings: normalizedFundings
    };
  }

  function rolloverSettledHand({ tableId, nowMs = Date.now(), economyMode = null } = {}) {
    const prepared = prepareSettledHandRollover({ tableId, nowMs });
    if (!prepared?.ok || !prepared.changed) {
      return prepared;
    }
    const hasFunding = prepared.replacementFundings.length > 0;
    const economyFree = isEconomyFreeRollover({ tableId, economyMode });
    if (hasFunding && !economyFree) {
      return {
        ok: false,
        changed: false,
        reason: "replacement_funding_required",
        stateVersion: prepared.expectedVersion
      };
    }
    return commitSettledHandRollover({
      ...prepared,
      tableId,
      economyMode,
      nowMs
    });
  }

  function sweepTurnTimeouts({ nowMs = Date.now(), shouldProcessTable = null } = {}) {
    const updates = [];
    for (const [tableId] of tables.entries()) {
      if (typeof shouldProcessTable === "function" && shouldProcessTable(tableId) !== true) {
        continue;
      }
      const timeoutResult = maybeApplyTurnTimeout({ tableId, nowMs });
      if (timeoutResult.ok && timeoutResult.changed) {
        updates.push({ tableId, stateVersion: timeoutResult.stateVersion });
      }
    }
    return updates;
  }

  function listDueTurnTimeouts({ nowMs = Date.now(), shouldProcessTable = null } = {}) {
    const due = [];
    for (const [tableId, table] of tables.entries()) {
      if (typeof shouldProcessTable === "function" && shouldProcessTable(tableId) !== true) {
        continue;
      }
      const timeoutDecision = decideCoreStateTurnTimeout({ coreState: table?.coreState, nowMs });
      if (timeoutDecision?.due === true) {
        const turnUserId = typeof timeoutDecision?.decision?.actorUserId === "string"
          ? timeoutDecision.decision.actorUserId
          : (typeof timeoutDecision?.liveState?.turnUserId === "string" ? timeoutDecision.liveState.turnUserId : null);
        due.push({
          tableId,
          stateVersion: timeoutDecision.stateVersion,
          turnUserId,
          isBotTurn: isCoreStateBotUser(table?.coreState, turnUserId)
        });
      }
    }
    return due;
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

  function join({ ws, userId, tableId, requestId, nowTs = Date.now(), authoritativeSeatNo = null, buyIn = null }) {
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
        const currentSeatDetails = table.coreState.seatDetailsByUserId && typeof table.coreState.seatDetailsByUserId === "object" && !Array.isArray(table.coreState.seatDetailsByUserId)
          ? table.coreState.seatDetailsByUserId
          : {};
        const nextSeatDetails = { ...currentSeatDetails, [userId]: currentSeatDetails[userId] || { isBot: false, botProfile: null, leaveAfterHand: false } };
        const currentPublicStacks = table.coreState.publicStacks && typeof table.coreState.publicStacks === "object" && !Array.isArray(table.coreState.publicStacks)
          ? table.coreState.publicStacks
          : {};
        const nextPublicStacks = { ...currentPublicStacks };
        const nextBuyIn = Number.isFinite(Number(buyIn)) && Number(buyIn) > 0 ? Number(buyIn) : null;
        const membershipChanged = !existingMember || existingMember.seat !== authoritativeSeat;
        const stackChanged = nextBuyIn !== null && currentPublicStacks[userId] !== nextBuyIn;
        if (stackChanged) {
          nextPublicStacks[userId] = nextBuyIn;
        }
        const changed = membershipChanged || stackChanged;
        table.coreState = {
          ...table.coreState,
          version: changed ? Number(table.coreState.version || 0) + 1 : table.coreState.version,
          members: nextMembers,
          seats: nextSeats,
          seatDetailsByUserId: nextSeatDetails,
          publicStacks: nextPublicStacks
        };
        invalidatePublicProfilesForSeatChange(table);

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
        touchTableActivity(table, nowTs);
        return {
          ok: true,
          changed,
          effects: changed
            ? [{ type: membershipChanged ? (existingMember ? "member_reseated" : "member_joined") : "public_stack_updated", userId, seat }]
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
        invalidatePublicProfilesForSeatChange(table);
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
    touchTableActivity(table, nowTs);

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
      invalidatePublicProfilesForSeatChange(table);
      effects = leaveResult.effects;
      changed = leaveResult.effects.some((effect) => effect.type === "member_left");
      if (changed) {
        touchTableActivity(table);
      }

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

  function preserveAuthoritativeRuntimePrivateState({ currentPokerState, authoritativePokerState }) {
    const currentState = currentPokerState && typeof currentPokerState === "object" && !Array.isArray(currentPokerState)
      ? currentPokerState
      : null;
    const nextState = authoritativePokerState && typeof authoritativePokerState === "object" && !Array.isArray(authoritativePokerState)
      ? authoritativePokerState
      : null;
    if (!currentState || !nextState) {
      return nextState;
    }

    const currentHandId = typeof currentState.handId === "string" ? currentState.handId.trim() : "";
    const nextHandId = typeof nextState.handId === "string" ? nextState.handId.trim() : "";
    if (!currentHandId || currentHandId !== nextHandId) {
      return nextState;
    }

    const derivedRuntimeHandState = deriveDeterministicRuntimeHandState(nextState);
    if (derivedRuntimeHandState) {
      return {
        ...nextState,
        ...derivedRuntimeHandState
      };
    }

    const leftTableByUserId = nextState.leftTableByUserId && typeof nextState.leftTableByUserId === "object" && !Array.isArray(nextState.leftTableByUserId)
      ? nextState.leftTableByUserId
      : {};
    const sitOutByUserId = nextState.sitOutByUserId && typeof nextState.sitOutByUserId === "object" && !Array.isArray(nextState.sitOutByUserId)
      ? nextState.sitOutByUserId
      : {};
    const pendingAutoSitOutByUserId =
      nextState.pendingAutoSitOutByUserId && typeof nextState.pendingAutoSitOutByUserId === "object" && !Array.isArray(nextState.pendingAutoSitOutByUserId)
        ? nextState.pendingAutoSitOutByUserId
        : {};

    const nextHoleCardsByUserId =
      nextState.holeCardsByUserId && typeof nextState.holeCardsByUserId === "object" && !Array.isArray(nextState.holeCardsByUserId)
        ? { ...nextState.holeCardsByUserId }
        : {};
    const currentHoleCardsByUserId =
      currentState.holeCardsByUserId && typeof currentState.holeCardsByUserId === "object" && !Array.isArray(currentState.holeCardsByUserId)
        ? currentState.holeCardsByUserId
        : {};
    for (const [candidateUserId, cards] of Object.entries(currentHoleCardsByUserId)) {
      if (leftTableByUserId?.[candidateUserId] || sitOutByUserId?.[candidateUserId] || pendingAutoSitOutByUserId?.[candidateUserId]) {
        continue;
      }
      if (Array.isArray(nextHoleCardsByUserId[candidateUserId]) && nextHoleCardsByUserId[candidateUserId].length === 2) {
        continue;
      }
      if (!Array.isArray(cards) || cards.length !== 2) {
        continue;
      }
      nextHoleCardsByUserId[candidateUserId] = cards.slice();
    }

    return {
      ...nextState,
      ...(Object.keys(nextHoleCardsByUserId).length > 0 ? { holeCardsByUserId: nextHoleCardsByUserId } : {}),
      ...(!Array.isArray(nextState.deck) && Array.isArray(currentState.deck) ? { deck: currentState.deck.slice() } : {}),
      ...((typeof nextState.handSeed !== "string" || !nextState.handSeed.trim())
        && typeof currentState.handSeed === "string"
        && currentState.handSeed.trim()
        ? { handSeed: currentState.handSeed }
        : {})
    };
  }

  function buildAuthoritativeLeaveRestore({ tableId, userId, stateVersion = null, pokerState = null, tableStatus = null }) {
    const table = ensureTable(tableId);
    const normalizedState = pokerState && typeof pokerState === "object" && !Array.isArray(pokerState) ? pokerState : null;
    const stateTableId = typeof normalizedState?.tableId === "string" ? normalizedState.tableId : "";
    const stateSeats = normalizedState?.seats;
    const leftTableByUserId = normalizedState?.leftTableByUserId && typeof normalizedState.leftTableByUserId === "object" && !Array.isArray(normalizedState.leftTableByUserId)
      ? normalizedState.leftTableByUserId
      : {};
    const leavingUserRetainedInState = authoritativeSeatsContainUser(stateSeats, userId) && leftTableByUserId?.[userId] === true;
    const authoritativeStateValid = normalizedState
      && stateTableId === tableId
      && hasValidAuthoritativeSeats(stateSeats);

    if (!authoritativeStateValid || (authoritativeSeatsContainUser(stateSeats, userId) && !leavingUserRetainedInState)) {
      return {
        ok: false,
        code: "authoritative_state_invalid"
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
        const nextUserId = typeof seatEntry?.userId === "string" ? seatEntry.userId.trim() : "";
        if (!Number.isInteger(normalizedSeat) || !nextUserId) {
          return null;
        }
        return {
          userId: nextUserId,
          seat: normalizedSeat,
          seatEntry
        };
      })
      .filter(Boolean)
      .filter((member) => leftTableByUserId?.[member.userId] !== true)
      .sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));

    const nextSeats = {};
    const currentSeatDetails = table.coreState.seatDetailsByUserId && typeof table.coreState.seatDetailsByUserId === "object" && !Array.isArray(table.coreState.seatDetailsByUserId)
      ? table.coreState.seatDetailsByUserId
      : {};
    const nextSeatDetails = {};
    for (const member of nextMembers) {
      nextSeats[member.userId] = member.seat;
      const previousSeatDetails = currentSeatDetails[member.userId];
      nextSeatDetails[member.userId] = {
        isBot: member.seatEntry?.isBot === true || previousSeatDetails?.isBot === true,
        botProfile: typeof member.seatEntry?.botProfile === "string"
          ? member.seatEntry.botProfile
          : previousSeatDetails?.botProfile ?? null,
        leaveAfterHand: member.seatEntry?.leaveAfterHand === true || previousSeatDetails?.leaveAfterHand === true
      };
    }

    const authoritativeStacks = normalizedState?.stacks && typeof normalizedState.stacks === "object" && !Array.isArray(normalizedState.stacks)
      ? normalizedState.stacks
      : null;
    const currentPublicStacks = table.coreState.publicStacks && typeof table.coreState.publicStacks === "object" && !Array.isArray(table.coreState.publicStacks)
      ? table.coreState.publicStacks
      : {};
    const nextPublicStacks = {};
    for (const member of nextMembers) {
      const authoritativeAmount = authoritativeStacks?.[member.userId];
      if (Number.isFinite(Number(authoritativeAmount))) {
        nextPublicStacks[member.userId] = Number(authoritativeAmount);
        continue;
      }
      if (Number.isFinite(Number(currentPublicStacks[member.userId]))) {
        nextPublicStacks[member.userId] = Number(currentPublicStacks[member.userId]);
      }
    }

    const nextPresenceByUserId = new Map();
    for (const [presenceUserId, presence] of table.presenceByUserId.entries()) {
      if (!Object.prototype.hasOwnProperty.call(nextSeats, presenceUserId)) {
        continue;
      }
      nextPresenceByUserId.set(presenceUserId, {
        ...presence,
        seat: nextSeats[presenceUserId]
      });
    }

    return {
      ok: true,
      restoredTable: {
        tableId,
        tableStatus: typeof tableStatus === "string" && tableStatus.trim()
          ? normalizeTableStatus(tableStatus)
          : table.tableStatus,
        coreState: {
          ...table.coreState,
          version: Number.isInteger(stateVersion) && stateVersion >= 0 ? stateVersion : table.coreState.version,
          members: nextMembers.map(({ userId: nextUserId, seat }) => ({ userId: nextUserId, seat })),
          seats: nextSeats,
          seatDetailsByUserId: nextSeatDetails,
          publicStacks: nextPublicStacks,
          pokerState: preserveAuthoritativeRuntimePrivateState({
            currentPokerState: table.coreState?.pokerState,
            authoritativePokerState: { ...normalizedState }
          })
        },
        presenceByUserId: nextPresenceByUserId
      }
    };
  }

  function syncAuthoritativeLeave({ ws, userId, tableId, stateVersion = null, pokerState = null, tableStatus = null }) {
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
    const previousTableStatus = normalizeTableStatus(table.tableStatus);
    const restored = buildAuthoritativeLeaveRestore({
      tableId: resolvedTableId,
      userId,
      stateVersion,
      pokerState,
      tableStatus
    });
    if (!restored?.ok || !restored?.restoredTable) {
      return {
        ok: false,
        code: restored?.code || "authoritative_state_invalid",
        changed: false,
        tableState: tableState(resolvedTableId)
      };
    }
    const nextMembers = restored.restoredTable.coreState.members;
    const nextSeats = restored.restoredTable.coreState.seats;
    table.coreState = restored.restoredTable.coreState;
    table.tableStatus = restored.restoredTable.tableStatus;
    table.presenceByUserId = restored.restoredTable.presenceByUserId;
    invalidatePublicProfilesForSeatChange(table);
    touchTableActivity(table);

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
    const nextTableStatus = normalizeTableStatus(table.tableStatus);
    const changed = previousMembers !== nextMembersJson
      || previousSeats !== nextSeatsJson
      || previousVersion !== nextVersion
      || previousPokerState !== nextPokerState
      || previousTableStatus !== nextTableStatus;

    return {
      ok: true,
      changed,
      tableState: tableState(resolvedTableId)
    };
  }

  function subscribe({ ws, tableId, userId = null, nowTs = Date.now() }) {
    const conn = ensureConn(ws);
    if (conn.subscribedTableId && conn.subscribedTableId !== tableId) {
      return { ok: false, code: "one_table_per_connection", message: "Connection is already subscribed to a different table" };
    }

    const table = ensureTable(tableId);
    table.subscribers.add(ws);
    conn.subscribedTableId = tableId;
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    const member = normalizedUserId
      ? table.coreState.members.find((entry) => entry?.userId === normalizedUserId) ?? null
      : null;
    if (member) {
      const seat = Number.isInteger(member.seat) ? member.seat : table.coreState.seats?.[normalizedUserId];
      const existingPresence = table.presenceByUserId.get(normalizedUserId);
      if (existingPresence) {
        existingPresence.seat = seat;
        markConnected(existingPresence, nowTs);
      } else {
        table.presenceByUserId.set(normalizedUserId, {
          userId: normalizedUserId,
          seat,
          connected: true,
          lastSeenAt: nowTs,
          expiresAt: null
        });
      }
      conn.joinedTableId = tableId;
      touchTableActivity(table, nowTs);
    }

    return {
      ok: true,
      reattached: Boolean(member),
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
              invalidatePublicProfilesForSeatChange(table);
              table.presenceByUserId.delete(userId);
              membershipChanged = leaveResult.effects.some((effect) => effect.type === "member_left");
              if (membershipChanged) {
                touchTableActivity(table, nowTs);
              }
            }
          } else if (member.connected) {
            markDisconnected(member, nowTs);
            membershipChanged = true;
          }
        }

        table.subscribers.delete(ws);

        if (membershipChanged) {
          updates.push({ tableId: joinedTableId, tableState: tableState(joinedTableId), disconnectedUserId: userId });
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
      let shouldEmitUpdate = false;
      if (table) {
        table.subscribers.delete(ws);
        shouldEmitUpdate = persistedPokerState(subscribedTableId)?.phase === "SETTLED";
        if (table.coreState.members.length === 0 && table.subscribers.size === 0) {
          tables.delete(subscribedTableId);
        }
      }
      conn.subscribedTableId = null;
      if (shouldEmitUpdate) {
        updates.push({ tableId: subscribedTableId, tableState: tableState(subscribedTableId), disconnectedUserId: null });
      }
    }

    connStateBySocket.delete(ws);
    return updates;
  }

  function sweepExpiredPresence({ nowTs = Date.now() } = {}) {
    const updates = [];
    for (const [tableId, table] of tables.entries()) {
      const expiredUserIds = [];
      for (const [userId, member] of table.presenceByUserId.entries()) {
        if (!member.connected && typeof member.expiresAt === "number" && member.expiresAt <= nowTs) {
          expiredUserIds.push(userId);
        }
      }
      for (const userId of expiredUserIds) {
        table.presenceByUserId.delete(userId);
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

  function privatePokerStateForAudit(tableId) {
    const state = persistedPokerState(tableId);
    if (!state) {
      return null;
    }
    if (state.holeCardsByUserId && typeof state.holeCardsByUserId === "object" && !Array.isArray(state.holeCardsByUserId)) {
      return state;
    }
    const derivedRuntimeHandState = deriveDeterministicRuntimeHandState(state);
    return derivedRuntimeHandState
      ? { ...state, ...derivedRuntimeHandState }
      : state;
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
    table.tableStatus = normalizeTableStatus(restoredTable?.tableStatus);
    table.tableMeta = normalizeTableMeta(restoredTable?.tableMeta ?? table.tableMeta, restoredCoreState.maxSeats, {
      defaultCreatedAtMs: table?.tableMeta?.createdAtMs ?? Date.now(),
      defaultLastActivityAtMs: table?.tableMeta?.lastActivityAtMs ?? Date.now()
    });
    table.persistedStateVersion = Number.isInteger(restoredCoreState.version) && restoredCoreState.version >= 0
      ? restoredCoreState.version
      : table.persistedStateVersion;
    table.pendingPersistedBootstrap = false;
    table.presenceByUserId = nextPresenceByUserId;
    table.actionResultsByRequestId.clear();
    invalidatePublicProfilesForSeatChange(table);
    return { ok: true };
  }

  function evictTable(tableId) {
    const existed = tables.delete(tableId);
    return { ok: true, existed };
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

  function isTableClosed(tableId) {
    const table = tables.get(tableId);
    return normalizeTableStatus(table?.tableStatus) === "CLOSED";
  }

  function isBotUser(tableId, userId) {
    const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
    if (!normalizedUserId) {
      return false;
    }
    const table = tables.get(tableId);
    return isCoreStateBotUser(table?.coreState, normalizedUserId);
  }

  function hasActiveHumanMember(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return false;
    }
    const members = Array.isArray(table?.coreState?.members) ? table.coreState.members : [];
    return members.some((member) => !isBotUser(tableId, member?.userId));
  }

  function hasConnectedHumanPresence(tableId) {
    for (const [socket, conn] of connStateBySocket.entries()) {
      if (conn?.joinedTableId === tableId || conn?.subscribedTableId === tableId) {
        if (socket?.__connState?.sessionInvalidated === true) {
          continue;
        }
        return true;
      }
    }
    return false;
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

  function listTableIds() {
    return [...tables.keys()].sort((left, right) => left.localeCompare(right));
  }

  function tableMeta(tableId) {
    const table = tables.get(tableId);
    if (!table) {
      return null;
    }
    return normalizeTableMeta(table.tableMeta, table?.coreState?.maxSeats || maxSeats);
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
    refreshPublicProfiles,
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
    prepareSettledHandRollover,
    commitSettledHandRollover,
    rolloverSettledHand,
    maybeApplyTurnTimeout,
    sweepTurnTimeouts,
    listDueTurnTimeouts,
    cleanupConnection,
    orderedSubscribers,
    orderedConnectionsForTable,
    listTableIds,
    tableMeta,
    materializeLobbyTable,
    materializeGuestTable,
    resolveImplicitLeaveTableId,
    sweepExpiredPresence,
    persistedPokerState,
    privatePokerStateForAudit,
    persistedStateVersion,
    setPersistedStateVersion,
    restoreTableFromPersisted,
    evictTable,
    buildAuthoritativeLeaveRestore,
    isTableClosed,
    isBotUser,
    hasActiveHumanMember,
    hasConnectedHumanPresence
  };

  if (enableDebugCore && nodeEnv !== "production") {
    manager.__debugCore = __debugCore;
    manager.__debugPokerState = __debugPokerState;
  }

  return manager;
}
