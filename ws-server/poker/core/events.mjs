function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const CORE_EVENT_TYPES = {
  JOIN: "core_join",
  LEAVE: "core_leave",
  RESET: "core_reset"
};

export function normalizeCoreEvent(event) {
  if (!isPlainObject(event)) {
    return { ok: false, error: { code: "invalid_event" } };
  }

  if (typeof event.type !== "string" || event.type.trim() === "") {
    return { ok: false, error: { code: "invalid_event_type" } };
  }

  if (typeof event.requestId !== "string" || event.requestId.trim() === "") {
    return { ok: false, error: { code: "invalid_request_id" } };
  }

  if (event.type === CORE_EVENT_TYPES.JOIN || event.type === CORE_EVENT_TYPES.LEAVE) {
    if (typeof event.userId !== "string" || event.userId.trim() === "") {
      return { ok: false, error: { code: "invalid_user_id" } };
    }
  }

  return {
    ok: true,
    event: {
      type: event.type,
      requestId: event.requestId,
      userId: event.userId
    }
  };
}
