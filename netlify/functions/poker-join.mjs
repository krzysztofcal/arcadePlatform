import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { HEARTBEAT_INTERVAL_SEC, isValidUuid } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";
import { isStateStorageValid } from "./_shared/poker-state-utils.mjs";
import { patchLeftTableByUserId } from "./_shared/poker-left-flag.mjs";
import { clearMissedTurns } from "./_shared/poker-missed-turns.mjs";
import { patchSitOutByUserId } from "./_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "./_shared/poker-state-write-locked.mjs";
import { computeTargetBotCount, getBotConfig, makeBotSystemKey, makeBotUserId } from "./_shared/poker-bots.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";
import { shouldSeedBotsOnJoin } from "./_shared/poker-table-lifecycle.mjs";

const REQUEST_PENDING_STALE_SEC = 30;
const UNIQUE_VIOLATION = "23505";

const isUniqueViolation = (err) => err?.code === UNIQUE_VIOLATION;

const BUY_IN_IDEMPOTENCY_CONSTRAINT = "chips_transactions_idempotency_key_unique";

const isBuyInIdempotencyDuplicate = (err) => {
  if (!isUniqueViolation(err)) return false;
  const constraint = String(err?.constraint || "");
  const message = String(err?.message || "");
  return constraint === BUY_IN_IDEMPOTENCY_CONSTRAINT || message.includes(BUY_IN_IDEMPOTENCY_CONSTRAINT);
};

const classifySeatInsertConflict = (err) => {
  if (!isUniqueViolation(err)) return null;
  const constraint = String(err?.constraint || "").toLowerCase();
  const detail = String(err?.detail || "").toLowerCase();
  if (constraint.includes("seat_no")) return "seat_taken";
  if (constraint.includes("user_id")) return "already_seated";
  if (detail.includes("seat_no")) return "seat_taken";
  if (detail.includes("user_id")) return "already_seated";
  return "unique_unknown";
};

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const parseSeatNo = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
};

const parseAutoSeat = (value) => {
  if (value == null) return false;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "y") return true;
    if (v === "false" || v === "0" || v === "no" || v === "n") return false;
  }
  if (typeof value === "number") return value === 1;
  return false;
};

const parseBuyIn = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
};

const parseSeats = (value) => (Array.isArray(value) ? value : []);

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const SETTLED_PHASES = new Set(["HAND_DONE", "SETTLED"]);
const isHandInProgress = (phase) => typeof phase === "string" && phase !== "INIT" && !SETTLED_PHASES.has(phase);

const pruneUserFromHandSeats = (state, userId) => {
  const handSeats = Array.isArray(state?.handSeats) ? state.handSeats : null;
  if (!handSeats) return { changed: false, nextState: state };
  const nextHandSeats = handSeats.filter((seat) => seat?.userId !== userId);
  if (nextHandSeats.length === handSeats.length) return { changed: false, nextState: state };
  return { changed: true, nextState: { ...state, handSeats: nextHandSeats } };
};

const toDbSeatNo = (seatNoUi, maxPlayers) => {
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2) return null;
  if (!Number.isInteger(seatNoUi)) return null;
  let clampedUi = seatNoUi;
  if (clampedUi < 0) clampedUi = 0;
  if (clampedUi > maxPlayers - 1) clampedUi = maxPlayers - 1;
  const seatNoDb = clampedUi + 1;
  if (seatNoDb < 1) return 1;
  if (seatNoDb > maxPlayers) return maxPlayers;
  return seatNoDb;
};

const toUiSeatNo = (seatNoDb, maxPlayers) => {
  const maxUi = Number.isInteger(maxPlayers) && maxPlayers >= 2 ? maxPlayers - 1 : 0;
  if (!Number.isInteger(seatNoDb)) return 0;
  const seatNoUi = seatNoDb - 1;
  if (seatNoUi < 0) return 0;
  if (seatNoUi > maxUi) return maxUi;
  return seatNoUi;
};

