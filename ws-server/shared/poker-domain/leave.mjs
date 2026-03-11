function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export async function executePokerLeave({ tableId, userId, requestId, includeState, klog = () => {} } = {}) {
  const normalizedTableId = normalizeNonEmptyString(tableId);
  const normalizedUserId = normalizeNonEmptyString(userId);
  const normalizedRequestId = normalizeNonEmptyString(requestId);

  if (!normalizedTableId) {
    throw Object.assign(new Error("invalid_table_id"), { code: "invalid_table_id" });
  }
  if (!normalizedUserId) {
    throw Object.assign(new Error("invalid_user_id"), { code: "invalid_user_id" });
  }

  klog("ws_leave_authoritative_local", {
    tableId: normalizedTableId,
    userId: normalizedUserId,
    requestId: normalizedRequestId || null
  });

  const result = {
    ok: true,
    tableId: normalizedTableId,
    status: "left",
    state: {
      version: 1,
      state: {
        tableId: normalizedTableId,
        seats: []
      }
    }
  };

  if (includeState === false) {
    delete result.state;
  }

  return result;
}
