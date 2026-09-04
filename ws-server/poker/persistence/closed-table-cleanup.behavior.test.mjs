import test from "node:test";
import assert from "node:assert/strict";
import { createClosedTableCleanup } from "./closed-table-cleanup.mjs";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function envWithRetention(retentionMs = String(7 * DAY), batchSize = "20") {
  return {
    WS_POKER_CLOSED_TABLE_RETENTION_MS: String(retentionMs),
    WS_POKER_CLOSED_TABLE_BATCH_SIZE: batchSize
  };
}

test("cleanup is disabled when retention is 0", async () => {
  let queries = 0;
  const cleanup = createClosedTableCleanup({
    env: { WS_POKER_CLOSED_TABLE_RETENTION_MS: "0", WS_POKER_CLOSED_TABLE_BATCH_SIZE: "20" },
    beginSql: async (fn) => {
      queries += 1;
      return fn({ unsafe: async () => [] });
    }
  });
  const result = await cleanup.sweep({ claimTableIds: () => ({ claimed: [], skipped: [] }) });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "cleanup_disabled");
  assert.equal(queries, 0);
});

test("cleanup defaults to 7-day retention when the env var is absent", async () => {
  const cleanup = createClosedTableCleanup({
    env: { WS_POKER_CLOSED_TABLE_BATCH_SIZE: "20" },
    beginSql: async (fn) => fn({
      unsafe: async () => []
    })
  });
  const status = await cleanup.status();
  assert.equal(status.retentionMs, 7 * 86_400_000);
  assert.equal(status.skipped, undefined);
});

test("rejects NaN retention", () => {
  assert.throws(() => createClosedTableCleanup({
    env: { WS_POKER_CLOSED_TABLE_RETENTION_MS: "not-a-number", WS_POKER_CLOSED_TABLE_BATCH_SIZE: "20" }
  }), /WS_POKER_CLOSED_TABLE_RETENTION_MS/);
});

test("rejects negative retention", () => {
  assert.throws(() => createClosedTableCleanup({
    env: { WS_POKER_CLOSED_TABLE_RETENTION_MS: "-1", WS_POKER_CLOSED_TABLE_BATCH_SIZE: "20" }
  }), /WS_POKER_CLOSED_TABLE_RETENTION_MS/);
});

test("rejects batch size 0", () => {
  assert.throws(() => createClosedTableCleanup({
    env: envWithRetention(undefined, "0")
  }), /WS_POKER_CLOSED_TABLE_BATCH_SIZE/);
});

test("rejects batch size above 100", () => {
  assert.throws(() => createClosedTableCleanup({
    env: envWithRetention(undefined, "101")
  }), /WS_POKER_CLOSED_TABLE_BATCH_SIZE/);
});

test("discover -> claim -> delete only claimed; skipped ids stay untouched", async () => {
  const discoveryResults = [
    ["table-a", "table-b", "table-c"]
  ];
  let released = [];
  const cleanup = createClosedTableCleanup({
    env: envWithRetention(),
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("delete from public.poker_tables")) {
          return [{ id: "table-a" }, { id: "table-c" }];
        }
        if (sql.includes("select t.id")) {
          const next = discoveryResults.shift() || [];
          return next.map((id) => ({ id }));
        }
        return [];
      }
    })
  });
  const result = await cleanup.sweep({
    claimTableIds: (candidateIds) => ({
      claimed: candidateIds.filter((id) => id !== "table-b"),
      skipped: candidateIds.filter((id) => id === "table-b")
    }),
    releaseTableIds: (claimedIds) => { released = claimedIds; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.claimed, 2);
  assert.equal(result.skippedIds, 1);
  assert.equal(result.deleted, 2);
  assert.deepEqual(released.sort(), ["table-a", "table-c"]);
});

test("release runs in finally even when the delete phase fails", async () => {
  let released = null;
  const cleanup = createClosedTableCleanup({
    env: envWithRetention(),
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("delete from public.poker_tables")) {
          const error = new Error("lock timeout");
          error.code = "55P03";
          throw error;
        }
        if (sql.includes("select t.id")) return [{ id: "table-a" }];
        return [];
      }
    })
  });
  const result = await cleanup.sweep({
    claimTableIds: (candidateIds) => ({ claimed: candidateIds, skipped: [] }),
    releaseTableIds: (claimedIds) => { released = claimedIds; }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(released, ["table-a"]);
});

test("skips sweep when a previous sweep is still in progress", async () => {
  let resolveDiscovery;
  const gate = new Promise((resolve) => { resolveDiscovery = resolve; });
  const cleanup = createClosedTableCleanup({
    env: envWithRetention(),
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("select t.id")) {
          await gate;
          return [{ id: "table-a" }];
        }
        return [];
      }
    })
  });
  const firstSweep = cleanup.sweep({
    claimTableIds: (candidateIds) => ({ claimed: candidateIds, skipped: [] }),
    releaseTableIds: () => {}
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await cleanup.sweep({
    claimTableIds: (candidateIds) => ({ claimed: candidateIds, skipped: [] }),
    releaseTableIds: () => {}
  });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "sweep_in_progress");
  resolveDiscovery();
  await firstSweep;
});

test("status exposes retention, batch and last run", async () => {
  const cleanup = createClosedTableCleanup({
    env: envWithRetention(String(7 * DAY), "50"),
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("count(*)::bigint")) return [{ eligible: "3" }];
        return [];
      }
    })
  });
  const status = await cleanup.status();
  assert.equal(status.retentionMs, 7 * DAY);
  assert.equal(status.batchSize, 50);
  assert.equal(status.backlog.available, true);
  assert.equal(status.backlog.eligibleTables, 3);
});

test("canonical Stage requires the human retention marker", async () => {
  let backlogSql = "";
  const cleanup = createClosedTableCleanup({
    env: { ...envWithRetention(), SUPABASE_URL: "https://krydukthwdvccggbyjfw.supabase.co" },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("count(*)::bigint")) backlogSql = sql;
        return [{ eligible: "0" }];
      }
    })
  });
  await cleanup.status();
  assert.match(backlogSql, /human_retention_complete_at is not null/);
});

test("non-Stage keeps the existing human cleanup predicate", async () => {
  let backlogSql = "";
  const cleanup = createClosedTableCleanup({
    env: { ...envWithRetention(), SUPABASE_URL: "https://otbqfijerkieoxwpxjnm.supabase.co" },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("count(*)::bigint")) backlogSql = sql;
        return [{ eligible: "0" }];
      }
    })
  });
  await cleanup.status();
  assert.doesNotMatch(backlogSql, /human_retention_complete_at/);
  assert.match(backlogSql, /t\.has_human_participant is true or t\.bot_only_retention_complete_at is not null/);
});
