import test from "node:test";
import assert from "node:assert/strict";
import { createClosedTableCleanup } from "./closed-table-cleanup.mjs";

const HOUR = 3_600_000;
const DAY = 86_400_000;

test("short retention preserves Single Player start intents through the retry/skew window only", async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create table poker_tables (id uuid primary key, status text, updated_at timestamptz, has_human_participant boolean, bot_only_retention_complete_at timestamptz);
      create table poker_state (table_id uuid references poker_tables on delete cascade, state jsonb);
      create table chips_accounts (system_key text, account_type text, status text, balance bigint);
      create table poker_actions (table_id uuid);
      create table poker_hole_cards (table_id uuid);
      create table poker_requests (table_id uuid references poker_tables on delete cascade, kind text, result_json jsonb, created_at timestamptz);
    `);
    const ids = [1,2,3].map(n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0'));
    for (let i = 0; i < ids.length; i += 1) {
      await db.query("insert into poker_tables values ($1,'CLOSED',now()-interval '3 days',true,null)", [ids[i]]);
      await db.query("insert into poker_state values ($1,'{\"phase\":\"HAND_DONE\",\"handId\":\"\"}')", [ids[i]]);
      await db.query("insert into chips_accounts values ($1,'ESCROW','active',0)", ['POKER_TABLE:' + ids[i]]);
      await db.query("insert into poker_requests values ($1,'QUICK_SEAT',$2::jsonb,now()-$3::interval)", [ids[i], JSON.stringify({ isSinglePlayer: i < 2 }), i === 0 ? '24 hours 4 minutes' : i === 1 ? '24 hours 6 minutes' : '2 hours']);
    }
    const cleanup = createClosedTableCleanup({
      env: envWithRetention(HOUR),
      beginSql: async (fn) => db.transaction(tx => fn({ unsafe: async (sql, params = []) => (await tx.query(sql, params)).rows }))
    });
    assert.equal((await cleanup.readBacklog()).eligibleTables, 2, 'backlog uses the same protected retry window');
    let discovered = [];
    const result = await cleanup.sweep({
      claimTableIds: candidates => {
        discovered = candidates;
        // Revalidation must protect a recent intent even if an earlier claim includes it.
        return { claimed: ids, skipped: [] };
      },
      releaseTableIds: () => {}
    });
    assert.equal(result.ok, true);
    assert.deepEqual(discovered.sort(), ids.slice(1), 'discovery excludes the recent Single Player intent');
    assert.equal(result.deleted, 2, 'expired SP and ordinary Online table can be purged');
    assert.deepEqual((await db.query('select id from poker_tables')).rows, [{ id: ids[0] }], 'future skew cannot outlive the retained intent');
    assert.equal((await db.query('select count(*)::int as count from poker_requests')).rows[0].count, 1);
  } finally { await db.close(); }
});

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

for (const [environment, projectRef] of [
  ["canonical Stage", "krydukthwdvccggbyjfw"],
  ["canonical Production", "otbqfijerkieoxwpxjnm"]
]) {
  test(`${environment} requires completion markers`, async () => {
    let backlogSql = "";
    const cleanup = createClosedTableCleanup({
      env: { ...envWithRetention(), SUPABASE_URL: `https://${projectRef}.supabase.co` },
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("count(*)::bigint")) backlogSql = sql;
          return [{ eligible: "0" }];
        }
      })
    });
    await cleanup.status();
    assert.match(backlogSql, /t\.has_human_participant is true and t\.human_retention_complete_at is not null/);
    assert.match(backlogSql, /t\.has_human_participant is not true and t\.bot_only_retention_complete_at is not null/);
  });
}

test("noncanonical target keeps the existing human cleanup predicate", async () => {
  let backlogSql = "";
  const cleanup = createClosedTableCleanup({
    env: { ...envWithRetention(), SUPABASE_URL: "https://legacy-project.supabase.co" },
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
