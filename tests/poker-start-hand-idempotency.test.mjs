import { describe, expect, it, vi } from "vitest";

vi.mock("../netlify/functions/_shared/poker-engine.mjs", async () => {
  const actual = await vi.importActual("../netlify/functions/_shared/poker-engine.mjs");
  return {
    ...actual,
    initHand: vi.fn(() => {
      throw new Error("initHand should not be called");
    }),
  };
});

vi.mock("../netlify/functions/_shared/supabase-admin.mjs", async () => {
  const actual = await vi.importActual("../netlify/functions/_shared/supabase-admin.mjs");
  return {
    ...actual,
    baseHeaders: vi.fn(() => ({})),
    corsHeaders: vi.fn(() => ({})),
    verifySupabaseJwt: vi.fn(async () => ({ valid: true, userId: "user-1" })),
    beginSql: vi.fn(async (fn) => {
      const responses = [
        [{ id: "table-1", status: "OPEN", stakes: {} }],
        [{ version: 2, state: { phase: "PREFLOP", handId: "hand_1", public: { seats: [] } } }],
        [{ user_id: "user-1" }],
        [{ version: 2 }],
        [{ version: 2, state: { phase: "PREFLOP", handId: "hand_1", public: { seats: [] } } }],
        [{ cards: ["Ah", "Kd"] }],
      ];
      const tx = { unsafe: vi.fn(async () => responses.shift()) };
      return await fn(tx);
    }),
  };
});

import { handler } from "../netlify/functions/poker-start-hand.mjs";
import { initHand } from "../netlify/functions/_shared/poker-engine.mjs";

describe("poker-start-hand idempotency handling", () => {
  it("returns latest state without reinitializing when requestId is reused", async () => {
    const response = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json", origin: "https://example.netlify.app" },
      body: JSON.stringify({
        tableId: "00000000-0000-0000-0000-000000000000",
        requestId: "req-start-1",
      }),
    });

    expect(initHand).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.ok).toBe(true);
    expect(payload.state).toBeTruthy();
  });
});
