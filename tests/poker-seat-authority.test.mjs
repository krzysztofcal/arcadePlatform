import { describe, expect, it, vi } from "vitest";

vi.mock("../netlify/functions/_shared/poker-engine.mjs", async () => {
  const actual = await vi.importActual("../netlify/functions/_shared/poker-engine.mjs");
  return {
    ...actual,
    applyAction: vi.fn(() => {
      throw new Error("applyAction should not be called");
    }),
  };
});

vi.mock("../netlify/functions/_shared/supabase-admin.mjs", async () => {
  const actual = await vi.importActual("../netlify/functions/_shared/supabase-admin.mjs");
  return {
    ...actual,
    verifySupabaseJwt: vi.fn(async () => ({ valid: true, userId: "user-1" })),
    beginSql: vi.fn(async (fn) => {
      const responses = [
        [{ id: "table-1", status: "OPEN", stakes: {} }],
        [
          { user_id: "user-1", seat_no: 0, status: "ACTIVE", stack: 100 },
          { user_id: "user-2", seat_no: 1, status: "ACTIVE", stack: 100 },
        ],
        [
          {
            version: 4,
            state: {
              phase: "PREFLOP",
              actorSeat: 0,
              public: {
                seats: [
                  {
                    userId: "user-1",
                    seatNo: 2,
                    status: "ACTIVE",
                    stack: 100,
                    betThisStreet: 0,
                    hasFolded: false,
                    isAllIn: false,
                  },
                  {
                    userId: "user-2",
                    seatNo: 1,
                    status: "ACTIVE",
                    stack: 100,
                    betThisStreet: 0,
                    hasFolded: false,
                    isAllIn: false,
                  },
                ],
              },
            },
          },
        ],
      ];
      const tx = { unsafe: vi.fn(async () => responses.shift()) };
      return await fn(tx);
    }),
  };
});

import { handler } from "../netlify/functions/poker-act.mjs";
import { applyAction } from "../netlify/functions/_shared/poker-engine.mjs";

describe("poker-act seat authority", () => {
  it("rejects state when public seat numbers disagree with DB", async () => {
    const response = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tableId: "00000000-0000-0000-0000-000000000000",
        requestId: "req-seat-mismatch",
        actionType: "CHECK",
      }),
    });

    expect(applyAction).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(409);
    const payload = JSON.parse(response.body);
    expect(payload.error).toBe("state_invalid");
  });
});
