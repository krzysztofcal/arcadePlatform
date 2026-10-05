import test from "node:test";
import assert from "node:assert/strict";
import { createSessionStore } from "./session-store.mjs";
import { createSession } from "./session.mjs";

test("lookup by sessionId works and rebind moves active ownership", () => {
  const store = createSessionStore();
  const session = createSession({ sessionId: "sess_1", nowTs: () => "2026-02-28T00:00:00Z" });
  session.userId = "user_1";
  store.registerSession({ session });

  const socketA = { id: "a" };
  const socketB = { id: "b" };

  store.trackConnection({ ws: socketA, userId: "user_1", sessionId: "sess_1" });
  assert.equal(store.connectionsForUser("user_1").length, 1);
  assert.equal(store.socketOwnsSession({ ws: socketA, sessionId: "sess_1" }), true);

  const rebound = store.rebindSession({ sessionId: "sess_1", userId: "user_1", ws: socketB });
  assert.equal(rebound.ok, true);
  assert.equal(rebound.priorSocket, socketA);
  assert.equal(store.connectionsForUser("user_1").length, 1);
  assert.equal(store.connectionsForUser("user_1")[0], socketB);
  assert.equal(store.sessionForId("sess_1"), session);
  assert.equal(store.socketOwnsSession({ ws: socketA, sessionId: "sess_1" }), false);
  assert.equal(store.socketOwnsSession({ ws: socketB, sessionId: "sess_1" }), true);
});

test("unknown sessionId and cross-user attempts fail safely", () => {
  const store = createSessionStore();
  const session = createSession({ sessionId: "sess_1", nowTs: () => "2026-02-28T00:00:00Z" });
  session.userId = "user_1";
  store.registerSession({ session });

  const socketA = { id: "a" };
  const missing = store.rebindSession({ sessionId: "sess_missing", userId: "user_1", ws: socketA });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "unknown_session");
  assert.equal(store.connectionsForUser("user_1").length, 0);

  store.trackConnection({ ws: socketA, userId: "user_1", sessionId: "sess_1" });
  const socketB = { id: "b" };
  const mismatch = store.rebindSession({ sessionId: "sess_1", userId: "user_2", ws: socketB });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "session_user_mismatch");
  assert.equal(store.connectionsForUser("user_1").length, 1);
  assert.equal(store.connectionsForUser("user_1")[0], socketA);
  assert.equal(store.connectionsForUser("user_2").length, 0);
});


test("expired session is removed from registry and is no longer rebindable", () => {
  const store = createSessionStore({ sessionTtlMs: 1000 });
  const session = createSession({ sessionId: "sess_expired", nowTs: () => "2026-02-28T00:00:00.000Z" });
  session.userId = "user_1";
  store.registerSession({ session });

  const removed = store.sweepExpiredSessions({ nowMs: Date.parse("2026-02-28T00:00:02.000Z") });
  assert.deepEqual(removed, ["sess_expired"]);
  assert.equal(store.sessionForId("sess_expired"), null);

  const rebound = store.rebindSession({ sessionId: "sess_expired", userId: "user_1", ws: { id: "z" } });
  assert.equal(rebound.ok, false);
  assert.equal(rebound.reason, "unknown_session");
});

test("cleanup keeps fresh session rebindable", () => {
  const store = createSessionStore({ sessionTtlMs: 2000 });
  const session = createSession({ sessionId: "sess_fresh", nowTs: () => "2026-02-28T00:00:00.000Z" });
  session.userId = "user_1";
  store.registerSession({ session });

  const removed = store.sweepExpiredSessions({ nowMs: Date.parse("2026-02-28T00:00:01.000Z") });
  assert.deepEqual(removed, []);
  assert.equal(store.sessionForId("sess_fresh"), session);

  const rebound = store.rebindSession({
    sessionId: "sess_fresh",
    userId: "user_1",
    ws: { id: "y" },
    nowMs: Date.parse("2026-02-28T00:00:01.000Z")
  });
  assert.equal(rebound.ok, true);
  assert.equal(rebound.session, session);
});

test("rebindSession lazily expires inactive session whose lastSeenAt exceeded ttl without global sweep", () => {
  const store = createSessionStore({ sessionTtlMs: 1000 });
  const session = createSession({ sessionId: "sess_lazy_expired", nowTs: () => "2026-02-28T00:00:00.000Z" });
  session.userId = "user_1";
  store.registerSession({ session });

  const rebound = store.rebindSession({
    sessionId: "sess_lazy_expired",
    userId: "user_1",
    ws: { id: "z" },
    nowMs: Date.parse("2026-02-28T00:00:02.000Z")
  });

  assert.equal(rebound.ok, false);
  assert.equal(rebound.reason, "unknown_session");
  assert.equal(store.sessionForId("sess_lazy_expired"), null, "expired session must be deleted from registry");
});

test("rebindSession does not expire active session even if age exceeded ttl", () => {
  const store = createSessionStore({ sessionTtlMs: 1000 });
  const session = createSession({ sessionId: "sess_active_old", nowTs: () => "2026-02-28T00:00:00.000Z" });
  session.userId = "user_1";
  store.registerSession({ session });

  const socketA = { id: "a" };
  const socketB = { id: "b" };
  store.trackConnection({ ws: socketA, userId: "user_1", sessionId: "sess_active_old" });

  const rebound = store.rebindSession({
    sessionId: "sess_active_old",
    userId: "user_1",
    ws: socketB,
    nowMs: Date.parse("2026-02-28T00:00:05.000Z")
  });

  assert.equal(rebound.ok, true);
  assert.equal(rebound.session, session);
  assert.equal(rebound.priorSocket, socketA);
  assert.equal(store.sessionForId("sess_active_old"), session);
});

