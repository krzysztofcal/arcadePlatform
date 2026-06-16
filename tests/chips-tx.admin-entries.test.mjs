import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLog = vi.fn();

vi.mock("../netlify/functions/_shared/supabase-admin.mjs", () => {
  const baseHeaders = () => ({ "content-type": "application/json" });
  const corsHeaders = (origin) => {
    if (!origin) return null;
    return { ...baseHeaders(), "access-control-allow-origin": origin };
  };
  const extractBearerToken = (headers) => {
    const headerValue = headers?.authorization || headers?.Authorization;
    if (!headerValue || typeof headerValue !== "string") return null;
    const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
    return match ? match[1] : null;
  };
  const verifySupabaseJwt = vi.fn(async (token) => {
    if (!token) return { provided: false, valid: false, userId: null, reason: "missing_token" };
    return { provided: true, valid: true, userId: "user-1", reason: "ok" };
  });

  return {
    baseHeaders,
    corsHeaders,
    extractBearerToken,
    verifySupabaseJwt,
    klog: mockLog,
  };
});

vi.mock("../netlify/functions/_shared/chips-ledger.mjs", () => ({
  postTransaction: vi.fn(async () => ({
    transaction: { id: "tx-1" },
    entries: [],
    account: { id: "acct-1" },
  })),
}));

async function loadHandler() {
  const mod = await import("../netlify/functions/chips-tx.mjs");
  return { handler: mod.handler };
}

const baseEvent = (body, headers = {}) => ({
  httpMethod: "POST",
  headers: {
    origin: "https://arcade.test",
    authorization: "Bearer user-1",
    ...headers,
  },
  body: JSON.stringify(body),
});

const entriesPayload = {
  txType: "CASH_OUT",
  idempotencyKey: "entries-1",
  entries: [
    { accountType: "USER", amount: 100 },
    { accountType: "SYSTEM", systemKey: "TREASURY", amount: -100 },
  ],
};

describe("chips-tx admin gating for custom entries", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLog.mockClear();
    process.env.CHIPS_ENABLED = "1";
    process.env.CHIPS_ADMIN_SECRET = "test-admin-secret";
  });

  it("rejects custom entries without admin header", async () => {
    const { handler } = await loadHandler();
    const response = await handler(baseEvent(entriesPayload));

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: "admin_required" });
  });

  it("allows custom entries with correct admin header", async () => {
    const { handler } = await loadHandler();
    const response = await handler(baseEvent(entriesPayload, { "x-chips-admin-secret": "test-admin-secret" }));

    expect(response.statusCode).not.toBe(403);
    expect(JSON.parse(response.body).error).not.toBe("admin_required");
  });

  it("fails closed when entries present and secret missing", async () => {
    delete process.env.CHIPS_ADMIN_SECRET;
    const { handler } = await loadHandler();
    const response = await handler(baseEvent(entriesPayload));

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "server_misconfigured" });
  });

  it("does not block normal cash out without entries", async () => {
    const { handler } = await loadHandler();
    const response = await handler(baseEvent({
      txType: "CASH_OUT",
      idempotencyKey: "no-entries",
      amount: 50,
    }));

    expect(response.statusCode).not.toBe(403);
    expect(JSON.parse(response.body).error).not.toBe("admin_required");
  });
});
