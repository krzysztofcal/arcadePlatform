import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { applyAction, normalizeSeatRows, normalizeState, toPublicState } from "./_shared/poker-engine.mjs";

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

const parseActionType = (value) => {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (!upper) return null;
  const allowed = ["FOLD", "CHECK", "CALL", "BET", "RAISE"];
  if (!allowed.includes(upper)) return null;
  return upper;
};

const parseAmount = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
};

const mapHoleCards = (rows) =>
  Array.isArray(rows)
    ? rows.reduce((acc, row) => {
        if (row?.user_id && row?.cards) {
          acc[row.user_id] = row.cards;
        }
        return acc;
      }, {})
    : {};

const loadHoleCardsForHand = async (tx, tableId, handId) => {
  if (!handId) return {};
  const rows = await tx.unsafe(
    "select user_id, cards from public.poker_hole_cards where table_id = $1 and hand_id = $2;",
    [tableId, handId]
  );
  return mapHoleCards(rows);
};

const loadHoleCardsForUser = async (tx, tableId, handId, userId) => {
  if (!handId || !userId) return null;
  const rows = await tx.unsafe(
    "select cards from public.poker_hole_cards where table_id = $1 and hand_id = $2 and user_id = $3 limit 1;",
    [tableId, handId, userId]
  );
  return rows?.[0]?.cards || null;
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

  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok || !requestIdParsed.value) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = requestIdParsed.value;

  const actionType = parseActionType(payload?.actionType);
  if (!actionType) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_action_type" }) };
  }
  const amount = parseAmount(payload?.amount);

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, status, stakes from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) throw makeError(404, "table_not_found");
      if (table.status !== "OPEN") throw makeError(409, "table_not_open");

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, stack from public.poker_seats where table_id = $1 order by seat_no asc;",
        [tableId]
      );
      const seats = normalizeSeatRows(seatRows);
      const authSeat = seats.find((seat) => seat.userId === auth.userId);
      if (!authSeat) throw makeError(403, "not_seated");

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 for update;",
        [tableId]
      );
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) throw new Error("poker_state_missing");
      const currentState = normalizeState(stateRow.state);
      const requestMarker = `REQUEST:${requestId}`;
      const existingRows = await tx.unsafe(
        "select version from public.poker_actions where table_id = $1 and user_id = $2 and request_id = $3 limit 1;",
        [tableId, auth.userId, requestId]
      );
      const existing = existingRows?.[0];
      if (!existing?.version) {
        const legacyRows = await tx.unsafe(
          "select version from public.poker_actions where table_id = $1 and user_id = $2 and action_type = $3 limit 1;",
          [tableId, auth.userId, requestMarker]
        );
        if (legacyRows?.[0]?.version) {
          existing.version = legacyRows[0].version;
        }
      }
      if (existing?.version != null) {
        const latestRows = await tx.unsafe(
          "select version, state from public.poker_state where table_id = $1 limit 1;",
          [tableId]
        );
        const latest = latestRows?.[0] || stateRow;
        const latestState = normalizeState(latest?.state);
        const publicState = toPublicState(latestState, auth.userId);
        const userHoleCards = await loadHoleCardsForUser(tx, tableId, latestState?.handId, auth.userId);
        if (userHoleCards) {
          publicState.hole = { [auth.userId]: userHoleCards };
        }
        return { ok: true, state: publicState, version: Number(latest?.version) };
      }

      const phase = currentState.phase || "WAITING";
      const activePhases = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"];
      const publicSeats = Array.isArray(currentState.public?.seats) ? currentState.public.seats : [];
      const dbSeatMap = new Map(seats.map((seat) => [seat.userId, seat]));
      const dbActiveIds = seats.filter((seat) => seat.status === "ACTIVE").map((seat) => seat.userId);
      const publicIds = publicSeats.map((seat) => seat?.userId).filter(Boolean);

      if (activePhases.includes(phase)) {
        const missingInPublic = dbActiveIds.some((userId) => !publicIds.includes(userId));
        const missingInDb = publicIds.some((userId) => !dbSeatMap.has(userId));
        const seatNoMismatch = publicSeats.some((seat) => {
          const dbSeat = dbSeatMap.get(seat?.userId);
          if (!dbSeat) return false;
          if (!Number.isInteger(seat?.seatNo)) return true;
          return seat.seatNo !== dbSeat.seatNo;
        });
        const seatCountMismatch = publicSeats.length !== dbActiveIds.length;
        if (!publicSeats.length || missingInPublic || missingInDb || seatNoMismatch || seatCountMismatch) {
          klog("poker_state_invariant_violation", {
            tableId,
            phase,
            dbSeats: dbActiveIds.length,
            publicSeats: publicIds.length,
            seatNoMismatch,
            seatCountMismatch,
            missingInPublic: dbActiveIds.filter((userId) => !publicIds.includes(userId)),
            missingInDb: publicIds.filter((userId) => !dbSeatMap.has(userId)),
          });
          throw makeError(409, "state_invalid");
        }

        const reconciledSeats = publicSeats
          .filter((seat) => dbSeatMap.has(seat.userId))
          .map((seat) => {
            const dbSeat = dbSeatMap.get(seat.userId);
            return {
              userId: seat.userId,
              seatNo: dbSeat?.seatNo ?? seat.seatNo,
              status: dbSeat?.status || seat.status || "ACTIVE",
              stack: Number.isFinite(seat.stack) ? seat.stack : 0,
              betThisStreet: Number.isFinite(seat.betThisStreet) ? seat.betThisStreet : 0,
              hasFolded: !!seat.hasFolded,
              isAllIn: !!seat.isAllIn,
            };
          })
          .sort((a, b) => a.seatNo - b.seatNo);
        currentState.public = { seats: reconciledSeats };
        if (currentState.actorSeat != null) {
          const actorMatch = reconciledSeats.find((seat) => seat.seatNo === currentState.actorSeat);
          currentState.actionRequiredFromUserId = actorMatch ? actorMatch.userId : null;
        }
      } else {
        // Reconcile stacks and public seats with DB truth when no active hand is running.
        const dbStacks = seats.reduce((acc, seat) => {
          if (seat.status !== "ACTIVE") return acc;
          const stackValue = Number.isFinite(seat.stack) ? seat.stack : 0;
          acc[seat.userId] = stackValue;
          return acc;
        }, {});
        const reconciledSeats = publicSeats
          .filter((seat) => dbSeatMap.has(seat.userId))
          .map((seat) => {
            const dbSeat = dbSeatMap.get(seat.userId);
            return {
              userId: seat.userId,
              seatNo: dbSeat?.seatNo ?? seat.seatNo,
              status: dbSeat?.status || seat.status || "ACTIVE",
              stack: Number.isFinite(dbStacks[seat.userId]) ? dbStacks[seat.userId] : 0,
              betThisStreet: Number.isFinite(seat.betThisStreet) ? seat.betThisStreet : 0,
              hasFolded: !!seat.hasFolded,
              isAllIn: !!seat.isAllIn,
            };
          });
        seats.forEach((seat) => {
          if (seat.status !== "ACTIVE") return;
          if (reconciledSeats.some((existing) => existing.userId === seat.userId)) return;
          reconciledSeats.push({
            userId: seat.userId,
            seatNo: seat.seatNo,
            status: seat.status || "ACTIVE",
            stack: Number.isFinite(dbStacks[seat.userId]) ? dbStacks[seat.userId] : 0,
            betThisStreet: 0,
            hasFolded: false,
            isAllIn: false,
          });
        });
        reconciledSeats.sort((a, b) => a.seatNo - b.seatNo);
        currentState.stacks = dbStacks;
        currentState.public = { seats: reconciledSeats };
        if (currentState.actorSeat != null) {
          const actorMatch = reconciledSeats.find((seat) => seat.seatNo === currentState.actorSeat);
          currentState.actionRequiredFromUserId = actorMatch ? actorMatch.userId : null;
        }
      }
      if (!activePhases.includes(phase)) {
        throw makeError(409, "hand_not_active");
      }

      const stakes = table.stakes || {};
      const baseState = currentState;
      const handId = baseState.handId;
      const holeCards = await loadHoleCardsForHand(tx, tableId, handId);

      const actionResult = applyAction({
        currentState: baseState,
        actionType,
        amount,
        userId: auth.userId,
        stakes,
        holeCards,
      });
      if (!actionResult.ok) throw makeError(409, actionResult.error || "action_invalid");
      const nextState = actionResult.state;
      const effectiveHandId = nextState.handId || baseState.handId;
      let cachedHoleCards = null;
      if (nextState.phase === "SETTLED" && effectiveHandId) {
        cachedHoleCards = await loadHoleCardsForUser(tx, tableId, effectiveHandId, auth.userId);
      }

      if (nextState.phase === "SETTLED" && effectiveHandId) {
        // Hole cards are server-only, relying on service-role access.
        await tx.unsafe("delete from public.poker_hole_cards where table_id = $1 and hand_id = $2;", [
          tableId,
          effectiveHandId,
        ]);
      }
      const phaseValid = !nextState.phase || ["WAITING", "PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN", "SETTLED"].includes(nextState.phase);
      const potValid = Number.isFinite(nextState.potTotal) && nextState.potTotal >= 0;
      const stacksValid = Array.isArray(nextState.public?.seats)
        ? nextState.public.seats.every((seat) => Number.isFinite(seat?.stack) && seat.stack >= 0)
        : true;
      if (!phaseValid || !potValid || !stacksValid) {
        throw makeError(409, "state_invalid");
      }

      const updateRows = await tx.unsafe(
        `with updated as (
           update public.poker_state
           set version = version + 1,
               state = $2::jsonb,
               updated_at = now()
           where table_id = $1
           returning version
         ),
         action_ins as (
           insert into public.poker_actions (table_id, version, user_id, action_type, amount, request_id)
           select $1, updated.version, $3, $4, $5, $6
           from updated
           returning version
         )
         select version from updated;`,
        [tableId, JSON.stringify(nextState), auth.userId, actionType, amount ?? null, requestId]
      );
      const newVersion = Number(updateRows?.[0]?.version);
      if (!Number.isFinite(newVersion)) throw makeError(409, "state_invalid");

      const nextSeats = Array.isArray(nextState.public?.seats) ? nextState.public.seats : [];
      const stackUpdates = nextSeats
        .filter((seat) => seat?.userId)
        .map((seat) => ({
          userId: seat.userId,
          stack: Number.isFinite(seat.stack) ? seat.stack : 0,
        }));
      if (stackUpdates.length) {
        const valuesSql = stackUpdates
          .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`)
          .join(", ");
        const params = stackUpdates.flatMap((row) => [row.userId, row.stack]);
        await tx.unsafe(
          `update public.poker_seats as s
           set stack = v.stack
           from (values ${valuesSql}) as v(user_id, stack)
           where s.table_id = $${params.length + 1} and s.user_id = v.user_id;`,
          [...params, tableId]
        );
      }

      const publicState = toPublicState(nextState, auth.userId);
      const userHoleCards =
        cachedHoleCards ?? (effectiveHandId ? await loadHoleCardsForUser(tx, tableId, effectiveHandId, auth.userId) : null);
      if (userHoleCards) {
        publicState.hole = { [auth.userId]: userHoleCards };
      }
      return { ok: true, state: publicState, version: newVersion };
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_act_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
