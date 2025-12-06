import crypto from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseJsonBody } from "./helpers/xp-test-helpers.mjs";

const mockData = new Map();

const pipelineFactory = () => {
  const operations = [];
  const pipeline = {
    operations,
    incrby: vi.fn((key, value) => {
      operations.push({ op: "incrby", key, value });
      const current = Number(mockData.get(key) || 0);
      mockData.set(key, String(current + Number(value)));
      return pipeline;
    }),
    del: vi.fn((key) => {
      operations.push({ op: "del", key });
      mockData.delete(key);
      return pipeline;
    }),
    set: vi.fn((key, value) => {
      operations.push({ op: "set", key, value });
      mockData.set(key, value);
      return pipeline;
    }),
    exec: vi.fn(() => Promise.resolve(operations)),
  };
  return pipeline;
};

const store = {
  get: vi.fn((key) => Promise.resolve(mockData.get(key) ?? null)),
  set: vi.fn((key, value) => {
    mockData.set(key, value);
    return Promise.resolve("OK");
  }),
  setex: vi.fn((key, ttl, value) => {
    mockData.set(key, value);
    return Promise.resolve("OK");
  }),
  del: vi.fn((key) => {
    mockData.delete(key);
    return Promise.resolve(1);
  }),
  eval: vi.fn(() => Promise.resolve([10, 10, 10, 10, Date.now(), 0])),
  pipeline: vi.fn(() => {
    const pipeline = pipelineFactory();
    store._lastPipeline = pipeline;
    return pipeline;
  }),
  _mockData: mockData,
  _reset: () => {
    mockData.clear();
    store.eval.mockClear();
    store.get.mockClear();
    store.set.mockClear();
    store.setex.mockClear();
    store.del.mockClear();
    store.pipeline.mockClear();
    store._lastPipeline = null;
  },
};

vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => ({ store }));

const buildSessionToken = ({ sessionId, userId, fingerprint, secret, createdAt = Date.now() }) => {
  const payload = JSON.stringify({ sid: sessionId, uid: userId, ts: createdAt, fp: fingerprint });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${encoded}.${signature}`;
};

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function loadStartSession() {
  const mod = await import("../netlify/functions/start-session.mjs");
  return { handler: mod.handler };
}

async function loadAwardXp() {
  const mod = await import("../netlify/functions/award-xp.mjs");
  return { handler: mod.handler };
}

async function loadCalculateXp() {
  const mod = await import("../netlify/functions/calculate-xp.mjs");
  return { handler: mod.handler };
}

describe("session token plumbing", () => {
  beforeEach(() => {
    vi.resetModules();
    store._reset();
    process.env.XP_KEY_NS = "test:xp:v2";
    process.env.XP_DEBUG = "1";
    process.env.XP_DAILY_SECRET = "test-secret-for-sessions-32chars!";
    process.env.SUPABASE_JWT_SECRET = "test_supabase_jwt_secret_12345678901234567890";
  });

  it("S1: start-session issues token and stores session", async () => {
    process.env.XP_SESSION_TTL_SEC = "600";
    const { handler } = await loadStartSession();

    const response = await handler({
      httpMethod: "POST",
      headers: {
        origin: "https://play.kcswh.pl",
        "user-agent": "VitestTest/1.0",
      },
      body: JSON.stringify({ anonId: "anon-555" }),
      queryStringParameters: {},
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBeTruthy();
    expect(body.sessionToken).toBeTruthy();
    const stored = store._mockData.get(`${process.env.XP_KEY_NS}:server-session:${body.sessionId}`);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored);
    expect(parsed.userId).toBe("anon-555");
    expect(parsed.fingerprint).toBeTruthy();
  });

  it("S2: award-xp enforces valid server session when required", async () => {
    process.env.XP_REQUIRE_SERVER_SESSION = "1";
    process.env.XP_SERVER_SESSION_WARN_MODE = "0";
    const secret = process.env.XP_DAILY_SECRET;
    const { handler } = await loadAwardXp();

    const missing = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ userId: "user-1", sessionId: "sess-1", delta: 10 }),
    });

    const missingBody = parseJsonBody(missing);
    expect(missing.statusCode).toBe(401);
    expect(missingBody.error).toBe("invalid_session");
    expect(missingBody.requiresNewSession).toBe(true);

    const fingerprint = hash("Vitest/UA").substring(0, 16);
    const sessionToken = buildSessionToken({
      sessionId: "sess-valid",
      userId: "user-1",
      fingerprint,
      secret,
    });
    store.setex(`${process.env.XP_KEY_NS}:server-session:sess-valid`, 600, JSON.stringify({
      userId: "user-1",
      createdAt: Date.now(),
      fingerprint,
      ipHash: hash("127.0.0.1").substring(0, 16),
      lastActivity: Date.now(),
    }));

    store.eval.mockResolvedValue([10, 10, 10, 10, Date.now(), 0]);
    const valid = await handler({
      httpMethod: "POST",
      headers: { "user-agent": "Vitest/UA" },
      body: JSON.stringify({
        userId: "user-1",
        sessionId: "sess-valid",
        sessionToken,
        delta: 10,
        ts: Date.now(),
      }),
    });

    const validBody = parseJsonBody(valid);
    expect(valid.statusCode).toBe(200);
    expect(validBody.ok).toBe(true);
    expect(validBody.error).toBeUndefined();
  });

  it("S3: warn mode allows invalid session tokens", async () => {
    process.env.XP_REQUIRE_SERVER_SESSION = "0";
    process.env.XP_SERVER_SESSION_WARN_MODE = "1";
    const { handler } = await loadAwardXp();

    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ userId: "user-warn", sessionId: "sess-warn", delta: 5, sessionToken: "broken" }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(store.eval).toHaveBeenCalled();
  });

  it("S4: calculate-xp validates session token coherence", async () => {
    process.env.XP_REQUIRE_SERVER_SESSION = "1";
    const secret = process.env.XP_DAILY_SECRET;
    const { handler } = await loadCalculateXp();

    const fingerprint = hash("CalcUA").substring(0, 16);
    const token = buildSessionToken({ sessionId: "sess-999", userId: "user-999", fingerprint, secret });
    store.setex(`${process.env.XP_KEY_NS}:server-session:sess-999`, 600, JSON.stringify({
      userId: "user-999",
      createdAt: Date.now(),
      fingerprint,
      ipHash: hash("10.0.0.1").substring(0, 16),
      lastActivity: Date.now(),
    }));

    const now = Date.now();
    store.eval.mockResolvedValue([12, 12, 12, 12, now, 0]);
    const success = await handler({
      httpMethod: "POST",
      headers: { "user-agent": "CalcUA" },
      body: JSON.stringify({
        userId: "user-999",
        sessionId: "sess-999",
        sessionToken: token,
        windowStart: now - 10000,
        windowEnd: now,
        inputEvents: 10,
        visibilitySeconds: 10,
        scoreDelta: 50,
      }),
    });

    expect(success.statusCode).toBe(200);
    expect(parseJsonBody(success).ok).toBe(true);

    const mismatch = await handler({
      httpMethod: "POST",
      headers: { "user-agent": "CalcUA" },
      body: JSON.stringify({
        userId: "other-user",
        sessionId: "sess-999",
        sessionToken: token,
        windowStart: now - 10000,
        windowEnd: now,
        inputEvents: 10,
        visibilitySeconds: 10,
        scoreDelta: 50,
      }),
    });

    const mismatchBody = parseJsonBody(mismatch);
    expect(mismatch.statusCode).toBe(401);
    expect(mismatchBody.error).toBe("invalid_session");
  });
});
