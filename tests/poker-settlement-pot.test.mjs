import { describe, expect, it } from "vitest";

import { buildSidePots } from "../netlify/functions/_shared/poker-engine.mjs";

describe("poker side pot accounting", () => {
  it("totals side pots to total contributions", () => {
    const contrib = { a: 50, b: 30, c: 20 };
    const seats = [
      { userId: "a", hasFolded: false },
      { userId: "b", hasFolded: false },
      { userId: "c", hasFolded: true },
    ];
    const sidePots = buildSidePots(contrib, seats);
    const totalPots = sidePots.reduce((sum, pot) => sum + pot.amount, 0);
    const totalContrib = Object.values(contrib).reduce((sum, value) => sum + value, 0);

    expect(totalPots).toBe(totalContrib);
  });
});
