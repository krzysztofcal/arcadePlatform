
async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

async function loadHttpAuthoritativeJoinModule() {
  return import("../../../shared/poker-domain/join.mjs");
}

function resolveJoinTestOverride(env = process.env) {
  const raw = env.WS_TEST_AUTHORITATIVE_JOIN_RESULT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeJoinError(error) {
  const code = typeof error?.code === "string" ? error.code : "authoritative_join_failed";
  if (["table_not_found", "table_closed", "table_not_open", "seat_taken", "table_full", "table_full_bot_leaving", "state_missing", "state_invalid", "duplicate_seat", "invalid_seat_no", "invalid_buy_in", "request_pending"].includes(code)) {
    return { ok: false, code };
  }
  return { ok: false, code: "authoritative_join_failed" };
}

function normalizeSuccess(result, { tableId, userId, requestId, klog }) {
  if (!result?.ok) return result;
  const seatNo = Number(result?.seatNo);
  if (!Number.isInteger(seatNo) || seatNo < 1) {
    klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "invalid_seat" });
    return { ok: false, code: "authoritative_state_invalid" };
  }
  return { ok: true, tableId, userId, seatNo, rejoin: result?.rejoin === true, requestId: requestId || null };
}

export function createAuthoritativeJoinExecutor({
  env = process.env,
  klog = () => {},
  beginSql = beginSqlDefault,
  loadJoinModule = loadHttpAuthoritativeJoinModule,
} = {}) {
  return async function executeAuthoritativeJoin({ tableId, userId, requestId }) {
    const override = resolveJoinTestOverride(env);
    if (override) {
      return override;
    }

    let joinModule;
    try {
      joinModule = await loadJoinModule();
    } catch (error) {
      klog("ws_join_authoritative_unavailable", {
        tableId,
        userId,
        requestId: requestId || null,
        message: error?.message || "unknown",
      });
      return { ok: false, code: "temporarily_unavailable" };
    }

    if (typeof joinModule?.executePokerJoinAuthoritative !== "function") {
      klog("ws_join_authoritative_unavailable", {
        tableId,
        userId,
        requestId: requestId || null,
        message: "missing_executePokerJoinAuthoritative",
      });
      return { ok: false, code: "temporarily_unavailable" };
    }

    try {
      const result = await joinModule.executePokerJoinAuthoritative({
        beginSql: (fn) => beginSql(fn, { env }),
        tableId,
        userId,
        requestId,
        klog,
      });
      return normalizeSuccess(result, { tableId, userId, requestId, klog });
    } catch (error) {
      klog("ws_join_authoritative_failed", {
        tableId,
        userId,
        requestId: requestId || null,
        code: typeof error?.code === "string" ? error.code : null,
        message: error?.message || "unknown",
      });
      return normalizeJoinError(error);
    }
  };
}