const pickNextSeatNo = (rows, maxPlayers, preferredSeatNoDb) => {
  const occupied = new Set();
  for (const row of rows || []) {
    if (Number.isInteger(row?.seat_no)) occupied.add(row.seat_no);
  }
  const maxSeatDb = Number.isInteger(maxPlayers) && maxPlayers >= 2 ? maxPlayers : null;
  if (!maxSeatDb) return null;
  const preferred = Number.isInteger(preferredSeatNoDb) ? preferredSeatNoDb : 1;
  const start = preferred < 1 ? 1 : preferred > maxSeatDb ? maxSeatDb : preferred;
  for (let offset = 0; offset < maxSeatDb; offset += 1) {
    const candidate = ((start - 1 + offset) % maxSeatDb) + 1;
    if (!occupied.has(candidate)) return candidate;
  }
  return null;
};

const markBotLeaveAfterHandIfNeeded = async (tx, { tableId }) => {
  await tx.unsafe("select id from public.poker_tables where id = $1 limit 1 for update;", [tableId]);
  const markRows = await tx.unsafe(
    `
with candidate as (
  select user_id, seat_no
  from public.poker_seats
  where table_id = $1
    and status = 'ACTIVE'
    and coalesce(is_bot, false) = true
    and coalesce(leave_after_hand, false) = false
  order by seat_no asc
  limit 1
  for update skip locked
)
update public.poker_seats s
set leave_after_hand = true
from candidate
where s.table_id = $1
  and s.user_id = candidate.user_id
  and s.seat_no = candidate.seat_no
returning s.user_id, s.seat_no;
    `,
    [tableId]
  );
  if (markRows?.length) {
    return { status: "marked", botUserId: markRows[0].user_id, seatNo: markRows[0].seat_no };
  }

  const existingRows = await tx.unsafe(
    "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' and coalesce(is_bot, false) = true and coalesce(leave_after_hand, false) = true order by seat_no asc limit 1;",
    [tableId]
  );
  if (existingRows?.length) {
    return { status: "already_marked", botUserId: existingRows[0].user_id, seatNo: existingRows[0].seat_no };
  }
  return { status: "no_bot" };
};



const resolveFullTableJoinError = async (tx, { tableId, userId }) => {
  const botLeaveMark = await markBotLeaveAfterHandIfNeeded(tx, { tableId });
  if (botLeaveMark.status === "marked") {
    klog("poker_join_bot_leave_after_hand_marked", {
      tableId,
      userId,
      botUserId: botLeaveMark.botUserId,
      seatNo: botLeaveMark.seatNo,
    });
    return "table_full_bot_leaving";
  }
  if (botLeaveMark.status === "already_marked") {
    klog("poker_join_bot_leave_after_hand_already_marked", {
      tableId,
      userId,
      botUserId: botLeaveMark.botUserId,
      seatNo: botLeaveMark.seatNo,
    });
    return "table_full_bot_leaving";
  }
  return "table_full";
};

