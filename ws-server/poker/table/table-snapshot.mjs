import { beginSql, klog } from "../persistence/sql-admin.mjs";
import { deriveCommunityCards, deriveDeck, deriveRemainingDeck } from "../snapshot-runtime/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../snapshot-runtime/poker-hole-cards-store.mjs";
import { buildActionConstraints, computeLegalActions } from "../snapshot-runtime/poker-legal-actions.mjs";
import { normalizeJsonState, withoutPrivateState } from "../snapshot-runtime/poker-state-utils.mjs";
import { normalizeSeatOrderFromState } from "../snapshot-runtime/poker-turn-timeout.mjs";

const KNOWN_SNAPSHOT_FAILURE_CODES = new Set([
  "invalid_table_id",
  "table_not_found",
  "state_missing",
  "state_invalid",
  "contract_mismatch_empty_legal_actions"
]);

function normalizeKnownSnapshotFailureCode(code) {
  const normalized = typeof code === "string" ? code.trim() : "";
  return KNOWN_SNAPSHOT_FAILURE_CODES.has(normalized) ? normalized : "";
}

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

const isTurnUserIneligible = (statePublic, userId) => {
  if (!statePublic || typeof userId !== "string" || !userId.trim()) return true;
  if (statePublic?.foldedByUserId?.[userId]) return true;
  if (statePublic?.leftTableByUserId?.[userId]) return true;
  if (statePublic?.sitOutByUserId?.[userId]) return true;
  if ((statePublic?.stacks?.[userId] ?? 0) <= 0) return true;
  return false;
};

function computeLegalActionsWithGuard({ statePublic, userId, tableId }) {
  const legalInfo = computeLegalActions({ statePublic, userId });
  const actionCount = Array.isArray(legalInfo?.actions) ? legalInfo.actions.length : 0;
  if (!isActionPhase(statePublic?.phase)) return { ok: true, legalInfo };
  if (statePublic?.turnUserId !== userId || actionCount > 0) return { ok: true, legalInfo };

  klog("ws_table_snapshot_empty_legal_actions", {
    tableId,
    phase: statePublic?.phase || null,
    turnUserId: statePublic?.turnUserId || null,
    folded: !!statePublic?.foldedByUserId?.[statePublic?.turnUserId],
    leftTable: !!statePublic?.leftTableByUserId?.[statePublic?.turnUserId],
    sitOut: !!statePublic?.sitOutByUserId?.[statePublic?.turnUserId],
    stack: statePublic?.turnUserId ? Number(statePublic?.stacks?.[statePublic.turnUserId] ?? 0) : null
  });

  return { ok: false, code: isTurnUserIneligible(statePublic, userId) ? "contract_mismatch_empty_legal_actions" : "state_invalid" };
}

function normalizeTableId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSeats(seatRows) {
  if (!Array.isArray(seatRows)) return [];
  return seatRows.map((seat) => ({
    userId: seat?.user_id,
    seatNo: seat?.seat_no,
    status: seat?.status,
    isBot: !!seat?.is_bot
  }));
}

function applyDerivedCards(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const handSeed = typeof state.handSeed === "string" ? state.handSeed.trim() : "";
  const seatOrder = normalizeSeatOrderFromState(state.seats);
  const communityDealt = Number.isInteger(state.communityDealt) ? state.communityDealt : Array.isArray(state.community) ? state.community.length : 0;

  if (!handSeed || seatOrder.length <= 0) {
    return state;
  }

  const out = { ...state };
  try {
    out.deck = deriveDeck(handSeed);
    out.community = deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt });
    out.remainingDeck = deriveRemainingDeck({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt });
  } catch {
    return state;
  }

  return out;
}

