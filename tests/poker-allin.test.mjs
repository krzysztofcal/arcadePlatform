import { describe, expect, it } from "vitest";

import { applyAction, buildSidePots } from "../netlify/functions/_shared/poker-engine.mjs";

const makeBaseState = (overrides = {}) => ({
  phase: "FLOP",
  streetBet: 20,
  minRaiseTo: 30,
  lastFullRaiseSize: 10,
  raiseClosed: false,
  bbAmount: 10,
  potTotal: 0,
  contrib: {},
  public: {
    seats: [
      {
        userId: "actor",
        seatNo: 1,
        status: "ACTIVE",
        stack: 25,
        betThisStreet: 0,
        hasFolded: false,
        isAllIn: false,
      },
      {
        userId: "next",
        seatNo: 2,
        status: "ACTIVE",
        stack: 100,
        betThisStreet: 20,
        hasFolded: false,
        isAllIn: false,
      },
    ],
  },
  actedThisStreet: { 1: false, 2: false },
  actorSeat: 1,
  actionRequiredFromUserId: "actor",
  allowedActions: [],
  ...overrides,
});

describe("poker all-in and side pot behavior", () => {
  it("builds side pots with correct eligibility", () => {
    const seats = [
      { userId: "a", hasFolded: false },
      { userId: "b", hasFolded: false },
      { userId: "c", hasFolded: false },
    ];
    const contrib = { a: 5, b: 10, c: 20 };
    const sidePots = buildSidePots(contrib, seats);

    expect(sidePots).toEqual([
      { amount: 15, eligibleUserIds: ["a", "b", "c"] },
      { amount: 10, eligibleUserIds: ["b", "c"] },
      { amount: 10, eligibleUserIds: ["c"] },
    ]);
  });

  it("allows all-in call short without errors", () => {
    const state = makeBaseState({
      phase: "PREFLOP",
      streetBet: 10,
      minRaiseTo: 20,
      public: {
        seats: [
          {
            userId: "actor",
            seatNo: 1,
            status: "ACTIVE",
            stack: 5,
            betThisStreet: 0,
            hasFolded: false,
            isAllIn: false,
          },
          {
            userId: "next",
            seatNo: 2,
            status: "ACTIVE",
            stack: 50,
            betThisStreet: 10,
            hasFolded: false,
            isAllIn: false,
          },
        ],
      },
      actedThisStreet: { 1: false, 2: false },
      actionRequiredFromUserId: "actor",
    });

    const result = applyAction({
      currentState: state,
      actionType: "CALL",
      amount: null,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(true);
    const actorSeat = result.state.public.seats.find((seat) => seat.userId === "actor");
    expect(actorSeat.stack).toBe(0);
    expect(actorSeat.betThisStreet).toBe(5);
    expect(actorSeat.isAllIn).toBe(true);
  });

  it("does not reopen betting after an insufficient all-in raise", () => {
    const result = applyAction({
      currentState: makeBaseState(),
      actionType: "RAISE",
      amount: 25,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(true);
    expect(result.state.streetBet).toBe(25);
    expect(result.state.raiseClosed).toBe(true);
    expect(result.state.lastFullRaiseSize).toBe(10);
    const nextActor = result.state.public.seats.find((seat) => seat.userId === "next");
    expect(result.state.allowedActions).not.toContain("RAISE");
    expect(nextActor).toBeTruthy();
  });

  it("rejects raises when betting is closed", () => {
    const result = applyAction({
      currentState: makeBaseState({
        raiseClosed: true,
        streetBet: 20,
        minRaiseTo: 40,
        lastFullRaiseSize: 20,
      }),
      actionType: "RAISE",
      amount: 30,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("cannot_raise");
  });

  it("does not close a street until the closing seat acts", () => {
    const state = makeBaseState({
      phase: "FLOP",
      streetBet: 0,
      minRaiseTo: 10,
      lastFullRaiseSize: 10,
      raiseClosed: false,
      bbAmount: 10,
      deckSeed: 42,
      deckIndex: 0,
      board: ["2c", "3d", "4h"],
      closingSeat: 2,
      actorSeat: 1,
      actionRequiredFromUserId: "actor",
      actedThisStreet: { 1: false, 2: false },
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
            userId: "closer",
            seatNo: 2,
            status: "ACTIVE",
            stack: 50,
            betThisStreet: 0,
            hasFolded: false,
            isAllIn: false,
          },
        ],
      },
    });

    const first = applyAction({
      currentState: state,
      actionType: "CHECK",
      amount: null,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(first.ok).toBe(true);
    expect(first.state.phase).toBe("FLOP");
    expect(first.state.actionRequiredFromUserId).toBe("closer");
    expect(first.state.actorSeat).toBe(2);

    const second = applyAction({
      currentState: first.state,
      actionType: "CHECK",
      amount: null,
      userId: "closer",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(second.ok).toBe(true);
    expect(second.state.phase).toBe("TURN");
    expect(second.state.streetBet).toBe(0);
    second.state.public.seats.forEach((seat) => {
      expect(seat.betThisStreet).toBe(0);
    });
  });

  it("closes the street when the closing seat folds", () => {
    const state = makeBaseState({
      phase: "FLOP",
      streetBet: 0,
      minRaiseTo: 10,
      lastFullRaiseSize: 10,
      raiseClosed: false,
      bbAmount: 10,
      deckSeed: 42,
      deckIndex: 0,
      board: ["2c", "3d", "4h"],
      closingSeat: 1,
      actorSeat: 1,
      actionRequiredFromUserId: "actor",
      actedThisStreet: { 1: false, 2: false },
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
            userId: "closer",
            seatNo: 2,
            status: "ACTIVE",
            stack: 50,
            betThisStreet: 0,
            hasFolded: false,
            isAllIn: false,
          },
        ],
      },
    });

    const result = applyAction({
      currentState: state,
      actionType: "FOLD",
      amount: null,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("TURN");
  });

  it("rejects actions from an all-in or zero-stack seat", () => {
    const state = makeBaseState({
      phase: "FLOP",
      streetBet: 20,
      minRaiseTo: 30,
      lastFullRaiseSize: 10,
      raiseClosed: true,
      bbAmount: 10,
      deckSeed: 42,
      deckIndex: 0,
      board: ["2c", "3d", "4h"],
      closingSeat: 2,
      actorSeat: 1,
      actionRequiredFromUserId: "actor",
      actedThisStreet: { 1: true, 2: true },
      public: {
        seats: [
          {
            userId: "actor",
            seatNo: 1,
            status: "ACTIVE",
            stack: 0,
            betThisStreet: 20,
            hasFolded: false,
            isAllIn: true,
          },
          {
            userId: "closer",
            seatNo: 2,
            status: "ACTIVE",
            stack: 0,
            betThisStreet: 20,
            hasFolded: false,
            isAllIn: true,
          },
        ],
      },
    });

    const result = applyAction({
      currentState: state,
      actionType: "CHECK",
      amount: null,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("cannot_act");
  });

  it("advances street when the last legal action results in no one able to act", () => {
    const state = makeBaseState({
      phase: "FLOP",
      streetBet: 20,
      minRaiseTo: 30,
      lastFullRaiseSize: 10,
      raiseClosed: true,
      bbAmount: 10,
      deckSeed: 42,
      deckIndex: 0,
      board: ["2c", "3d", "4h"],
      closingSeat: 1,
      actorSeat: 1,
      actionRequiredFromUserId: "actor",
      actedThisStreet: { 1: false, 2: true },
      public: {
        seats: [
          {
            userId: "actor",
            seatNo: 1,
            status: "ACTIVE",
            stack: 5,
            betThisStreet: 0,
            hasFolded: false,
            isAllIn: false,
          },
          {
            userId: "closer",
            seatNo: 2,
            status: "ACTIVE",
            stack: 0,
            betThisStreet: 20,
            hasFolded: false,
            isAllIn: true,
          },
        ],
      },
    });

    const result = applyAction({
      currentState: state,
      actionType: "CALL",
      amount: null,
      userId: "actor",
      stakes: { bb: 10 },
      holeCards: {},
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("TURN");
  });
});
