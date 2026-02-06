const AUTO_SITOUT_MISSED_TURNS = 2;
const MISSED_TURN_THRESHOLD = AUTO_SITOUT_MISSED_TURNS;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const collectSeatUserIds = (seats) => {
  const ids = new Set();
  if (!Array.isArray(seats)) return ids;
  for (const seat of seats) {
    if (typeof seat?.userId === "string" && seat.userId.trim()) {
      ids.add(seat.userId);
    }
  }
  return ids;
};

const ensurePendingAutoSitOut = (state, userId) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state, changed: false };
  if (typeof userId !== "string" || !userId.trim()) return { nextState: state, changed: false };
  const pending = isPlainObject(state.pendingAutoSitOutByUserId) ? state.pendingAutoSitOutByUserId : {};
  if (pending[userId]) return { nextState: state, changed: false };
  const nextPending = { ...pending, [userId]: true };
  return { nextState: { ...state, pendingAutoSitOutByUserId: nextPending }, changed: true };
};

const applyInactivityPolicy = (state, events = []) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { state, events };
  const missedTurnsByUserId = isPlainObject(state.missedTurnsByUserId) ? state.missedTurnsByUserId : {};
  const leftTableByUserId = isPlainObject(state.leftTableByUserId) ? state.leftTableByUserId : {};
  const sitOutByUserId = isPlainObject(state.sitOutByUserId) ? state.sitOutByUserId : {};
  const pendingAutoSitOutByUserId = isPlainObject(state.pendingAutoSitOutByUserId)
    ? state.pendingAutoSitOutByUserId
    : {};
  const seatUserIds = collectSeatUserIds(state.seats);
  let nextState = state;
  let changed = false;
  const nextEvents = Array.isArray(events) ? events.slice() : [];

  for (const [userId, missed] of Object.entries(missedTurnsByUserId)) {
    const missedCount = toSafeInt(missed, 0);
    if (!userId || missedCount < AUTO_SITOUT_MISSED_TURNS) continue;
    if (!seatUserIds.has(userId)) continue;
    if (leftTableByUserId[userId]) continue;
    if (sitOutByUserId[userId]) continue;
    if (pendingAutoSitOutByUserId[userId]) continue;
    const pendingResult = ensurePendingAutoSitOut(nextState, userId);
    if (!pendingResult.changed) continue;
    nextState = pendingResult.nextState;
    changed = true;
    nextEvents.push({ type: "PLAYER_AUTO_SITOUT_PENDING", userId, missedTurns: missedCount });
  }

  if (!changed) return { state, events };
  return { state: nextState, events: nextEvents };
};

export { AUTO_SITOUT_MISSED_TURNS, MISSED_TURN_THRESHOLD, applyInactivityPolicy };
