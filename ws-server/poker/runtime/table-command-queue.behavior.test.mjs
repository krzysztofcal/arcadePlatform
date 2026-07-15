import test from "node:test";
import assert from "node:assert/strict";
import { createTableCommandQueue } from "./table-command-queue.mjs";

test("table command queue serializes commands for the same table", async () => {
  const queue = createTableCommandQueue();
  const order = [];
  let releaseFirst = null;
  const firstDone = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue({
    tableId: "t1",
    run: async () => {
      order.push("first:start");
      await firstDone;
      order.push("first:end");
      return "first";
    }
  });

  const second = queue.enqueue({
    tableId: "t1",
    run: async () => {
      order.push("second:start");
      order.push("second:end");
      return "second";
    }
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();

  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
});

test("table command queue allows different tables to progress independently", async () => {
  const queue = createTableCommandQueue();
  let releaseFirst = null;
  const firstDone = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const order = [];

  const first = queue.enqueue({
    tableId: "t1",
    run: async () => {
      order.push("t1:start");
      await firstDone;
      order.push("t1:end");
    }
  });

  const second = queue.enqueue({
    tableId: "t2",
    run: async () => {
      order.push("t2:start");
      order.push("t2:end");
    }
  });

  await second;
  assert.deepEqual(order, ["t1:start", "t2:start", "t2:end"]);
  releaseFirst();
  await first;
});

test("table command queue coalesces deduped commands while one is queued or running", async () => {
  const queue = createTableCommandQueue();
  let runCount = 0;
  let release = null;
  const waitForRelease = new Promise((resolve) => {
    release = resolve;
  });

  const first = queue.enqueue({
    tableId: "t1",
    dedupeKey: "turn_timeout",
    run: async () => {
      runCount += 1;
      await waitForRelease;
      return { ok: true };
    }
  });

  const second = queue.enqueue({
    tableId: "t1",
    dedupeKey: "turn_timeout",
    run: async () => {
      runCount += 1;
      return { ok: true, duplicate: true };
    }
  });

  assert.equal(first, second);
  release();
  await first;
  assert.equal(runCount, 1);
});

test("table command queue runs non-deduped bot-step cascade commands even while a prior step is active", async () => {
  const queue = createTableCommandQueue();
  const order = [];
  let releaseFirst = null;
  const waitForRelease = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue({
    tableId: "bot-cascade-table",
    run: async () => {
      order.push("bot_step:first:start");
      await waitForRelease;
      order.push("bot_step:first:end");
      return { ok: true, shouldContinue: true };
    }
  });

  const second = queue.enqueue({
    tableId: "bot-cascade-table",
    run: async () => {
      order.push("bot_step:second:start");
      order.push("bot_step:second:end");
      return { ok: true, shouldContinue: false };
    }
  });

  await Promise.resolve();
  assert.deepEqual(order, ["bot_step:first:start"]);
  releaseFirst();

  assert.deepEqual(await Promise.all([first, second]), [
    { ok: true, shouldContinue: true },
    { ok: true, shouldContinue: false }
  ]);
  assert.deepEqual(order, [
    "bot_step:first:start",
    "bot_step:first:end",
    "bot_step:second:start",
    "bot_step:second:end"
  ]);
});

test("table command queue retains serialization while an older queued command becomes active", async () => {
  const queue = createTableCommandQueue();
  const order = [];
  let releaseFirst;
  let releaseSecond;
  let markSecondStarted;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  const secondStarted = new Promise((resolve) => { markSecondStarted = resolve; });

  const first = queue.enqueue({
    tableId: "cleanup-race-table",
    run: async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    }
  });
  const second = queue.enqueue({
    tableId: "cleanup-race-table",
    run: async () => {
      order.push("second:start");
      markSecondStarted();
      await secondGate;
      order.push("second:end");
    }
  });

  releaseFirst();
  await secondStarted;
  const third = queue.enqueue({
    tableId: "cleanup-race-table",
    run: async () => {
      order.push("third:start");
      order.push("third:end");
    }
  });
  await Promise.resolve();
  assert.deepEqual(order, ["first:start", "first:end", "second:start"]);

  releaseSecond();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end", "third:start", "third:end"]);
});
