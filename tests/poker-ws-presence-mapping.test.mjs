import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("poker presence merge updates occupancy and preserves richer baseline seat fields", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const marker = "function mergePresenceIntoSeats(existingSeats, seatUpdates)";
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "mergePresenceIntoSeats function should exist");
  const end = source.indexOf("\n\n    function applyWsSeatUpdate", start);
  assert.ok(end > start, "mergePresenceIntoSeats boundary should exist");
  const fnSource = source.slice(start, end).trim();
  const factory = new Function(`${fnSource}; return mergePresenceIntoSeats;`);
  const mergePresenceIntoSeats = factory();

  const baselineSeats = [
    { seatNo: 0, userId: "u0", status: "ACTIVE", stack: 150, tag: "preserve" },
    { seatNo: 1, userId: null, status: "EMPTY", stack: 200, tag: "preserve" }
  ];

  const merged = mergePresenceIntoSeats(baselineSeats, [
    { seatNo: 1, userId: "u1", status: "ACTIVE" }
  ]);

  assert.equal(Array.isArray(merged), true);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].userId, "u0");
  assert.equal(merged[0].stack, 150);
  assert.equal(merged[0].tag, "preserve");
  assert.equal(merged[1].userId, "u1");
  assert.equal(merged[1].status, "ACTIVE");
  assert.equal(merged[1].stack, 200);
  assert.equal(merged[1].tag, "preserve");
});
