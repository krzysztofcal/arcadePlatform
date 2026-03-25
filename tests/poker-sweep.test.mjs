import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const sweepSrc = read("netlify/functions/poker-sweep.mjs");

assert.ok(
  sweepSrc.includes("STALE_PENDING_CUTOFF_MINUTES") &&
    sweepSrc.includes("STALE_PENDING_LIMIT") &&
    sweepSrc.includes("OLD_REQUESTS_LIMIT"),
  "sweep should define request cleanup limits"
);
assert.ok(
  sweepSrc.includes("delete from public.poker_requests") &&
    sweepSrc.includes("result_json is null") &&
    sweepSrc.includes("created_at < now() - ($1::int * interval '1 minute')"),
  "sweep should clean stale pending requests"
);
assert.ok(
  sweepSrc.includes("delete from public.poker_requests") &&
    sweepSrc.includes("created_at < now() - interval '24 hours'"),
  "sweep should clean old requests"
);
assert.ok(sweepSrc.includes("poker_requests_cleanup"), "sweep should log poker request cleanup");

assert.ok(
  sweepSrc.includes("delete from public.poker_hole_cards"),
  "sweep should delete hole cards for closed tables"
);
assert.ok(
  sweepSrc.includes("poker:close_cashout:${tableId}:${userId}:${seatNo}:v1"),
  "sweep should use close cashout idempotency key"
);
assert.ok(
  sweepSrc.includes("poker_close_cashout_ok") &&
    sweepSrc.includes("poker_close_cashout_skip") &&
    sweepSrc.includes("poker_close_cashout_fail"),
  "sweep should log close cash-out outcomes"
);

assert.ok(
  sweepSrc.includes(`idempotencyKeySuffix: "close_cashout:v1"`),
  "sweep bot close cashout idempotency should use stable suffix without schema version dependency"
);
assert.ok(
  sweepSrc.includes(`idempotencyKeySuffix: "timeout_cashout:v1"`),
  "sweep bot timeout cashout idempotency should use stable suffix without schema version dependency"
);
