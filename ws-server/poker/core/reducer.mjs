import { normalizeCoreEvent, CORE_EVENT_TYPES } from "./events.mjs";
import { cloneCoreState, validateCoreState } from "./state.mjs";

function withAppliedRequestId(state, requestId) {
  state.appliedRequestIds = [...state.appliedRequestIds, requestId];
  state.version += 1;
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
      if (nextState.members.includes(event.userId)) {
        withAppliedRequestId(nextState, event.requestId);
        return {
          ok: true,
          state: nextState,
          effects: [{ type: "noop", reason: "already_member" }]
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

      nextState.members = [...nextState.members, event.userId];
      withAppliedRequestId(nextState, event.requestId);
      return {
        ok: true,
        state: nextState,
        effects: [{ type: "member_joined", userId: event.userId }]
      };
    }

    case CORE_EVENT_TYPES.LEAVE: {
      const memberIndex = nextState.members.indexOf(event.userId);
      if (memberIndex === -1) {
        withAppliedRequestId(nextState, event.requestId);
        return {
          ok: true,
          state: nextState,
          effects: [{ type: "noop", reason: "not_member" }]
        };
      }

      nextState.members = nextState.members.filter((memberId) => memberId !== event.userId);
      withAppliedRequestId(nextState, event.requestId);
      return {
        ok: true,
        state: nextState,
        effects: [{ type: "member_left", userId: event.userId }]
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
