import { describe, expect, it } from "vitest";

import { initHand } from "../netlify/functions/_shared/poker-engine.mjs";

const makeSeats = () => [
  { userId: "a", seatNo: 0, status: "ACTIVE" },
  { userId: "b", seatNo: 1, status: "ACTIVE" },
];

describe("poker initHand basics", () => {
  it("sets actor and allowed actions with blinds posted", () => {
    const result = initHand({
      tableId: "table-1",
      seats: makeSeats(),
      stacks: { a: 100, b: 100 },
      stakes: { sb: 1, bb: 2 },
      prevState: {},
    });

    expect(result.ok).toBe(true);
    expect(result.state.actionRequiredFromUserId).toBeTruthy();
    expect(result.state.allowedActions.length).toBeGreaterThan(0);
    expect(result.state.potTotal).toBe(3);
    expect(result.state.deckIndex).toBe(4);
    expect(result.state.public.seats[0].stack + result.state.public.seats[1].stack).toBe(197);
    expect(Object.keys(result.holeCards).length).toBe(2);
  });
});
