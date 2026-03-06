import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function wsAvailability({ hasGlobalWebSocket = typeof globalThis.WebSocket === "function", resolveAttempts = null } = {}) {
  const attempts = resolveAttempts ?? [
    { name: "ws-server", resolve: () => require.resolve("ws", { paths: ["./ws-server"] }) },
    { name: "root", resolve: () => require.resolve("ws") }
  ];

  const resolved = [];
  const failures = [];

  for (const attempt of attempts) {
    const name = typeof attempt === "function" ? "custom" : attempt.name;
    const resolve = typeof attempt === "function" ? attempt : attempt.resolve;

    try {
      resolved.push({ name, path: resolve() });
    } catch (error) {
      failures.push({ name, message: error?.message ?? String(error) });
    }
  }

  return { hasGlobalWebSocket, resolved, failures };
}

function assertWsAvailable(availability) {
  const ok = availability.hasGlobalWebSocket || availability.resolved.length > 0;
  assert.equal(
    ok,
    true,
    `Unable to resolve a WebSocket implementation. hasGlobalWebSocket=${availability.hasGlobalWebSocket}; failures=${JSON.stringify(availability.failures)}`
  );
}

test("ws dependency resolves from global WebSocket or root/ws-server dependency graph", () => {
  assertWsAvailable(wsAvailability());
});

test("guard passes when globalThis.WebSocket exists even if ws resolve fails", () => {
  const availability = wsAvailability({
    hasGlobalWebSocket: true,
    resolveAttempts: [
      { name: "root", resolve: () => { throw new Error("forced resolve failure"); } },
      { name: "ws-server", resolve: () => { throw new Error("forced resolve failure"); } }
    ]
  });

  assertWsAvailable(availability);
  assert.equal(availability.resolved.length, 0);
  assert.equal(availability.failures.length, 2);
  assert.match(availability.failures[0].message, /forced resolve failure/);
});

test("guard reports explicit diagnostics when neither globalThis.WebSocket nor ws is available", () => {
  const availability = wsAvailability({
    hasGlobalWebSocket: false,
    resolveAttempts: [
      { name: "root", resolve: () => { throw new Error("forced resolve failure"); } },
      { name: "ws-server", resolve: () => { throw new Error("forced resolve failure"); } }
    ]
  });

  assert.throws(
    () => assertWsAvailable(availability),
    /Unable to resolve a WebSocket implementation\. hasGlobalWebSocket=false;.*forced resolve failure/
  );
});
