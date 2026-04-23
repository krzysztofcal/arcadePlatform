import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("stale active human sweep treats null last_seen_at as stale just like quick-seat", async () => {
  const source = await fs.readFile(new URL("./server.mjs", import.meta.url), "utf8");

  assert.match(
    source,
    /coalesce\(s\.last_seen_at,\s*to_timestamp\(0\)\)\s*<\s*\$1::timestamptz/,
    "stale active human sweep should treat null last_seen_at as stale"
  );
  assert.match(
    source,
    /order by s\.last_seen_at asc nulls first,\s*t\.updated_at asc/,
    "stale active human sweep should prioritize oldest and null last_seen_at candidates first"
  );
});
