const MIN_SEATS = 1;
const MAX_SEATS = 10;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidMemberShape(member) {
  return isPlainObject(member) && typeof member.userId === "string" && member.userId.trim() !== "" && Number.isInteger(member.seat);
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
    members: state.members.map((member) => ({ userId: member.userId, seat: member.seat })),
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

  if (!Array.isArray(state.members) || !state.members.every(isValidMemberShape)) {
    return { ok: false, error: { code: "invalid_state_members" } };
  }

  if (!isPlainObject(state.seats)) {
    return { ok: false, error: { code: "invalid_state_seats" } };
  }

  if (!Array.isArray(state.appliedRequestIds) || !state.appliedRequestIds.every((id) => typeof id === "string")) {
    return { ok: false, error: { code: "invalid_state_request_ids" } };
  }

  const seenUserIds = new Set();
  const seenSeats = new Set();

  for (const member of state.members) {
    if (member.seat < MIN_SEATS || member.seat > state.maxSeats) {
      return { ok: false, error: { code: "invalid_state_member_seat" } };
    }

    if (seenUserIds.has(member.userId) || seenSeats.has(member.seat)) {
      return { ok: false, error: { code: "invalid_state_duplicate_member" } };
    }

    seenUserIds.add(member.userId);
    seenSeats.add(member.seat);

    if (state.seats[member.userId] !== member.seat) {
      return { ok: false, error: { code: "invalid_state_seat_mismatch" } };
    }
  }

  for (const [userId, seat] of Object.entries(state.seats)) {
    if (typeof userId !== "string" || userId.trim() === "" || !Number.isInteger(seat)) {
      return { ok: false, error: { code: "invalid_state_seats" } };
    }

    if (seat < MIN_SEATS || seat > state.maxSeats) {
      return { ok: false, error: { code: "invalid_state_member_seat" } };
    }

    const matchingMember = state.members.find((member) => member.userId === userId && member.seat === seat);
    if (!matchingMember) {
      return { ok: false, error: { code: "invalid_state_seat_mismatch" } };
    }
  }

  return { ok: true };
}
