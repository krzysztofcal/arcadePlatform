import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { deriveCommunityCards, deriveDeck, deriveRemainingDeck } from "./_shared/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "./_shared/poker-hole-cards-store.mjs";
import { buildActionConstraints, computeLegalActions } from "./_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { updatePokerStateOptimistic } from "./_shared/poker-state-write.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";
import { maybeApplyTurnTimeout, normalizeSeatOrderFromState } from "./_shared/poker-turn-timeout.mjs";
import { cardIdentity, isValidTwoCards } from "./_shared/poker-cards-utils.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

const isTurnUserIneligible = (statePublic, userId) => {
  if (!statePublic || typeof userId !== "string" || !userId.trim()) return true;
  if (statePublic?.foldedByUserId?.[userId]) return true;
  if (statePublic?.leftTableByUserId?.[userId]) return true;
  if (statePublic?.sitOutByUserId?.[userId]) return true;
  if ((statePublic?.stacks?.[userId] ?? 0) <= 0) return true;
  return false;
};

const computeLegalActionsWithGuard = ({ statePublic, userId, tableId }) => {
  const legalInfo = computeLegalActions({ statePublic, userId });
  const actionCount = Array.isArray(legalInfo?.actions) ? legalInfo.actions.length : 0;
  if (!isActionPhase(statePublic?.phase)) return { statePublic, legalInfo };
  if (statePublic?.turnUserId !== userId || actionCount > 0) return { statePublic, legalInfo };

  klog("poker_contract_empty_legal_actions", {
    tableId,
    source: "poker_get_table",
    phase: statePublic?.phase || null,
    turnUserId: statePublic?.turnUserId || null,
    folded: !!statePublic?.foldedByUserId?.[statePublic?.turnUserId],
    leftTable: !!statePublic?.leftTableByUserId?.[statePublic?.turnUserId],
    sitOut: !!statePublic?.sitOutByUserId?.[statePublic?.turnUserId],
    stack: statePublic?.turnUserId ? Number(statePublic?.stacks?.[statePublic.turnUserId] ?? 0) : null,
  });

  if (isTurnUserIneligible(statePublic, userId)) {
    throw new Error("contract_mismatch_empty_legal_actions");
  }
  throw new Error("state_invalid");
};

const normalizeSeatUserIds = (seats) => {
  if (!Array.isArray(seats)) return [];
  return seats.map((seat) => seat?.userId).filter((userId) => typeof userId === "string" && userId.trim());
};

const hasSameUserIds = (left, right) => {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== left.length) return false;
  for (const id of right) {
    if (!leftSet.has(id)) return false;
  }
  return true;
};

const MIN_PLAYERS = 2;
const END_PHASE_ADVANCE_LIMIT = 3;
const isSettledPhase = (phase) => phase === "HAND_DONE" || phase === "SETTLED" || phase === "SHOWDOWN";


const parseTableId = (event) => {
  const queryValue = event.queryStringParameters?.tableId;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  const pathValue = typeof event.path === "string" ? event.path.trim() : "";
  if (!pathValue) return "";
  const parts = pathValue.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  if (!last || last === "poker-get-table" || last === ".netlify" || last === "functions") return "";
  if (last === "poker-get-table" || last === "poker-get-table.mjs") return "";
  return last;
};

const cardsSameSet = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const leftKeys = left.map(cardIdentity);
  if (leftKeys.some((key) => !key)) return false;
  leftKeys.sort();
  const rightKeys = right.map(cardIdentity);
  if (rightKeys.some((key) => !key)) return false;
  rightKeys.sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false;
  }
  return true;
};

