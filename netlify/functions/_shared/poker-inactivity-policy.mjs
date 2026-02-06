import { setAutoSitOut } from "./poker-sitout-flag.mjs";

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

const applyInactivityPolicy = (state, events = []) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { state, events };
  const missedTurnsByUserId = isPlainObject(state.missedTurnsByUserId) ? state.missedTurnsByUserId : {};
  const sitOutByUserId = isPlainObject(state.sitOutByUserId) ? state.sitOutByUserId : {};
  const leftTableByUserId = isPlainObject(state.leftTableByUserId) ? state.leftTableByUserId : {};
  const seatUserIds = collectSeatUserIds(state.seats);
  let nextSitOut = sitOutByUserId;
  let changed = false;
  const nextEvents = Array.isArray(events) ? events.slice() : [];

  for (const [userId, missed] of Object.entries(missedTurnsByUserId)) {
    const missedCount = toSafeInt(missed, 0);
    if (!userId || missedCount < AUTO_SITOUT_MISSED_TURNS) continue;
    if (!seatUserIds.has(userId)) continue;
    if (leftTableByUserId[userId]) continue;
    if (nextSitOut[userId]) continue;
    const baseState = { ...state, sitOutByUserId: nextSitOut };
    const autoResult = setAutoSitOut(baseState, userId, missedCount);
    if (autoResult.changed) {
      nextSitOut = autoResult.nextState.sitOutByUserId || nextSitOut;
      changed = true;
      if (autoResult.event) nextEvents.push(autoResult.event);
    }
  }

  if (!changed) return { state, events };
  return { state: { ...state, sitOutByUserId: nextSitOut }, events: nextEvents };
};

export { AUTO_SITOUT_MISSED_TURNS, MISSED_TURN_THRESHOLD, applyInactivityPolicy };
