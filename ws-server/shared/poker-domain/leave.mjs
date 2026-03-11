function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeMembers(members) {
  if (!Array.isArray(members)) {
    return [];
  }

  const normalized = [];
  for (const entry of members) {
    const userId = normalizeNonEmptyString(entry?.userId);
    const seat = Number(entry?.seat);
    if (!userId || !Number.isInteger(seat)) {
      continue;
    }
    normalized.push({ userId, seat });
  }
  return normalized;
}

export async function executePokerLeave({ tableId, userId, requestId, currentMembers, klog = () => {} } = {}) {
  const normalizedTableId = normalizeNonEmptyString(tableId);
  const normalizedUserId = normalizeNonEmptyString(userId);
  const normalizedRequestId = normalizeNonEmptyString(requestId);

  if (!normalizedTableId) {
    throw Object.assign(new Error("invalid_table_id"), { code: "invalid_table_id" });
  }
  if (!normalizedUserId) {
    throw Object.assign(new Error("invalid_user_id"), { code: "invalid_user_id" });
  }

  const members = normalizeMembers(currentMembers);
  const seats = members
    .filter((member) => member.userId !== normalizedUserId)
    .map((member) => ({ seatNo: member.seat, userId: member.userId }));
  const alreadyLeft = seats.length === members.length;

  klog("ws_leave_authoritative_local", {
    tableId: normalizedTableId,
    userId: normalizedUserId,
    requestId: normalizedRequestId || null,
    alreadyLeft
  });

  return {
    ok: true,
    tableId: normalizedTableId,
    status: alreadyLeft ? "already_left" : "left",
    state: {
      version: 1,
      state: {
        tableId: normalizedTableId,
        seats
      }
    }
  };
}
