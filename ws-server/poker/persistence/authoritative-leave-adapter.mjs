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

export function createAuthoritativeLeaveExecutor({ env = process.env, klog = () => {} } = {}) {
  return async function executeAuthoritativeLeave({ tableId, userId, requestId }) {
    const override = resolveLeaveTestOverride(env);
    if (override) {
      return override;
    }

    try {
      const module = await import("../../../shared/poker-domain/leave.mjs");
      return module.executePokerLeave({
        beginSql: (fn) => beginSqlWs(fn, { env }),
        tableId,
        userId,
        requestId,
        includeState: true,
        klog
      });
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
  };
}
