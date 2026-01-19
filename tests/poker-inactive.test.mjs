import { describe, expect, it } from "vitest";

import { applyAction } from "../netlify/functions/_shared/poker-engine.mjs";

const makeState = () => ({
  phase: "FLOP",
  streetBet: 0,
  minRaiseTo: 10,
  lastFullRaiseSize: 10,
  raiseClosed: false,
  bbAmount: 10,
  potTotal: 0,
  contrib: {},
  deckSeed: 42,
  deckIndex: 0,
  board: ["2c", "3d", "4h"],
  actorSeat: 1,
  closingSeat: 3,
  actedThisStreet: { 1: false, 2: false, 3: false },
  actionRequiredFromUserId: "actor",
  allowedActions: [],
  public: {
    seats: [
      {
        userId: "actor",
        seatNo: 1,
        status: "ACTIVE",
        stack: 50,
        betThisStreet: 0,
        hasFolded: false,
        isAllIn: false,
      },
      {
        userId: "inactive",
        seatNo: 2,
        status: "INACTIVE",
        stack: 50,
        betThisStreet: 0,
        hasFolded: false,
        isAllIn: false,
      },
      {
        userId: "next",
        seatNo: 3,
        status: "ACTIVE",
        stack: 50,
        betThisStreet: 0,
        hasFolded: false,
        isAllIn: false,
      },
    ],
  },
});

describe("inactive seats", () => {
  it("skips inactive seats when advancing actor", () => {
    const result = applyAction({
      currentState: makeState(),
      actionType: "CHECK",
      amount: null,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(true);
    expect(result.state.actionRequiredFromUserId).toBe("next");
    expect(result.state.actorSeat).toBe(3);
  });

  it("rejects actions from inactive seats", () => {
    const result = applyAction({
      currentState: {
        ...makeState(),
        actorSeat: 2,
        actionRequiredFromUserId: "inactive",
      },
      actionType: "CHECK",
      amount: null,
      userId: "inactive",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("cannot_act");
  });
});
