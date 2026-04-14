const LIVE_HAND_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSeatNo(value) {
  const seatNo = Number(value);
  return Number.isInteger(seatNo) && seatNo >= 1 ? seatNo : null;
}

export function isLiveHandPhase(phase) {
  const normalized = typeof phase === "string" ? phase.trim().toUpperCase() : "";
  return LIVE_HAND_PHASES.has(normalized);
}

export function resolveRetainedLiveHandSeat(state, userId) {
  if (!isLiveHandPhase(state?.phase)) return null;
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) return null;
  const leftTableByUserId = isPlainObject(state?.leftTableByUserId) ? state.leftTableByUserId : {};
  if (leftTableByUserId[normalizedUserId] !== true) return null;
  const stateSeats = Array.isArray(state?.seats) ? state.seats : [];
  for (const seat of stateSeats) {
    const seatUserId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
    if (seatUserId !== normalizedUserId) continue;
    const seatNo = normalizeSeatNo(seat?.seatNo ?? seat?.seat);
    if (seatNo !== null) {
      return {
        ...seat,
        userId: normalizedUserId,
        seatNo
      };
    }
  }
  return null;
}
