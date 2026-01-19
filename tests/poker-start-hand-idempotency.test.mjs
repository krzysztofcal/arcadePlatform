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
    beginSql: vi.fn(),
  };
});

import { handler } from "../netlify/functions/poker-start-hand.mjs";
import { initHand } from "../netlify/functions/_shared/poker-engine.mjs";
import { beginSql } from "../netlify/functions/_shared/supabase-admin.mjs";

const buildDefaultResponses = () => [
  [{ id: "table-1", status: "OPEN", stakes: {} }],
  [{ version: 2, state: { phase: "PREFLOP", handId: "hand_1", public: { seats: [] } } }],
  [{ user_id: "user-1" }],
  [{ version: 2 }],
  [{ version: 2, state: { phase: "PREFLOP", handId: "hand_1", public: { seats: [] } } }],
  [{ cards: ["Ah", "Kd"] }],
];

describe("poker-start-hand idempotency handling", () => {
  it("returns latest state after request id unique violation", async () => {
    const uniqueError = new Error("duplicate key value violates unique constraint poker_actions_request_id_unique");
    uniqueError.code = "23505";
    uniqueError.constraint = "poker_actions_request_id_unique";

    beginSql
      .mockImplementationOnce(async () => {
        throw uniqueError;
      })
      .mockImplementationOnce(async (fn) => {
        const responses = [
          [{ version: 5, state: { phase: "FLOP", handId: "hand_5", public: { seats: [] } } }],
          [{ cards: ["9h", "9d"] }],
        ];
        const tx = { unsafe: vi.fn(async () => responses.shift()) };
        return await fn(tx);
      });

    const response = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json", origin: "https://example.netlify.app" },
      body: JSON.stringify({
        tableId: "00000000-0000-0000-0000-000000000000",
        requestId: "req-start-unique",
      }),
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.ok).toBe(true);
    expect(payload.version).toBe(5);
    expect(payload.state).toBeTruthy();
  });

  it("returns latest state without reinitializing when requestId is reused", async () => {
    beginSql.mockImplementationOnce(async (fn) => {
      const responses = buildDefaultResponses();
      const tx = { unsafe: vi.fn(async () => responses.shift()) };
      return await fn(tx);
    });

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