const seedBotsAfterHumanJoin = async (tx, { tableId, maxPlayers, bb, cfg, humanUserId }) => {
  if (!cfg?.enabled) return [];
  const countRows = await tx.unsafe(
    "select count(*)::int as count from public.poker_seats where table_id = $1 and status = 'ACTIVE' and coalesce(is_bot, false) = false;",
    [tableId]
  );
  const humanCount = Number(countRows?.[0]?.count || 0);
  if (!shouldSeedBotsOnJoin({ humanCount })) return [];
  const targetBots = computeTargetBotCount({ maxPlayers, humanCount, maxBots: cfg.maxPerTable });
  if (!Number.isInteger(targetBots) || targetBots <= 0) return [];

  const existingBotRows = await tx.unsafe(
    "select count(*)::int as count from public.poker_seats where table_id = $1 and status = 'ACTIVE' and coalesce(is_bot, false) = true;",
    [tableId]
  );
  const existingBotCount = Number(existingBotRows?.[0]?.count || 0);
  const toSeed = Math.max(0, targetBots - existingBotCount);
  if (toSeed <= 0) return [];

  const existingRows = await tx.unsafe(
    "select seat_no from public.poker_seats where table_id = $1 order by seat_no asc;",
    [tableId]
  );
  const occupied = new Set();
  for (const row of existingRows || []) {
    if (Number.isInteger(row?.seat_no)) occupied.add(row.seat_no);
  }

  const selectedSeats = [];
  for (let seatNo = 1; seatNo <= maxPlayers && selectedSeats.length < toSeed; seatNo += 1) {
    if (!occupied.has(seatNo)) selectedSeats.push(seatNo);
  }
  if (!selectedSeats.length) return [];

  const buyInChips = Math.max(1, Math.trunc(Number(cfg.buyInBB) * Number(bb)));
  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  const seededBots = [];

  for (const seatNo of selectedSeats) {
    const botUserId = makeBotUserId(tableId, seatNo);
    const botSystemKey = makeBotSystemKey(tableId, seatNo);
    const insertRows = await tx.unsafe(
      `
insert into public.poker_seats (table_id, user_id, seat_no, status, is_bot, bot_profile, leave_after_hand, stack, last_seen_at, joined_at)
values ($1, $2, $3, 'ACTIVE', true, $4, false, $5, now(), now())
on conflict do nothing
returning seat_no;
      `,
      [tableId, botUserId, seatNo, cfg.defaultProfile, buyInChips]
    );
    if (!insertRows?.length) continue;

    try {
      await postTransaction({
        userId: null,
        txType: "TABLE_BUY_IN",
        idempotencyKey: `bot-seed-buyin:${tableId}:${seatNo}`,
        metadata: {
          actor: "BOT",
          botUserId,
          botSystemKey,
          tableId,
          seatNo,
          botProfile: cfg.defaultProfile,
          reason: "BOT_SEED_BUY_IN",
        },
        entries: [
          { accountType: "SYSTEM", systemKey: cfg.bankrollSystemKey, amount: -buyInChips },
          { accountType: "ESCROW", systemKey: escrowSystemKey, amount: buyInChips },
        ],
        createdBy: humanUserId,
        tx,
      });
      seededBots.push({ userId: botUserId, seatNo, stack: buyInChips });
    } catch (error) {
      await tx.unsafe(
        "delete from public.poker_seats where table_id = $1 and user_id = $2 and seat_no = $3 and coalesce(is_bot, false) = true;",
        [tableId, botUserId, seatNo]
      );
      klog("poker_join_bot_seed_failed", { tableId, seatNo, botUserId, reason: error?.code || error?.message || "unknown_error" });
    }
  }

  return seededBots;
};

const ensureStateSeatEntry = (state, userId, seatNoDb) => {
  const seats = parseSeats(state?.seats);
  if (seats.some((seat) => seat?.userId === userId)) return state;
  return {
    ...(state && typeof state === "object" && !Array.isArray(state) ? state : {}),
    seats: [...seats, { userId, seatNo: seatNoDb }],
  };
};

const buildMeStatus = (state, userId, { forceSeated = false } = {}) => {
  const seat = Array.isArray(state?.seats) ? state.seats.find((entry) => entry?.userId === userId) : null;
  return {
    userId,
    isSeated: forceSeated ? true : !!seat,
    isLeft: !!state?.leftTableByUserId?.[userId],
    isSitOut: !!state?.sitOutByUserId?.[userId],
  };
};

const resolveMeStateAfterRejoin = async (tx, tableId, flagResult) => {
  if (flagResult?.nextState && typeof flagResult.nextState === "object" && !Array.isArray(flagResult.nextState)) {
    return flagResult.nextState;
  }
  const reload = await loadPokerStateForUpdate(tx, tableId);
  if (reload.ok) return reload.state;
  return {};
};

