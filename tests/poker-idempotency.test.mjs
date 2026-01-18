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
        [{ user_id: "user-1", seat_no: 1, status: "ACTIVE", stack: 100 }],
        [{ version: 3, state: { phase: "PREFLOP", handId: "hand_1", public: { seats: [] } } }],
        [{ id: "marker", version: 3 }],
        [{ version: 3, state: { phase: "PREFLOP", handId: "hand_1", public: { seats: [] } } }],
        [{ cards: ["Ah", "Kd"] }],
      ];
      const tx = { unsafe: vi.fn(async () => responses.shift()) };
      return await fn(tx);
    }),
  };
});

import { handler } from "../netlify/functions/poker-act.mjs";
import { applyAction } from "../netlify/functions/_shared/poker-engine.mjs";

describe("poker-act idempotency marker handling", () => {
  it("returns latest state without applying action when marker exists", async () => {
    const response = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json", origin: "https://example.netlify.app" },
      body: JSON.stringify({
        tableId: "00000000-0000-0000-0000-000000000000",
        requestId: "req-1",
        actionType: "CHECK",
      }),
    });

    expect(applyAction).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.ok).toBe(true);
    expect(payload.version).toBe(3);
    expect(payload.state).toBeTruthy();
  });
});