async function loadSnapshotInTx({ tx, tableId, userId }) {
  const tableRows = await tx.unsafe("select id from public.poker_tables where id = $1 limit 1;", [tableId]);
  if (!tableRows?.[0]) {
    return { ok: false, code: "table_not_found" };
  }

  const seatRows = await tx.unsafe(
    "select user_id, seat_no, status, is_bot from public.poker_seats where table_id = $1 order by seat_no asc;",
    [tableId]
  );
  const activeSeatRows = await tx.unsafe(
    "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' and is_bot = false order by seat_no asc;",
    [tableId]
  );
  const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
  const stateRow = stateRows?.[0] || null;
  if (!stateRow) {
    return { ok: false, code: "state_missing" };
  }

  const stateVersion = Number(stateRow.version);
  const updatedState = normalizeJsonState(stateRow.state);

  const stateSeatUserIds = normalizeSeatOrderFromState(updatedState.seats);
  const activeUserIds = Array.isArray(activeSeatRows)
    ? activeSeatRows.map((row) => row?.user_id).filter(Boolean)
    : stateSeatUserIds;

  let holeCardsByUserId = {};
  try {
    const loadedHoleCards = await loadHoleCardsByUserId(tx, {
      tableId,
      handId: updatedState.handId,
      activeUserIds: activeUserIds.length ? activeUserIds : stateSeatUserIds,
      requiredUserIds: activeUserIds.length ? activeUserIds : stateSeatUserIds,
      mode: "strict"
    });
    holeCardsByUserId = loadedHoleCards?.holeCardsByUserId || {};
  } catch (error) {
    if (!isHoleCardsTableMissing(error)) {
      throw error;
    }
  }

  // Snapshot requests are reads. Expired decisions are committed exclusively
  // by the authoritative per-table timeout queue, never by this DB projection.
  const seats = normalizeSeats(seatRows);
  const amSeated = seats.some((seat) => seat.status === "ACTIVE" && !seat.isBot && seat.userId === userId);
  const withDerived = applyDerivedCards(updatedState);
  const statePublic = withoutPrivateState(withDerived);
  const legal = computeLegalActionsWithGuard({ statePublic, userId, tableId });
  if (!legal.ok) {
    return { ok: false, code: legal.code };
  }

  return {
    ok: true,
    snapshot: {
      tableId,
      state: {
        version: stateVersion,
        state: statePublic
      },
      myHoleCards: amSeated ? holeCardsByUserId?.[userId] || [] : [],
      legalActions: Array.isArray(legal.legalInfo?.actions) ? legal.legalInfo.actions : [],
      actionConstraints: buildActionConstraints(legal.legalInfo),
      viewer: {
        userId,
        seated: amSeated
      }
    }
  };
}

function parseFixtureEnv(fixturesJson) {
  if (typeof fixturesJson !== "string" || fixturesJson.trim() === "") return null;
  try {
    return JSON.parse(fixturesJson);
  } catch {
    return null;
  }
}

export function createTableSnapshotLoader({ env = process.env } = {}) {
  const fixtureMap = parseFixtureEnv(env.WS_TABLE_SNAPSHOT_FIXTURES_JSON);

  return async function loadTableSnapshot({ tableId, userId, nowMs = Date.now() }) {
    const normalizedTableId = normalizeTableId(tableId);
    if (!normalizedTableId) {
      return { ok: false, code: "invalid_table_id" };
    }

    if (fixtureMap && fixtureMap[normalizedTableId]) {
      const fixture = fixtureMap[normalizedTableId];
      if (fixture && typeof fixture === "object" && fixture.ok === false && typeof fixture.code === "string") {
        const fixtureCode = normalizeKnownSnapshotFailureCode(fixture.code);
        return { ok: false, code: fixtureCode || "snapshot_failed" };
      }
      const snapshot = typeof fixture === "function" ? fixture({ userId }) : fixture;
      return { ok: true, snapshot: { ...snapshot, tableId: normalizedTableId } };
    }

    try {
      return await beginSql((tx) => loadSnapshotInTx({ tx, tableId: normalizedTableId, userId, nowMs }));
    } catch (error) {
      const message = String(error?.message || "unknown").trim();
      klog("ws_table_snapshot_error", { tableId: normalizedTableId, message: message || "unknown" });
      const code = normalizeKnownSnapshotFailureCode(message);
      if (code) return { ok: false, code };
      return { ok: false, code: "snapshot_failed" };
    }
  };
}

export { loadSnapshotInTx };
