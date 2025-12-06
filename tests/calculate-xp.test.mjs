/**
 * Server-Side XP Calculation Tests
 *
 * Tests the calculate-xp endpoint which performs XP calculation
 * on the server instead of trusting client-sent values.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Set up environment for in-memory store before imports
process.env.XP_REQUIRE_ACTIVITY = "0"; // Disable by default for most tests

// Mock store before importing handler
vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => {
  const mockData = new Map();

  return {
    store: {
      get: vi.fn((key) => Promise.resolve(mockData.get(key) || null)),
      setex: vi.fn((key, ttl, value) => {
        mockData.set(key, value);
        return Promise.resolve("OK");
      }),
      set: vi.fn((key, value) => {
        mockData.set(key, value);
        return Promise.resolve("OK");
      }),
      incrBy: vi.fn((key, amount) => {
        const current = Number(mockData.get(key) || 0);
        const newVal = current + amount;
        mockData.set(key, String(newVal));
        return Promise.resolve(newVal);
      }),
      expire: vi.fn(() => Promise.resolve(1)),
      eval: vi.fn((script, keys, args) => {
        // Simulate the Lua script response: [granted, daily, session, lifetime, lastSync, status]
        return Promise.resolve([10, 10, 10, 10, Date.now(), 0]);
      }),
      _mockData: mockData,
      _reset: () => mockData.clear(),
    },
  };
});

async function loadHandlerWithEnv(requireActivityValue) {
  const originalEnv = process.env.XP_REQUIRE_ACTIVITY;
  process.env.XP_REQUIRE_ACTIVITY = requireActivityValue;
  vi.resetModules();
  const module = await import("../netlify/functions/calculate-xp.mjs");
  const { store: freshStore } = await import("../netlify/functions/_shared/store-upstash.mjs");
  return {
    handler: module.handler,
    GAME_XP_RULES: module.GAME_XP_RULES,
    store: freshStore,
    restore: () => {
      process.env.XP_REQUIRE_ACTIVITY = originalEnv;
      vi.resetModules();
    }
  };
}

// Now import the handler
const module = await import("../netlify/functions/calculate-xp.mjs");
const { handler, GAME_XP_RULES } = module;

// Get reference to mocked store
const { store } = await import("../netlify/functions/_shared/store-upstash.mjs");

describe("calculate-xp endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store._reset?.();
    // Reset eval mock for each test
    store.eval.mockResolvedValue([10, 10, 10, 10, Date.now(), 0]);
    store.incrBy.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request validation", () => {
    it("should reject non-POST requests", async () => {
      const event = {
        httpMethod: "GET",
        headers: {},
        body: null,
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(405);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("method_not_allowed");
    });

    it("should reject requests without userId", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-123" }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("missing_fields");
    });

    it("should reject requests without sessionId", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user-123" }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("missing_fields");
    });

    it("should reject bad JSON", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: "not valid json",
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("bad_json");
    });
  });

  describe("CORS validation", () => {
    it("should allow same-origin requests (no origin header)", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 10,
          visibilitySeconds: 10,
        }),
      };

      const response = await handler(event);
      // Should not be 403
      expect(response.statusCode).not.toBe(403);
    });

    it("should allow Netlify domains", async () => {
      const event = {
        httpMethod: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://deploy-preview-123--mysite.netlify.app",
        },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 10,
          visibilitySeconds: 10,
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).not.toBe(403);
    });
  });

  describe("XP calculation", () => {
    it("should calculate XP based on activity", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "tetris",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 20, // Active player
          visibilitySeconds: 10,
          scoreDelta: 1000,
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.calculated).toBeGreaterThan(0);
      expect(body.awarded).toBeGreaterThanOrEqual(0);
    });

    it("should return inactive when no input events and activity required", async () => {
      const { handler: freshHandler, restore } = await loadHandlerWithEnv("1");

      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "tetris",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 0, // No activity
          visibilitySeconds: 0,
          scoreDelta: 500,
        }),
      };

      const response = await freshHandler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.awarded).toBe(0);
      expect(body.reason).toBe("inactive");

      restore();
    });

    it("should award XP when activity gating is disabled", async () => {
      const { handler: freshHandler, restore, store: freshStore } = await loadHandlerWithEnv("0");

      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "tetris",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 0,
          visibilitySeconds: 0,
          scoreDelta: 500,
        }),
      };

      freshStore.eval.mockResolvedValue([15, 15, 15, 15, Date.now(), 0]);

      const response = await freshHandler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.awarded).toBeGreaterThan(0);

      restore();
    });

    it("should cap XP per request", async () => {
      // Mock eval to return capped values
      store.eval.mockResolvedValue([50, 50, 50, 50, Date.now(), 4]); // status 4 = session cap partial

      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "tetris",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 100,
          visibilitySeconds: 10,
          scoreDelta: 50000, // High score should hit caps
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.awarded).toBeLessThanOrEqual(300); // DELTA_CAP
    });

    it("should handle game events", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "tetris",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 20,
          visibilitySeconds: 10,
          scoreDelta: 500,
          gameEvents: [
            { type: "line_clear", value: 4 }, // Tetris!
            { type: "level_up", value: 2 },
          ],
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.calculated).toBeGreaterThan(0);
    });

    it("should track combo state in response", async () => {
      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "2048",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 30, // High activity
          visibilitySeconds: 10,
          scoreDelta: 200,
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.combo).toBeDefined();
      expect(body.combo.multiplier).toBeGreaterThanOrEqual(1);
      expect(body.combo.mode).toBeDefined();
    });
  });

  describe("session state", () => {
    it("should load existing session state", async () => {
      // Mock existing session state
      store.get.mockImplementation((key) => {
        if (key.includes("session:state")) {
          return Promise.resolve(
            JSON.stringify({
              combo: { mode: "build", multiplier: 5, points: 2, lastUpdateMs: Date.now() - 5000 },
              momentum: 0.5,
              boostMultiplier: 1,
              boostExpiresAt: 0,
              lastWindowEnd: Date.now() - 5000,
            })
          );
        }
        return Promise.resolve(null);
      });

      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "pacman",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 15,
          visibilitySeconds: 10,
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      // Combo should have advanced from the loaded state
      expect(body.combo.multiplier).toBeGreaterThanOrEqual(1);
    });

    it("should reject stale requests", async () => {
      // Mock session state with recent lastWindowEnd
      const recentTime = Date.now();
      store.get.mockImplementation((key) => {
        if (key.includes("session:state")) {
          return Promise.resolve(
            JSON.stringify({
              combo: { mode: "build", multiplier: 1, points: 0, lastUpdateMs: recentTime },
              lastWindowEnd: recentTime,
            })
          );
        }
        return Promise.resolve(null);
      });

      const event = {
        httpMethod: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          gameId: "tetris",
          windowStart: recentTime - 20000,
          windowEnd: recentTime - 10000, // Older than lastWindowEnd
          inputEvents: 15,
          visibilitySeconds: 10,
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.reason).toBe("stale");
      expect(body.awarded).toBe(0);
    });
  });

  describe("rate limiting", () => {
    it("should rate limit excessive requests", async () => {
      // Simulate rate limit exceeded
      store.incrBy.mockResolvedValue(35); // Over the 30 req/min limit

      const event = {
        httpMethod: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "1.2.3.4",
        },
        body: JSON.stringify({
          userId: "user-123",
          sessionId: "sess-123",
          windowStart: Date.now() - 10000,
          windowEnd: Date.now(),
          inputEvents: 10,
          visibilitySeconds: 10,
        }),
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(429);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("rate_limit_exceeded");
    });
  });
});

describe("GAME_XP_RULES", () => {
  it("should have default rules", () => {
    expect(GAME_XP_RULES.default).toBeDefined();
    expect(GAME_XP_RULES.default.baseXpPerSecond).toBe(10);
  });

  it("should have tetris-specific rules", () => {
    expect(GAME_XP_RULES.tetris).toBeDefined();
    expect(GAME_XP_RULES.tetris.events).toBeDefined();
    expect(GAME_XP_RULES.tetris.events.line_clear).toBeDefined();
    expect(GAME_XP_RULES.tetris.events.tetris).toBeDefined();
  });

  it("should have 2048-specific rules", () => {
    expect(GAME_XP_RULES["2048"]).toBeDefined();
    expect(GAME_XP_RULES["2048"].events).toBeDefined();
    expect(GAME_XP_RULES["2048"].events.tile_merge).toBeDefined();
  });

  it("should have pacman-specific rules", () => {
    expect(GAME_XP_RULES.pacman).toBeDefined();
    expect(GAME_XP_RULES.pacman.events).toBeDefined();
    expect(GAME_XP_RULES.pacman.events.ghost_eaten).toBeDefined();
  });

  it("should calculate correct XP for tetris events", () => {
    const rules = GAME_XP_RULES.tetris;
    expect(rules.events.line_clear(1)).toBe(5); // 1 line = 5 XP
    expect(rules.events.line_clear(4)).toBe(20); // 4 lines = 20 XP
    expect(rules.events.tetris()).toBe(40); // Tetris = 40 XP
    expect(rules.events.level_up(5)).toBe(50); // Level 5 = 50 XP
  });

  it("should calculate correct XP for 2048 events", () => {
    const rules = GAME_XP_RULES["2048"];
    expect(rules.events.tile_merge(4)).toBe(2); // log2(4) = 2
    expect(rules.events.tile_merge(2048)).toBe(11); // log2(2048) = 11
    expect(rules.events.milestone(5000)).toBe(25); // 5 * 5 = 25
  });

  it("should calculate correct XP for pacman events", () => {
    const rules = GAME_XP_RULES.pacman;
    expect(rules.events.ghost_eaten()).toBe(10);
    expect(rules.events.power_pellet()).toBe(5);
    expect(rules.events.level_complete(3)).toBe(45); // 3 * 15 = 45
  });

  it("should have cats game rules", () => {
    expect(GAME_XP_RULES.cats).toBeDefined();
    expect(GAME_XP_RULES.cats.scoreToXpRatio).toBe(1.0); // 1 cat = 1 XP
    expect(GAME_XP_RULES.cats.events).toBeDefined();
    expect(GAME_XP_RULES.cats.events.cat_caught).toBeDefined();
  });

  it("should have cats game aliases", () => {
    // Multiple slug variations should work
    expect(GAME_XP_RULES["catch-cats"]).toBeDefined();
    expect(GAME_XP_RULES["game_cats"]).toBeDefined();
  });

  it("should calculate correct XP for cats events", () => {
    const rules = GAME_XP_RULES.cats;
    expect(rules.events.cat_caught()).toBe(1); // 1 XP per cat
    expect(rules.events.streak(3)).toBe(0);    // No bonus for < 5 streak
    expect(rules.events.streak(5)).toBe(5);    // 5 XP bonus for 5+ streak
    expect(rules.events.level_up(3)).toBe(6);  // 3 * 2 = 6 XP
  });
});