const buildHoleCardUpsert = ({ tableId, handId, seatUserIdsInOrder, holeCardsByUserId }) => {
  const values = seatUserIdsInOrder.map((userId) => ({ userId, cards: holeCardsByUserId[userId] }));
  const placeholders = values
    .map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}::jsonb)`)
    .join(", ");
  const params = values.flatMap((entry) => [tableId, handId, entry.userId, JSON.stringify(entry.cards)]);
  return { placeholders, params };
};

const repairHoleCards = async ({ tx, tableId, handId, handSeed, seats }) => {
  const seatUserIdsInOrder = normalizeSeatOrderFromState(seats);
  if (seatUserIdsInOrder.length <= 0) {
    throw new Error("state_invalid");
  }
  if (typeof handSeed !== "string" || !handSeed.trim()) {
    throw new Error("state_invalid");
  }

  let deck;
  try {
    deck = deriveDeck(handSeed);
  } catch (error) {
    if (error?.message === "hand_seed_required" || error?.message === "deal_secret_missing") {
      throw new Error("state_invalid");
    }
    throw error;
  }

  const needed = seatUserIdsInOrder.length * 2;
  if (deck.length < needed) {
    throw new Error("state_invalid");
  }
  const holeCardsByUserId = {};
  for (let i = 0; i < seatUserIdsInOrder.length; i += 1) {
    const userId = seatUserIdsInOrder[i];
    holeCardsByUserId[userId] = [deck[i * 2], deck[i * 2 + 1]];
  }
  if (!seatUserIdsInOrder.every((userId) => isValidTwoCards(holeCardsByUserId[userId]))) {
    throw new Error("state_invalid");
  }

  const upsert = buildHoleCardUpsert({ tableId, handId, seatUserIdsInOrder, holeCardsByUserId });
  try {
    await tx.unsafe(
      `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ${upsert.placeholders} on conflict (table_id, hand_id, user_id) do update set cards = excluded.cards;`,
      upsert.params
    );
  } catch (error) {
    if (isHoleCardsTableMissing(error)) {
      throw new Error("state_invalid");
    }
    throw error;
  }

  return { seatCount: seatUserIdsInOrder.length };
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const tableId = parseTableId(event);
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return {
      statusCode: 401,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
  }

  try {
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, stakes, max_players, status, created_by, created_at, updated_at, last_activity_at from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) {
        return { error: "table_not_found" };
      }

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, last_seen_at, joined_at, is_bot, bot_profile, leave_after_hand from public.poker_seats where table_id = $1 order by seat_no asc;",
        [tableId]
      );
      const activeSeatRows = await tx.unsafe(
        "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' and is_bot = false order by seat_no asc;",
        [tableId]
      );

      const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
        tableId,
      ]);
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        klog("poker_state_missing", { tableId });
        throw new Error("poker_state_missing");
      }
      let stateVersion = stateRow.version;
      let expectedVersion = Number(stateVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new Error("state_invalid");
      }

      const seats = Array.isArray(seatRows)
        ? seatRows.map((seat) => ({
            userId: seat.user_id,
            seatNo: seat.seat_no,
            status: seat.status,
            lastSeenAt: seat.last_seen_at,
            joinedAt: seat.joined_at,
            isBot: !!seat.is_bot,
            botProfile: typeof seat.bot_profile === "string" && seat.bot_profile.trim() ? seat.bot_profile : null,
            leaveAfterHand: !!seat.leave_after_hand,
          }))
        : [];

      const currentState = normalizeJsonState(stateRow.state);
      let myHoleCards = [];
      let updatedState = currentState;

      if (isSettledPhase(currentState.phase)) {
        const activeSeats = seats.filter((seat) => seat?.status === "ACTIVE");
        const activeCount = activeSeats.length;
        const humanActiveCount = activeSeats.filter((seat) => !seat?.isBot).length;
        if (humanActiveCount >= 1 && activeCount >= MIN_PLAYERS) {
          let advancedState = currentState;
          let loops = 0;
          while (isSettledPhase(advancedState.phase) && loops < END_PHASE_ADVANCE_LIMIT) {
            const next = advanceIfNeeded(advancedState);
            if (!next?.state || next.state === advancedState) break;
            advancedState = next.state;
            loops += 1;
          }

          if (advancedState !== currentState) {
            const updateResult = await updatePokerStateOptimistic(tx, {
              tableId,
              expectedVersion,
              nextState: advancedState,
            });
            if (updateResult.ok) {
              updatedState = advancedState;
              stateVersion = updateResult.newVersion;
              expectedVersion = updateResult.newVersion;
            } else if (updateResult.reason !== "conflict") {
              throw new Error("state_invalid");
            }
          }
        }
      }

      if (isActionPhase(updatedState.phase)) {
        if (typeof updatedState.handId !== "string" || !updatedState.handId.trim()) {
          throw new Error("state_invalid");
        }
        if (typeof updatedState.handSeed !== "string" || !updatedState.handSeed.trim()) {
          throw new Error("state_invalid");
        }

        const nowMs = Date.now();
        let shouldApplyTimeout =
          Number.isFinite(Number(updatedState.turnDeadlineAt)) && nowMs > updatedState.turnDeadlineAt;

        const dbActiveUserIds = Array.isArray(activeSeatRows)
          ? activeSeatRows.map((row) => row?.user_id).filter(Boolean)
          : [];

        const seatRowsActiveUserIds = Array.isArray(seatRows)
          ? seatRows
              .filter((row) => row?.status === "ACTIVE" && !row?.is_bot)
              .map((row) => row?.user_id)
              .filter(Boolean)
          : [];

        const stateSeatUserIds = normalizeSeatUserIds(updatedState.seats);
        if (stateSeatUserIds.length <= 0) {
          throw new Error("state_invalid");
        }
        const amSeated = stateSeatUserIds.includes(auth.userId);
        let skipHoleCards = false;

        let candidateActiveUserIds = dbActiveUserIds.length ? dbActiveUserIds : seatRowsActiveUserIds;
        if (candidateActiveUserIds.length <= 0) {
          candidateActiveUserIds = stateSeatUserIds;
        }
        if (!hasSameUserIds(candidateActiveUserIds, stateSeatUserIds)) {
          klog("poker_get_table_active_mismatch", {
            tableId,
            dbActiveCount: dbActiveUserIds.length,
            seatRowsActiveCount: seatRowsActiveUserIds.length,
            candidateActiveCount: candidateActiveUserIds.length,
            stateCount: stateSeatUserIds.length,
          });
        }

        if (!amSeated) {
          klog("poker_get_table_user_not_seated", {
            tableId,
            handId: updatedState.handId,
            userId: auth.userId,
            stateSeatCount: stateSeatUserIds.length,
            dbActiveCount: dbActiveUserIds.length,
            seatRowsActiveCount: seatRowsActiveUserIds.length,
          });
          skipHoleCards = true;
        }

        if (!skipHoleCards) {
          let effectiveUserIdsForHoleCards = stateSeatUserIds;
          if (!shouldApplyTimeout && candidateActiveUserIds.length) {
            const overlap = candidateActiveUserIds.filter((userId) => stateSeatUserIds.includes(userId));
            if (overlap.length) {
              effectiveUserIdsForHoleCards = overlap.includes(auth.userId) ? overlap : [...overlap, auth.userId];
            }
          }

          try {
            let holeCards;
            try {
              holeCards = await loadHoleCardsByUserId(tx, {
                tableId,
                handId: updatedState.handId,
                activeUserIds: effectiveUserIdsForHoleCards,
                requiredUserIds: [auth.userId],
                mode: "soft",
              });
            } catch (error) {
              if (isHoleCardsTableMissing(error)) {
                throw new Error("state_invalid");
              }
              throw error;
            }

            const statusByUserId = holeCards.holeCardsStatusByUserId || {};
            const userHoleCardsStatus = statusByUserId[auth.userId] || null;
            if (userHoleCardsStatus) {
              myHoleCards = [];
            } else {
              myHoleCards = holeCards.holeCardsByUserId[auth.userId] || [];
            }

            if (shouldApplyTimeout) {
              const timeoutRequiredUserIds = seatRowsActiveUserIds.length
                ? seatRowsActiveUserIds
                : dbActiveUserIds.length
                  ? dbActiveUserIds
                  : stateSeatUserIds;
              let allHoleCards;
              try {
                allHoleCards = await loadHoleCardsByUserId(tx, {
                  tableId,
                  handId: updatedState.handId,
                  activeUserIds: timeoutRequiredUserIds,
                  requiredUserIds: timeoutRequiredUserIds,
                  mode: "soft",
                });
              } catch (error) {
                klog("poker_get_table_timeout_missing_hole_cards", {
                  tableId,
                  handId: updatedState.handId,
                  expectedCount: timeoutRequiredUserIds.length,
                  attemptedUserIds: timeoutRequiredUserIds,
                });
                shouldApplyTimeout = false;
              }

              if (shouldApplyTimeout) {
                const allStatuses = allHoleCards.holeCardsStatusByUserId || {};
                const hasRequiredStatus = timeoutRequiredUserIds.some((userId) => allStatuses[userId]);
                const hasRequiredCards = timeoutRequiredUserIds.every((userId) =>
                  isValidTwoCards(allHoleCards.holeCardsByUserId?.[userId])
                );
                if (hasRequiredStatus || !hasRequiredCards) {
                  klog("poker_get_table_timeout_missing_hole_cards", {
                    tableId,
                    handId: updatedState.handId,
                    expectedCount: timeoutRequiredUserIds.length,
                    attemptedUserIds: timeoutRequiredUserIds,
                    statusCount: Object.keys(allStatuses).length,
                    validCount: timeoutRequiredUserIds.filter((userId) => isValidTwoCards(allHoleCards.holeCardsByUserId?.[userId])).length,
                  });
                  shouldApplyTimeout = false;
                } else {
                  holeCards = allHoleCards;
                }
              }
            }

            if (shouldApplyTimeout) {
              const stateSeatUserIdsInOrder = normalizeSeatOrderFromState(updatedState.seats);
              const timeoutRequiredUserIds = seatRowsActiveUserIds.length
                ? seatRowsActiveUserIds
                : dbActiveUserIds.length
                  ? dbActiveUserIds
                  : stateSeatUserIds;
              const requiredSet = new Set(timeoutRequiredUserIds);
              const timeoutSeatUserIdsInOrder = stateSeatUserIdsInOrder.filter((id) => requiredSet.has(id));
              if (timeoutSeatUserIdsInOrder.length < 2) {
                klog("poker_get_table_timeout_apply_skipped", {
                  tableId,
                  handId: updatedState.handId,
                  reason: "insufficient_effective_players",
                  effectiveCount: timeoutSeatUserIdsInOrder.length,
                });
                shouldApplyTimeout = false;
              }
            }

            if (shouldApplyTimeout) {
              const stateSeatUserIdsInOrder = normalizeSeatOrderFromState(updatedState.seats);
              const timeoutRequiredUserIds = seatRowsActiveUserIds.length
                ? seatRowsActiveUserIds
                : dbActiveUserIds.length
                  ? dbActiveUserIds
                  : stateSeatUserIds;
              const requiredSet = new Set(timeoutRequiredUserIds);
              const timeoutSeatUserIdsInOrder = stateSeatUserIdsInOrder.filter((id) => requiredSet.has(id));

              const derivedCommunity = deriveCommunityCards({
                handSeed: updatedState.handSeed,
                seatUserIdsInOrder: timeoutSeatUserIdsInOrder,
                communityDealt: updatedState.communityDealt,
              });

              if (!cardsSameSet(updatedState.community, derivedCommunity)) {
                throw new Error("state_invalid");
              }

              const derivedDeck = deriveRemainingDeck({
                handSeed: updatedState.handSeed,
                seatUserIdsInOrder: timeoutSeatUserIdsInOrder,
                communityDealt: updatedState.communityDealt,
              });

              const privateState = {
                ...updatedState,
                community: derivedCommunity,
                deck: derivedDeck,
                holeCardsByUserId: holeCards.holeCardsByUserId,
              };

              const timeoutResult = maybeApplyTurnTimeout({
                tableId,
                state: updatedState,
                privateState,
                nowMs,
              });

              if (timeoutResult.applied) {
                if (
                  !isStateStorageValid(timeoutResult.state, {
                    requireHandSeed: true,
                    requireCommunityDealt: true,
                    requireNoDeck: true,
                  })
                ) {
                  throw new Error("state_invalid");
                }

                // Prevent get-table from hanging on locks during concurrent act/timeout.
                // If we can't acquire locks fast, skip applying timeout in this poll.
                await tx.unsafe("select set_config('lock_timeout', '200ms', true);");
                await tx.unsafe("select set_config('statement_timeout', '4000ms', true);");

                try {
                  const updateResult = await updatePokerStateOptimistic(tx, {
                    tableId,
                    expectedVersion,
                    nextState: timeoutResult.state,
                  });
                  if (!updateResult.ok) {
                    if (updateResult.reason === "conflict") {
                      klog("poker_get_table_timeout_conflict", { tableId, expectedVersion });
                    } else {
                      throw new Error("state_invalid");
                    }
                  } else {
                    const newVersion = updateResult.newVersion;
                    stateVersion = newVersion;
                    expectedVersion = newVersion;

                    await tx.unsafe(
                      "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
                      [
                        tableId,
                        newVersion,
                        timeoutResult.action.userId,
                        timeoutResult.action.type,
                        timeoutResult.action.amount ?? null,
                      ]
                    );

                    updatedState = timeoutResult.state;
                  }
                } catch (e) {
                  const code = String(e?.code || "");
                  if (code === "55P03" || code === "57014") {
                    klog("poker_get_table_timeout_apply_skipped", {
                      tableId,
                      handId: currentState.handId,
                      code,
                    });
                    // Skip applying timeout this request; return current state.
                  } else {
                    throw e;
                  }
                }
              }
            }
          } catch (error) {
            throw error;
          }
        }
      }

      return { table, seats, stateVersion, currentState: updatedState, myHoleCards };
    });

    if (result?.error === "table_not_found") {
      return { statusCode: 404, headers: mergeHeaders(cors), body: JSON.stringify({ error: "table_not_found" }) };
    }

    const table = result.table;
    const seats = result.seats;
    const stateVersion = result.stateVersion;
    let publicState = withoutPrivateState(result.currentState);
    const guarded = computeLegalActionsWithGuard({ statePublic: publicState, userId: auth.userId, tableId });
    publicState = guarded.statePublic;
    const legalInfo = guarded.legalInfo;

    const stakesParsed = parseStakes(table.stakes);
    const tablePayload = {
      id: table.id,
      stakes: stakesParsed.ok ? stakesParsed.value : null,
      maxPlayers: table.max_players,
      status: table.status,
      createdBy: table.created_by,
      createdAt: table.created_at,
      updatedAt: table.updated_at,
      lastActivityAt: table.last_activity_at,
    };

    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
      body: JSON.stringify({
        ok: true,
        table: tablePayload,
        seats,
        state: {
          version: stateVersion,
          state: publicState,
        },
        myHoleCards: Array.isArray(result.myHoleCards) ? result.myHoleCards : [],
        legalActions: legalInfo.actions,
        actionConstraints: buildActionConstraints(legalInfo),
      }),
    };
  } catch (error) {
    if (error?.message === "state_invalid" || error?.message === "contract_mismatch_empty_legal_actions" || isHoleCardsTableMissing(error)) {
      const code = error?.message === "contract_mismatch_empty_legal_actions" ? "contract_mismatch_empty_legal_actions" : "state_invalid";
      return { statusCode: 409, headers: mergeHeaders(cors), body: JSON.stringify({ error: code }) };
    }
    klog("poker_get_table_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
