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
