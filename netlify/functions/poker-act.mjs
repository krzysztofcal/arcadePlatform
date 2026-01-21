import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { advanceIfNeeded, applyAction } from "./_shared/poker-reducer.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { isPlainObject, isStateStorageValid, normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const ACTION_TYPES = new Set(["CHECK", "BET", "CALL", "RAISE", "FOLD"]);
const ADVANCE_LIMIT = 4;

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const normalizeAction = (action) => {
  if (!action || typeof action !== "object" || Array.isArray(action)) return { ok: false, value: null };
  const type = typeof action.type === "string" ? action.type.trim().toUpperCase() : "";
  if (!ACTION_TYPES.has(type)) return { ok: false, value: null };
  if (type === "BET" || type === "RAISE") {
    const amount = Number(action.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) return { ok: false, value: null };
    return { ok: true, value: { type, amount } };
  }
  return { ok: true, value: { type } };
};

const normalizeRequest = (value) => {
  const parsed = normalizeRequestId(value, { maxLen: 200 });
  if (!parsed.ok || !parsed.value) return { ok: false, value: null };
  return { ok: true, value: parsed.value };
};

const hasRequiredState = (state) =>
  isPlainObject(state) &&
  typeof state.phase === "string" &&
  typeof state.turnUserId === "string" &&
  Array.isArray(state.seats) &&
  isPlainObject(state.stacks) &&
  isPlainObject(state.toCallByUserId) &&
  isPlainObject(state.betThisRoundByUserId) &&
  isPlainObject(state.actedThisRoundByUserId) &&
  isPlainObject(state.foldedByUserId);

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

const getSeatForUser = (state, userId) => (Array.isArray(state.seats) ? state.seats.find((seat) => seat?.userId === userId) : null);

