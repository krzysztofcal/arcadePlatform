import { normalizeCoreEvent, CORE_EVENT_TYPES } from "./events.mjs";
import { cloneCoreState, validateCoreState } from "./state.mjs";

function withAppliedRequestId(state, requestId) {
  state.appliedRequestIds = [...state.appliedRequestIds, requestId];
  state.version += 1;
}

function findLowestAvailableSeat(state) {
  const usedSeats = new Set(state.members.map((member) => member.seat));
  for (let seat = 1; seat <= state.maxSeats; seat += 1) {
    if (!usedSeats.has(seat)) {
      return seat;
    }
  }
  return null;
}

export function applyCoreEvent(previousState, rawEvent) {
  const stateValidation = validateCoreState(previousState);
  if (!stateValidation.ok) {
    return {
      ok: false,
      state: previousState,
      effects: [],
      error: stateValidation.error
    };
  }

  const normalized = normalizeCoreEvent(rawEvent);
  if (!normalized.ok) {
    return {
      ok: false,
      state: previousState,
      effects: [],
      error: normalized.error
    };
  }

  const { event } = normalized;

  if (previousState.appliedRequestIds.includes(event.requestId)) {
    return {
      ok: true,
      state: previousState,
      effects: [{ type: "noop", reason: "already_applied" }]
    };
  }

  const nextState = cloneCoreState(previousState);

  switch (event.type) {
    case CORE_EVENT_TYPES.JOIN: {
      const existingMember = nextState.members.find((member) => member.userId === event.userId);
      if (existingMember) {
        withAppliedRequestId(nextState, event.requestId);
        return {
          ok: true,
          state: nextState,
          effects: [{ type: "noop", reason: "already_member", userId: existingMember.userId, seat: existingMember.seat }]
        };
      }

      if (nextState.members.length >= nextState.maxSeats) {
        return {
          ok: false,
          state: previousState,
          effects: [],
          error: { code: "bounds_exceeded" }
        };
      }

      const seat = findLowestAvailableSeat(nextState);
      if (!seat) {
        return {
          ok: false,
          state: previousState,
          effects: [],
          error: { code: "bounds_exceeded" }
        };
      }

      nextState.members = [...nextState.members, { userId: event.userId, seat }];
      nextState.seats = { ...nextState.seats, [event.userId]: seat };
      withAppliedRequestId(nextState, event.requestId);
      return {
        ok: true,
        state: nextState,
        effects: [{ type: "member_joined", userId: event.userId, seat }]
      };
    }

    case CORE_EVENT_TYPES.LEAVE: {
      const existingMember = nextState.members.find((member) => member.userId === event.userId);
      if (!existingMember) {
        withAppliedRequestId(nextState, event.requestId);
        return {
          ok: true,
          state: nextState,
          effects: [{ type: "noop", reason: "not_member" }]
        };
      }

      nextState.members = nextState.members.filter((member) => member.userId !== event.userId);
      const nextSeats = { ...nextState.seats };
      delete nextSeats[event.userId];
      nextState.seats = nextSeats;
      withAppliedRequestId(nextState, event.requestId);
      return {
        ok: true,
        state: nextState,
        effects: [{ type: "member_left", userId: event.userId, seat: existingMember.seat }]
      };
    }

    case CORE_EVENT_TYPES.RESET: {
      nextState.members = [];
      nextState.seats = {};
      withAppliedRequestId(nextState, event.requestId);
      return {
        ok: true,
        state: nextState,
        effects: [{ type: "table_reset" }]
      };
    }

    default:
      return {
        ok: false,
        state: previousState,
        effects: [],
        error: { code: "unsupported_event" }
      };
  }
}
