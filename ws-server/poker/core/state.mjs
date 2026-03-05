const MIN_SEATS = 1;
const MAX_SEATS = 10;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createInitialCoreState(input = {}) {
  const roomId = typeof input.roomId === "string" && input.roomId.trim() !== "" ? input.roomId : "";
  const maxSeats = Number.isInteger(input.maxSeats) ? input.maxSeats : 0;

  return {
    roomId,
    maxSeats,
    version: 0,
    members: [],
    seats: {},
    appliedRequestIds: []
  };
}

export function cloneCoreState(state) {
  return {
    roomId: state.roomId,
    maxSeats: state.maxSeats,
    version: state.version,
    members: [...state.members],
    seats: { ...state.seats },
    appliedRequestIds: [...state.appliedRequestIds]
  };
}

export function validateCoreState(state) {
  if (!isPlainObject(state)) {
    return { ok: false, error: { code: "invalid_state" } };
  }

  if (typeof state.roomId !== "string" || state.roomId.trim() === "") {
    return { ok: false, error: { code: "invalid_state_room_id" } };
  }

  if (!Number.isInteger(state.maxSeats) || state.maxSeats < MIN_SEATS || state.maxSeats > MAX_SEATS) {
    return { ok: false, error: { code: "invalid_state_max_seats" } };
  }

  if (!Number.isInteger(state.version) || state.version < 0) {
    return { ok: false, error: { code: "invalid_state_version" } };
  }

  if (!Array.isArray(state.members) || !state.members.every((memberId) => typeof memberId === "string")) {
    return { ok: false, error: { code: "invalid_state_members" } };
  }

  if (!isPlainObject(state.seats)) {
    return { ok: false, error: { code: "invalid_state_seats" } };
  }

  if (!Array.isArray(state.appliedRequestIds) || !state.appliedRequestIds.every((id) => typeof id === "string")) {
    return { ok: false, error: { code: "invalid_state_request_ids" } };
  }

  return { ok: true };
}