const clearRejoinFlags = async (tx, { tableId, userId }) => {
  const loadResult = await loadPokerStateForUpdate(tx, tableId);
  if (!loadResult.ok) {
    if (loadResult.reason === "not_found") throw makeError(404, "state_missing");
    throw makeError(409, "state_invalid");
  }
  const currentState = loadResult.state;
  if (currentState?.leftTableByUserId?.[userId] && isHandInProgress(currentState?.phase)) {
    const pruned = pruneUserFromHandSeats(currentState, userId);
    if (!pruned.changed) {
      return { updated: false, nextState: currentState };
    }
    if (!isStateStorageValid(pruned.nextState, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false })) {
      klog("poker_join_state_invalid", { tableId, userId, reason: "state_invalid" });
      throw makeError(409, "state_invalid");
    }
    const prunedUpdate = await updatePokerStateLocked(tx, { tableId, nextState: pruned.nextState });
    if (!prunedUpdate.ok) {
      if (prunedUpdate.reason === "not_found") throw makeError(404, "state_missing");
      throw makeError(409, "state_invalid");
    }
    return { updated: true, nextState: pruned.nextState };
  }
  const patched = patchLeftTableByUserId(currentState, userId, false);
  const clearedMissed = clearMissedTurns(patched.nextState, userId);
  const clearedSitOut = patchSitOutByUserId(clearedMissed.nextState, userId, false);
  if (!patched.changed && !clearedMissed.changed && !clearedSitOut.changed) {
    return { updated: false, nextState: clearedSitOut.nextState };
  }
  if (!isStateStorageValid(clearedSitOut.nextState, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false })) {
    klog("poker_join_state_invalid", { tableId, userId, reason: "state_invalid" });
    throw makeError(409, "state_invalid");
  }
  const updateResult = await updatePokerStateLocked(tx, { tableId, nextState: clearedSitOut.nextState });
  if (!updateResult.ok) {
    if (updateResult.reason === "not_found") throw makeError(404, "state_missing");
    throw makeError(409, "state_invalid");
  }
  return { updated: true, nextState: clearedSitOut.nextState };
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const autoSeat = parseAutoSeat(payload?.autoSeat);
  const preferredSeatNo = parseSeatNo(payload?.preferredSeatNo);
  const preferredSeatNoMissing = autoSeat && preferredSeatNo == null;
  const seatNoUi = parseSeatNo(payload?.seatNo);
  if (!autoSeat && seatNoUi == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_seat_no" }) };
  }

  const buyIn = parseBuyIn(payload?.buyIn);
  if (buyIn == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_buy_in" }) };
  }

  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok) {
    const requestIdValue = payload?.requestId;
    const requestIdType = typeof requestIdValue;
    const requestIdTrimmed = typeof requestIdValue === "string" ? requestIdValue.trim() : "";
    const requestIdPreview = requestIdTrimmed ? requestIdTrimmed.slice(0, 50) : null;
    const requestIdPresent = requestIdTrimmed !== "";
    klog("poker_request_id_invalid", {
      fn: "join",
      tableId,
      requestIdType,
      requestIdPreview,
      requestIdPresent,
      reason: "normalize_failed",
    });
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = requestIdParsed.value;

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  if (preferredSeatNoMissing) {
    klog("poker_join_autoseat_missing_preferred", {
      tableId,
      userId: auth.userId,
      hasRequestId: !!requestId,
    });
  }

  klog("poker_join_begin", {
    tableId,
    userId: auth.userId,
    seatNoUi,
    preferredSeatNo,
    autoSeat,
    hasRequestId: !!requestId,
  });

  try {
    const result = await beginSql(async (tx) => {
      let mutated = false;
      const requestInfo = await ensurePokerRequest(tx, {
        tableId,
        userId: auth.userId,
        requestId,
        kind: "JOIN",
        pendingStaleSec: REQUEST_PENDING_STALE_SEC,
      });
      if (requestInfo.status === "stored") return requestInfo.result;
      if (requestInfo.status === "pending") return { ok: false, pending: true, requestId };

      try {
        const tableRows = await tx.unsafe(
          "select id, status, max_players, stakes from public.poker_tables where id = $1 limit 1;",
          [tableId]
        );
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }
        const seatRows = await tx.unsafe(
          "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
          [tableId, auth.userId]
        );
        const existingSeatNo = seatRows?.[0]?.seat_no;
        if (Number.isInteger(existingSeatNo)) {
          if (table.status === "CLOSED") {
            throw makeError(409, "table_closed");
          }
          await tx.unsafe(
            "update public.poker_seats set status = 'ACTIVE', last_seen_at = now(), stack = coalesce(stack, $3) where table_id = $1 and user_id = $2;",
            [tableId, auth.userId, buyIn]
          );
          mutated = true;

          await tx.unsafe(
            "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
            [tableId]
          );
          const flagResult = await clearRejoinFlags(tx, { tableId, userId: auth.userId });
          const meState = await resolveMeStateAfterRejoin(tx, tableId, flagResult);
          const meStateWithSeat = ensureStateSeatEntry(meState, auth.userId, existingSeatNo);
          if (meStateWithSeat !== meState) {
            const statePatchResult = await updatePokerStateLocked(tx, { tableId, nextState: meStateWithSeat });
            if (!statePatchResult.ok) {
              if (statePatchResult.reason === "not_found") throw makeError(404, "state_missing");
              throw makeError(409, "state_invalid");
            }
          }
          const resolvedSeatNoUi = toUiSeatNo(existingSeatNo, Number(table.max_players));

          const resultPayload = {
            ok: true,
            tableId,
            seatNo: resolvedSeatNoUi,
            userId: auth.userId,
            me: buildMeStatus(meStateWithSeat, auth.userId, { forceSeated: true }),
          };
          await storePokerRequestResult(tx, {
            tableId,
            userId: auth.userId,
            requestId,
            kind: "JOIN",
            result: resultPayload,
          });
          klog("poker_join_stack_persisted", {
            tableId,
            userId: auth.userId,
            seatNoUi: resolvedSeatNoUi,
            seatNoDb: existingSeatNo,
            attemptedStackFill: buyIn,
            mode: "rejoin",
          });
          klog("poker_join_ok", { tableId, userId: auth.userId, seatNoUi: resolvedSeatNoUi, seatNoDb: existingSeatNo, rejoin: true });
          return resultPayload;
        }

        if (table.status === "CLOSED") {
          throw makeError(409, "table_closed");
        }

        if (table.status !== "OPEN") {
          throw makeError(409, "table_not_open");
        }

        const preferredSeatNoUi = preferredSeatNo == null ? 0 : preferredSeatNo;
        const seatNoDbInitial = toDbSeatNo(autoSeat ? preferredSeatNoUi : seatNoUi, Number(table.max_players));
        if (!Number.isInteger(seatNoDbInitial)) {
          throw makeError(400, "invalid_seat_no");
        }

        let seatNoDbToUse = seatNoDbInitial;
        const maxSeatInsertAttempts = autoSeat ? Math.max(1, Number(table.max_players) || 1) : 3;
        for (let attempt = 0; attempt < maxSeatInsertAttempts; attempt += 1) {
          try {
            await tx.unsafe(
              `
insert into public.poker_seats (table_id, user_id, seat_no, status, last_seen_at, joined_at, stack)
values ($1, $2, $3, 'ACTIVE', now(), now(), $4);
              `,
              [tableId, auth.userId, seatNoDbToUse, buyIn]
            );
            mutated = true;
            break;
          } catch (error) {
            const conflictKind = classifySeatInsertConflict(error);
            if (conflictKind === "seat_taken") {
              const activeSeatRows = await tx.unsafe(
                "select seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
                [tableId]
              );
              const nextSeatNo = pickNextSeatNo(activeSeatRows, Number(table.max_players), seatNoDbToUse + 1);
              if (!Number.isInteger(nextSeatNo)) {
                const fullTableError = await resolveFullTableJoinError(tx, { tableId, userId: auth.userId });
                throw makeError(409, fullTableError);
              }
              if (!autoSeat) {
                throw makeError(409, "seat_taken");
              }
              seatNoDbToUse = nextSeatNo;
              klog("poker_join_autoseat_selected", {
                tableId,
                userId: auth.userId,
                seatNoDbInitial,
                chosenSeatNoDb: seatNoDbToUse,
                attempt: attempt + 1,
              });
              if (attempt >= maxSeatInsertAttempts - 1) {
                klog("poker_join_autoseat_retry_exhausted", {
                  tableId,
                  userId: auth.userId,
                  seatNoDbInitial,
                  lastSeatNoDb: seatNoDbToUse,
                });
                throw makeError(409, "duplicate_seat");
              }
              continue;
            }
            if (conflictKind === "already_seated") {
              const seatRow = await tx.unsafe(
                "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
                [tableId, auth.userId]
              );
              const fallbackSeatNo = seatRow?.[0]?.seat_no;
              if (Number.isInteger(fallbackSeatNo)) {
                await tx.unsafe(
                  "update public.poker_seats set status = 'ACTIVE', last_seen_at = now(), stack = coalesce(stack, $3) where table_id = $1 and user_id = $2;",
                  [tableId, auth.userId, buyIn]
                );
                mutated = true;
                await tx.unsafe(
                  "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
                  [tableId]
                );
                const flagResult = await clearRejoinFlags(tx, { tableId, userId: auth.userId });
                const meState = await resolveMeStateAfterRejoin(tx, tableId, flagResult);
                const meStateWithSeat = ensureStateSeatEntry(meState, auth.userId, fallbackSeatNo);
                if (meStateWithSeat !== meState) {
                  const statePatchResult = await updatePokerStateLocked(tx, { tableId, nextState: meStateWithSeat });
                  if (!statePatchResult.ok) {
                    if (statePatchResult.reason === "not_found") throw makeError(404, "state_missing");
                    throw makeError(409, "state_invalid");
                  }
                }
                const seatNoUi = toUiSeatNo(fallbackSeatNo, Number(table.max_players));
                const resultPayload = {
                  ok: true,
                  tableId,
                  seatNo: seatNoUi,
                  userId: auth.userId,
                  me: buildMeStatus(meStateWithSeat, auth.userId, { forceSeated: true }),
                };
                await storePokerRequestResult(tx, {
                  tableId,
                  userId: auth.userId,
                  requestId,
                  kind: "JOIN",
                  result: resultPayload,
                });
                klog("poker_join_stack_persisted", {
                  tableId,
                  userId: auth.userId,
                  seatNoUi,
                  seatNoDb: fallbackSeatNo,
                  attemptedStackFill: buyIn,
                  mode: "rejoin",
                });
                klog("poker_join_ok", { tableId, userId: auth.userId, seatNoUi, seatNoDb: fallbackSeatNo, rejoin: true });
                return resultPayload;
              }
              throw makeError(409, "already_seated");
            }
            if (conflictKind === "unique_unknown") {
              throw makeError(409, "seat_taken");
            }
            throw error;
          }
        }

        const escrowSystemKey = `POKER_TABLE:${tableId}`;
        const escrowRows = await tx.unsafe(
          "select id from public.chips_accounts where system_key = $1 limit 1;",
          [escrowSystemKey]
        );
        const escrowId = escrowRows?.[0]?.id || null;
        if (!escrowId) {
          throw new Error("poker_escrow_missing");
        }

        const idempotencyKey = requestId
          ? `join-buyin:${tableId}:${auth.userId}:${requestId}`
          : `join-buyin:${tableId}:${auth.userId}:${seatNoDbToUse}:${buyIn}`;
        klog("poker_join_buyin_attempt", { tableId, userId: auth.userId, idempotencyKey });

        try {
          await postTransaction({
            userId: auth.userId,
            txType: "TABLE_BUY_IN",
            idempotencyKey,
            entries: [
              { accountType: "USER", amount: -buyIn },
              { accountType: "ESCROW", systemKey: escrowSystemKey, amount: buyIn },
            ],
            createdBy: auth.userId,
            tx,
          });
        } catch (error) {
          if (!isBuyInIdempotencyDuplicate(error)) throw error;
          klog("poker_join_buyin_duplicate_idempotency", { tableId, userId: auth.userId, idempotencyKey });
        }
        mutated = true;

        const botCfg = getBotConfig(process.env);
        let seededBots = [];
        if (botCfg.enabled) {
          const stakesParsed = parseStakes(table?.stakes);
          if (stakesParsed?.ok) {
            seededBots = await seedBotsAfterHumanJoin(tx, {
              tableId,
              maxPlayers: Number(table.max_players),
              bb: stakesParsed.value.bb,
              cfg: botCfg,
              humanUserId: auth.userId,
            });
          } else {
            klog("poker_join_bot_seed_skip_invalid_stakes", { tableId, stakes: table?.stakes ?? null });
          }
        }
        if (seededBots.length > 0) mutated = true;

        const loadResult = await loadPokerStateForUpdate(tx, tableId);
        if (!loadResult.ok) {
          if (loadResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          throw makeError(409, "state_invalid");
        }

        const currentState = loadResult.state;
        const seats = parseSeats(currentState.seats).filter((seat) => seat?.userId !== auth.userId);
        seats.push({ userId: auth.userId, seatNo: seatNoDbToUse });
        for (const bot of seededBots) {
          if (!seats.some((seat) => seat?.userId === bot.userId)) {
            seats.push({ userId: bot.userId, seatNo: bot.seatNo });
          }
        }
        const stacks = { ...parseStacks(currentState.stacks), [auth.userId]: buyIn };
        for (const bot of seededBots) {
          stacks[bot.userId] = bot.stack;
        }
        const preserveLeftDuringActiveHand = !!currentState?.leftTableByUserId?.[auth.userId] && isHandInProgress(currentState?.phase);
        let nextBaseState = currentState;
        if (preserveLeftDuringActiveHand) {
          const pruned = pruneUserFromHandSeats(currentState, auth.userId);
          nextBaseState = pruned.nextState;
        } else {
          const patched = patchLeftTableByUserId(currentState, auth.userId, false);
          const clearedMissed = clearMissedTurns(patched.nextState, auth.userId);
          const clearedSitOut = patchSitOutByUserId(clearedMissed.nextState, auth.userId, false);
          nextBaseState = clearedSitOut.nextState;
        }

        const updatedState = {
          ...nextBaseState,
          tableId: currentState.tableId || tableId,
          seats,
          stacks,
          pot: Number.isFinite(currentState.pot) ? currentState.pot : 0,
          phase: currentState.phase || "INIT",
        };
        if (!isStateStorageValid(updatedState, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false })) {
          klog("poker_join_state_invalid", { tableId, userId: auth.userId, reason: "state_invalid" });
          throw makeError(409, "state_invalid");
        }

        const updateResult = await updatePokerStateLocked(tx, { tableId, nextState: updatedState });
        if (!updateResult.ok) {
          if (updateResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          throw makeError(409, "state_invalid");
        }

        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        const resultPayload = {
          ok: true,
          tableId,
          seatNo: toUiSeatNo(seatNoDbToUse, Number(table.max_players)),
          userId: auth.userId,
          heartbeatEverySec: HEARTBEAT_INTERVAL_SEC,
          me: buildMeStatus(updatedState, auth.userId, { forceSeated: true }),
        };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "JOIN",
          result: resultPayload,
        });
        const resolvedSeatNoUi = toUiSeatNo(seatNoDbToUse, Number(table.max_players));
        klog("poker_join_stack_persisted", {
          tableId,
          userId: auth.userId,
          seatNoUi: resolvedSeatNoUi,
          seatNoDb: seatNoDbToUse,
          persistedStack: buyIn,
          mode: "insert",
        });
        klog("poker_join_ok", { tableId, userId: auth.userId, seatNoUi: resolvedSeatNoUi, seatNoDb: seatNoDbToUse, rejoin: false });
        return resultPayload;
      } catch (error) {
        if (requestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId, kind: "JOIN" });
        } else if (requestId && mutated) {
          klog("poker_join_request_retained", { tableId, userId: auth.userId, requestId });
        }
        throw error;
      }
    });

    if (result?.pending) {
      return {
        statusCode: 202,
        headers: cors,
        body: JSON.stringify({ error: "request_pending", requestId: result.requestId || requestId }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(result),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      if (error.code === "seat_taken") {
        klog("poker_join_rejected", { tableId, userId: auth.userId, reason: error.code });
      } else {
        klog("poker_join_fail", { tableId, userId: auth.userId, reason: error.code });
      }
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_join_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
