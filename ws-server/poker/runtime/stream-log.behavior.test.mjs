import test from "node:test";
import assert from "node:assert/strict";
import { createStreamLog } from "./stream-log.mjs";

test("append assigns monotonic seq and prunes oldest beyond cap", () => {
  const streamLog = createStreamLog({ cap: 2 });
  const a = streamLog.append({ tableId: "t1", frame: { type: "stateSnapshot" }, receiverKey: "u1" });
  const b = streamLog.append({ tableId: "t1", frame: { type: "statePatch" }, receiverKey: "u1" });
  const c = streamLog.append({ tableId: "t1", frame: { type: "statePatch" }, receiverKey: "u1" });

  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(c.seq, 3);

  const replay = streamLog.eventsAfter({ tableId: "t1", lastSeq: 0, receiverKey: "u1" });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "last_seq_out_of_window");
});

test("eventsAfter returns contiguous replay slice or replay-unavailable signal", () => {
  const streamLog = createStreamLog({ cap: 3 });
  streamLog.append({ tableId: "t2", frame: { type: "stateSnapshot" }, receiverKey: "u1" });
  streamLog.append({ tableId: "t2", frame: { type: "statePatch", payload: { n: 1 } }, receiverKey: "u1" });
  streamLog.append({ tableId: "t2", frame: { type: "statePatch", payload: { n: 2 } }, receiverKey: "u1" });

  const inWindow = streamLog.eventsAfter({ tableId: "t2", lastSeq: 1, receiverKey: "u1" });
  assert.equal(inWindow.ok, true);
  assert.deepEqual(inWindow.frames.map((frame) => frame.seq), [2, 3]);

  streamLog.append({ tableId: "t2", frame: { type: "statePatch", payload: { n: 3 } }, receiverKey: "u1" });
  const evicted = streamLog.eventsAfter({ tableId: "t2", lastSeq: 0, receiverKey: "u1" });
  assert.equal(evicted.ok, false);
  assert.equal(evicted.reason, "last_seq_out_of_window");
});


test("eventsAfter isolates replay per receiver key for same table", () => {
  const streamLog = createStreamLog({ cap: 6 });
  streamLog.append({ tableId: "t3", frame: { type: "stateSnapshot", payload: { owner: "a" } }, receiverKey: "sess_a" });
  streamLog.append({ tableId: "t3", frame: { type: "stateSnapshot", payload: { owner: "b" } }, receiverKey: "sess_b" });
  streamLog.append({ tableId: "t3", frame: { type: "statePatch", payload: { owner: "a2" } }, receiverKey: "sess_a" });

  const replayA = streamLog.eventsAfter({ tableId: "t3", lastSeq: 0, receiverKey: "sess_a" });
  const replayB = streamLog.eventsAfter({ tableId: "t3", lastSeq: 1, receiverKey: "sess_b" });

  assert.equal(replayA.ok, true);
  assert.equal(replayB.ok, true);
  assert.deepEqual(replayA.frames.map((frame) => frame.payload.owner), ["a", "a2"]);
  assert.deepEqual(replayB.frames.map((frame) => frame.payload.owner), ["b"]);
});


test("receiver-scoped window is unaffected by unrelated receiver traffic", () => {
  const streamLog = createStreamLog({ cap: 2 });
  const a1 = streamLog.append({ tableId: "t4", frame: { type: "stateSnapshot", payload: { owner: "a1" } }, receiverKey: "sess_a" });
  streamLog.append({ tableId: "t4", frame: { type: "stateSnapshot", payload: { owner: "b1" } }, receiverKey: "sess_b" });
  streamLog.append({ tableId: "t4", frame: { type: "statePatch", payload: { owner: "b2" } }, receiverKey: "sess_b" });
  streamLog.append({ tableId: "t4", frame: { type: "statePatch", payload: { owner: "b3" } }, receiverKey: "sess_b" });

  const replayA = streamLog.eventsAfter({ tableId: "t4", lastSeq: a1.seq - 1, receiverKey: "sess_a" });
  assert.equal(replayA.ok, true);
  assert.deepEqual(replayA.frames.map((frame) => frame.payload.owner), ["a1"]);

  const replayB = streamLog.eventsAfter({ tableId: "t4", lastSeq: 0, receiverKey: "sess_b" });
  assert.equal(replayB.ok, false);
  assert.equal(replayB.reason, "last_seq_out_of_window");
});