const validateActionBounds = (state, action, userId) => {
  const toCall = Number(state.toCallByUserId?.[userId] || 0);
  const stack = Number(state.stacks?.[userId] ?? 0);
  const currentBet = Number(state.betThisRoundByUserId?.[userId] || 0);
  if (!Number.isFinite(toCall) || !Number.isFinite(stack) || !Number.isFinite(currentBet)) return false;
  if (action.type === "CHECK") return toCall === 0;
  if (action.type === "CALL") return toCall > 0;
  if (action.type === "BET") return toCall === 0 && action.amount <= stack;
  if (action.type === "RAISE") {
    // RAISE amount is treated as raise-to (total bet this round), matching applyAction.
    if (!(toCall > 0)) return false;
    const raiseTo = action.amount;
    if (!(raiseTo > currentBet)) return false;
    const required = raiseTo - currentBet;
    return required <= stack;
  }
  return true;
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
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdParsed = normalizeRequest(payload?.requestId);
  if (!requestIdParsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = requestIdParsed.value;

  const actionParsed = normalizeAction(payload?.action);
  if (!actionParsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_action" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe("select id, status from public.poker_tables where id = $1 limit 1;", [tableId]);
      const table = tableRows?.[0] || null;
      if (!table) {
        throw makeError(404, "table_not_found");
      }
      if (table.status !== "OPEN") {
        throw makeError(409, "table_not_open");
      }

      const seatRows = await tx.unsafe(
        "select user_id from public.poker_seats where table_id = $1 and status = 'ACTIVE' and user_id = $2 limit 1;",
        [tableId, auth.userId]
      );
      if (!seatRows?.[0]?.user_id) {
        throw makeError(403, "not_allowed");
      }

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 for update;",
        [tableId]
      );
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        throw makeError(409, "state_invalid");
      }

      const currentState = normalizeJsonState(stateRow.state);
      if (!hasRequiredState(currentState)) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          phase: currentState?.phase || null,
        });
        throw makeError(409, "state_invalid");
      }
      if (!isActionPhase(currentState.phase) || !currentState.turnUserId) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          phase: currentState?.phase || null,
        });
        throw makeError(409, "state_invalid");
      }

      const lastByUserId = isPlainObject(currentState.lastActionRequestIdByUserId)
        ? currentState.lastActionRequestIdByUserId
        : {};

      const seat = getSeatForUser(currentState, auth.userId);
      if (!seat) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_drift",
          phase: currentState.phase,
        });
        throw makeError(409, "state_invalid");
      }
      if (currentState.foldedByUserId?.[auth.userId]) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "folded_player",
          phase: currentState.phase,
        });
        throw makeError(403, "not_allowed");
      }

      if (lastByUserId[auth.userId] === requestId) {
        const version = Number(stateRow.version);
        if (!Number.isFinite(version)) {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "state_invalid",
            phase: currentState.phase,
          });
          throw makeError(409, "state_invalid");
        }
        return {
          tableId,
          version,
          state: withoutPrivateState(currentState),
          myHoleCards: currentState.holeCardsByUserId?.[auth.userId] || [],
          events: [],
          replayed: true,
        };
      }

      if (currentState.turnUserId !== auth.userId) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "not_your_turn",
          phase: currentState.phase,
          actionType: actionParsed.value.type,
        });
        throw makeError(403, "not_your_turn");
      }

      if (!validateActionBounds(currentState, actionParsed.value, auth.userId)) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "invalid_action",
          phase: currentState.phase,
          actionType: actionParsed.value.type,
          amount: actionParsed.value.amount ?? null,
        });
        throw makeError(400, "invalid_action");
      }

      let applied;
      try {
        applied = applyAction(currentState, { ...actionParsed.value, userId: auth.userId });
      } catch (error) {
        const reason = error?.message || "invalid_action";
        if (reason === "not_your_turn") {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "not_your_turn",
            phase: currentState.phase,
            actionType: actionParsed.value.type,
          });
          throw makeError(403, "not_your_turn");
        }
        if (reason === "invalid_player") {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "invalid_player",
            phase: currentState.phase,
            actionType: actionParsed.value.type,
          });
          throw makeError(403, "not_allowed");
        }
        if (reason === "invalid_action") {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "invalid_action",
            phase: currentState.phase,
            actionType: actionParsed.value.type,
            amount: actionParsed.value.amount ?? null,
          });
          throw makeError(400, "invalid_action");
        }
        throw error;
      }

      let nextState = applied.state;
      const events = Array.isArray(applied.events) ? applied.events.slice() : [];
      let loops = 0;
      const advanceEvents = [];
      while (loops < ADVANCE_LIMIT) {
        const prevPhase = nextState.phase;
        const advanced = advanceIfNeeded(nextState);
        nextState = advanced.state;

        if (Array.isArray(advanced.events) && advanced.events.length > 0) {
          events.push(...advanced.events);
          advanceEvents.push(...advanced.events);
        }

        if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
        if (nextState.phase === prevPhase) break;
        loops += 1;
      }

      const updatedState = {
        ...nextState,
        lastActionRequestIdByUserId: {
          ...lastByUserId,
          [auth.userId]: requestId,
        },
      };

      const requirePrivate = isActionPhase(updatedState.phase);
      if (!isStateStorageValid(updatedState, { requirePrivate })) {
        klog("poker_state_corrupt", { tableId, phase: updatedState.phase });
        throw makeError(409, "state_invalid");
      }

      const updateRows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
        [tableId, JSON.stringify(updatedState)]
      );
      const newVersion = Number(updateRows?.[0]?.version);
      if (!Number.isFinite(newVersion)) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          phase: updatedState.phase,
        });
        throw makeError(409, "state_invalid");
      }

      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
        [tableId, newVersion, auth.userId, actionParsed.value.type, actionParsed.value.amount ?? null]
      );

      if (advanceEvents.length > 0) {
        klog("poker_act_advanced", {
          tableId,
          fromPhase: currentState.phase,
          toPhase: updatedState.phase,
          loops,
          eventTypes: Array.from(new Set(advanceEvents.map((event) => event?.type).filter(Boolean))),
        });
      }

      klog("poker_act_applied", {
        tableId,
        userId: auth.userId,
        actionType: actionParsed.value.type,
        amount: actionParsed.value.amount ?? null,
        fromPhase: currentState.phase,
        toPhase: updatedState.phase,
        newVersion,
      });

      return {
        tableId,
        version: newVersion,
        state: withoutPrivateState(updatedState),
        myHoleCards: updatedState.holeCardsByUserId?.[auth.userId] || [],
        events,
        replayed: false,
      };
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        tableId: result.tableId,
        state: {
          version: result.version,
          state: result.state,
        },
        myHoleCards: result.myHoleCards,
        events: result.events,
        replayed: result.replayed,
      }),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_act_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
