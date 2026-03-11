import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";

function resolveLeaveTestOverride(env = process.env) {
  const raw = env.WS_TEST_LEAVE_RESULT_JSON;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}



function hasValidAuthoritativeSeats(seats) {
  if (!Array.isArray(seats)) {
    return false;
  }

  return seats.every((seatEntry) => {
    const rawSeatNo = seatEntry?.seatNo;
    const rawSeatAlias = seatEntry?.seat;
    const seatNo = Number.isInteger(Number(rawSeatNo))
      ? Number(rawSeatNo)
      : Number.isInteger(Number(rawSeatAlias))
        ? Number(rawSeatAlias)
        : null;
    const seatUserId = typeof seatEntry?.userId === "string" ? seatEntry.userId.trim() : "";
    return Number.isInteger(seatNo) && seatUserId.length > 0;
  });
}

function isValidAuthoritativeLeaveSuccessShape(result, expectedTableId) {
  if (!result?.ok) {
    return true;
  }

  const version = result?.state?.version;
  const state = result?.state?.state;
  if (!Number.isInteger(Number(version)) || !state || typeof state !== "object" || Array.isArray(state)) {
    return false;
  }

  if (typeof state.tableId !== "string" || state.tableId !== expectedTableId) {
    return false;
  }

  return hasValidAuthoritativeSeats(state.seats);
}

function normalizeValidatedResult({ result, tableId, userId, requestId, klog }) {
  if (isValidAuthoritativeLeaveSuccessShape(result, tableId)) {
    return result;
  }

  klog("ws_leave_authoritative_failed", {
    tableId,
    userId,
    requestId: requestId || null,
    message: "invalid_authoritative_success_shape",
    code: "authoritative_state_invalid"
  });
  return {
    ok: false,
    code: "authoritative_state_invalid"
  };
}

export function createAuthoritativeLeaveExecutor({
  env = process.env,
  klog = () => {},
  loadAuthoritativeLeaveModule = () => {
    const configuredPath = typeof env?.WS_AUTHORITATIVE_LEAVE_MODULE_PATH === "string"
      ? env.WS_AUTHORITATIVE_LEAVE_MODULE_PATH.trim()
      : "";
    const modulePath = configuredPath || "../../shared/poker-domain/leave.mjs";
    return import(modulePath);
  },
  beginSql = beginSqlWs
} = {}) {
  return async function executeAuthoritativeLeave({ tableId, userId, requestId }) {
    const override = resolveLeaveTestOverride(env);
    if (override) {
      return normalizeValidatedResult({ result: override, tableId, userId, requestId, klog });
    }

    let module;
    try {
      module = await loadAuthoritativeLeaveModule();
    } catch (error) {
      klog("ws_leave_authoritative_unavailable", {
        tableId,
        userId,
        requestId: requestId || null,
        message: error?.message || "unknown"
      });
      return {
        ok: false,
        code: "temporarily_unavailable"
      };
    }

    try {
      const result = await module.executePokerLeave({
        beginSql: (fn) => beginSql(fn, { env }),
        tableId,
        userId,
        requestId,
        includeState: true,
        klog
      });
      return normalizeValidatedResult({ result, tableId, userId, requestId, klog });
    } catch (error) {
      klog("ws_leave_authoritative_failed", {
        tableId,
        userId,
        requestId: requestId || null,
        message: error?.message || "unknown",
        code: typeof error?.code === "string" ? error.code : null
      });
      return {
        ok: false,
        code: typeof error?.code === "string" ? error.code : "authoritative_leave_failed"
      };
    }
  };
}
