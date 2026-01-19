import { describe, expect, it } from "vitest";

import { toPublicState } from "../netlify/functions/_shared/poker-engine.mjs";

const makeSettledState = (phase = "SETTLED") => ({
  phase,
  public: {
    seats: [
      {
        userId: "player-1",
        seatNo: 0,
        status: "ACTIVE",
        stack: 50,
        betThisStreet: 0,
        hasFolded: false,
        isAllIn: false,
      },
    ],
  },
  settled: {
    winners: ["player-1"],
    revealed: { "player-1": ["Ah", "Kd"] },
  },
});

describe("toPublicState showdown reveal policy", () => {
  it("hides revealed cards from unseated viewers", () => {
    const result = toPublicState(makeSettledState(), "spectator");
    expect(result.settled.revealed).toBeUndefined();
  });

  it("keeps revealed cards for seated viewers", () => {
    const result = toPublicState(makeSettledState(), "player-1");
    expect(result.settled.revealed).toEqual({ "player-1": ["Ah", "Kd"] });
  });

  it("removes revealed cards outside settled phase", () => {
    const result = toPublicState(makeSettledState("RIVER"), "player-1");
    expect(result.settled.revealed).toBeUndefined();
  });

  it("clears allowedActions for non-actors", () => {
    const state = {
      ...makeSettledState(),
      actionRequiredFromUserId: "actor",
      allowedActions: ["CHECK", "BET"],
    };
    const result = toPublicState(state, "observer");
    expect(result.allowedActions).toEqual([]);
  });

  it("keeps allowedActions for the actor", () => {
    const state = {
      ...makeSettledState(),
      actionRequiredFromUserId: "actor",
      allowedActions: ["CHECK", "BET"],
    };
    const result = toPublicState(state, "actor");
    expect(result.allowedActions).toEqual(["CHECK", "BET"]);
  });
});
