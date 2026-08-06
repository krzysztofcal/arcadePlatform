import test from "node:test";
import assert from "node:assert/strict";
import { createActionHistoryCleanup } from "./action-history-cleanup.mjs";

function mockTx(handlers) {
  return {
    unsafe: async (sql, params) => {
      for (const [pattern, handler] of handlers) {
        if (sql.includes(pattern)) {
          return handler(sql, params);
        }
      }
      return [];
    }
  };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

test("orphan phase is bounded, state-locked, type-safe, and reports separate deletes", async () => {
  const queries = [];
  const timeoutValues = [];
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: String(DAY),
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "7"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        queries.push(sql);
        if (sql.includes("set_config")) {
          timeoutValues.push(params?.[0]);
          return [];
        }
        if (sql.includes("orphan_candidates") && sql.includes("delete from public.poker_hole_cards")) {
          assert.equal(params[2], 7);
          assert.equal(params[3], 14);
          return [{ user_id: "u1" }, { user_id: "u2" }];
        }
        return [];
      }
    })
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, true);
  assert.equal(result.orphanHoleCardsDeleted, 2);
  assert.equal(result.holeCardsDeleted, 0);
  const orphanSql = queries.find((sql) => sql.includes("orphan_candidates") && sql.includes("delete from public.poker_hole_cards"));
  assert.match(orphanSql, /for update of ps skip locked/i);
  assert.doesNotMatch(orphanSql, /for update of t/i);
  assert.match(orphanSql, /jsonb_typeof\(ps\.state -> 'handId'\) = 'string'/i);
  assert.match(orphanSql, /max\(hc\.created_at\)/i);
  assert.match(orphanSql, /not exists[\s\S]+public\.poker_actions/i);
  assert.deepEqual(timeoutValues.slice(0, 2), ["250ms", "2000ms"]);
});

test("orphan phase failure is isolated from the existing cleanup phases", async () => {
  let ordinaryCalls = 0;
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("set_config('lock_timeout'")) throw new Error("lock timeout");
        if (sql.includes("candidate_hands")) {
          ordinaryCalls += 1;
          return [{ id: 1 }];
        }
        return [];
      }
    })
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "orphan_hole_cards_cleanup_failed");
  assert.deepEqual(result.failedPhases, ["orphan_hole_cards"]);
  assert.equal(result.orphanHoleCardsDeleted, 0);
  assert.equal(result.phase1Deleted, 1);
  assert.equal(ordinaryCalls, 1);
});

// ---------------------------------------------------------------------------
// Phase 1
// ---------------------------------------------------------------------------

test("phase 1 deletes ordinary actions for bot-only table past cutoff", async () => {
  let phase1DeletedCount = 0;
  const tx = mockTx([
    // Phase 1 uses "candidate_hands" CTE name + "action_type != 'HAND_SETTLED'" in DELETE
    ["candidate_hands", (sql) => {
      if (sql.includes("action_type != 'HAND_SETTLED'")) {
        phase1DeletedCount = 3;
        return [{ id: 1 }, { id: 2 }, { id: 3 }];
      }
      return [];
    }],
    ["id in (select id from candidates)", () => []],
  ]);

  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn(tx)
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, true);
  assert.equal(result.phase1Deleted, 3);
  assert.equal(result.phase2Deleted, 0);
});

test("phase 1 deletes nothing when all retentions are 0", async () => {
  const tx = mockTx([
    ["candidate_hands", () => []],
    ["id in (select id from candidates)", () => []],
  ]);

  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: "0",
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn(tx)
  });

  const result = await cleanup.sweep();
  assert.equal(result.skipped, true);
});

// ---------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------

test("phase 2 deletes HAND_SETTLED when ordinary actions already gone", async () => {
  let phase1Called = false;
  let phase2DeletedCount = 0;
  const tx = mockTx([
    // Phase 1 returns nothing
    ["candidate_hands", () => { phase1Called = true; return []; }],
    // Phase 2 uses "id in (select id from candidates)" pattern
    ["id in (select id from candidates)", () => {
      phase2DeletedCount = 2;
      return [{ id: 100 }, { id: 101 }];
    }],
  ]);

  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: String(7 * DAY),
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn(tx)
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, true);
  assert.equal(phase1Called, true);  // Phase 1 runs before Phase 2
  assert.equal(result.phase2Deleted, 2);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("bot action=0 + settled>0 throws", () => {
  assert.throws(() => {
    createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: "0",
        WS_POKER_BOT_SETTLED_RETENTION_MS: String(HOUR),
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
        SUPABASE_DB_URL: "postgres://test/db"
      },
      beginSql: async () => {}
    });
  }, /is unsafe|must be >=/);
});

test("0/0 is valid (cleanup disabled)", () => {
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: "0",
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async () => {}
  });
  assert.equal(typeof cleanup.sweep, "function");
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("idempotent: second sweep deletes nothing", async () => {
  const tx = mockTx([
    ["candidate_hands", () => []],
    ["id in (select id from candidates)", () => []],
  ]);

  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn(tx)
  });

  const result = await cleanup.sweep();
  assert.equal(result.phase1Deleted, 0);
  assert.equal(result.phase2Deleted, 0);
});

// ---------------------------------------------------------------------------
// Batch config
// ---------------------------------------------------------------------------

test("batch size and lockLimit passed to SQL", async () => {
  let capturedParams = null;
  const tx = mockTx([
    ["candidate_hands", (sql, params) => {
      capturedParams = params;
      return [];
    }],
    ["id in (select id from candidates)", () => []],
  ]);

  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "7",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn(tx)
  });

  await cleanup.sweep();
  assert.equal(capturedParams[2], 7);
  assert.equal(capturedParams[3], 14);
});

// ---------------------------------------------------------------------------
// Fail-fast validation of individual values
// ---------------------------------------------------------------------------

test("rejects NaN retention", () => {
  assert.throws(() => {
    createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: "8640000x",
        WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
        SUPABASE_DB_URL: "postgres://test/db"
      },
      beginSql: async () => {}
    });
  }, /must be a finite non-negative integer/);
});

test("rejects negative retention", () => {
  assert.throws(() => {
    createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: "-100",
        WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
        SUPABASE_DB_URL: "postgres://test/db"
      },
      beginSql: async () => {}
    });
  }, /must be a finite non-negative integer/);
});

test("rejects non-integer retention", () => {
  assert.throws(() => {
    createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: "12.5",
        WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
        SUPABASE_DB_URL: "postgres://test/db"
      },
      beginSql: async () => {}
    });
  }, /must be a finite non-negative integer/);
});

test("rejects batchSize 0", () => {
  assert.throws(() => {
    createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
        WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "0",
        SUPABASE_DB_URL: "postgres://test/db"
      },
      beginSql: async () => {}
    });
  }, /BATCH_SIZE.*must be an integer 1-100/);
});

test("rejects batchSize >100", () => {
  assert.throws(() => {
    createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
        WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "101",
        SUPABASE_DB_URL: "postgres://test/db"
      },
      beginSql: async () => {}
    });
  }, /BATCH_SIZE.*must be an integer 1-100/);
});

// ---------------------------------------------------------------------------
// Sweep-in-progress guard
// ---------------------------------------------------------------------------

test("skips sweep when previous sweep is still in progress", async () => {
  let calls = 0;
  let resolveTx;
  const txPromise = new Promise((resolve) => { resolveTx = resolve; });

  const tx = mockTx([
    ["candidate_hands", async () => {
      calls++;
      await txPromise; // hold the transaction open
      return [];
    }],
    ["id in (select id from candidates)", () => []],
  ]);

  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn(tx)
  });

  // Start first sweep (will hang on txPromise)
  const first = cleanup.sweep();

  // Attempt second sweep while first is in progress
  const second = await cleanup.sweep();

  assert.equal(second.skipped, true);
  assert.equal(second.reason, "sweep_in_progress");

  // Release first sweep
  resolveTx();
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
});

test("preview stress cleanup repeats bounded batches without changing the production default", async () => {
  let phase1Calls = 0;
  const cleanup = createActionHistoryCleanup({
    maxSweepRounds: 3,
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("candidate_hands")) {
          phase1Calls += 1;
          return phase1Calls < 3 ? [{ id: 1 }] : [];
        }
        return [];
      }
    })
  });

  const result = await cleanup.sweep();
  const status = await cleanup.status();
  assert.equal(result.phase1Deleted, 2);
  assert.equal(phase1Calls, 3);
  assert.equal(status.sweepRounds, 3);
});

test("status exposes effective cleanup configuration and phase-2-only HAND_SETTLED backlog", async () => {
  const queries = [];
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: String(2 * HOUR),
      WS_POKER_HUMAN_ACTION_RETENTION_MS: String(24 * HOUR),
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: String(7 * DAY),
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        queries.push(sql);
        if (sql.includes("ordinary_action_rows")) return [{ ordinary_action_rows: 4, hand_settled_rows: 2 }];
        return [];
      }
    })
  });

  const status = await cleanup.status();
  assert.equal(status.retention.botActionsMs, HOUR);
  assert.equal(status.retention.humanSettledMs, 7 * DAY);
  assert.equal(status.batchSize, 10);
  assert.equal(status.sweepRounds, 1);
  assert.equal(status.backlog.available, true);
  assert.equal(status.backlog.ordinaryActionRows, 4);
  assert.equal(status.backlog.handSettledRows, 2);
  assert.equal(status.backlog.cappedAtBatchSize, true);
  const backlogQuery = queries.find((sql) => sql.includes("ordinary_action_rows"));
  assert.match(backlogQuery, /not exists[\s\S]+action_type != 'HAND_SETTLED'/);
  assert.equal(queries.some((sql) => sql.includes("statement_timeout")), true);
});

test("hole-card phase deletes unique hands and phase 2 keeps the hole-card guard", async () => {
  const queries = [];
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: String(2 * HOUR),
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        queries.push(sql);
        if (sql.includes("hole_card_candidates")) return [{ table_id: "t1", hand_id: "h1", user_id: "u1" }, { table_id: "t1", hand_id: "h1", user_id: "u2" }];
        return [];
      }
    })
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, true);
  assert.equal(result.holeCardsDeleted, 2);
  assert.equal(result.phase1Deleted, 0);
  assert.equal(result.phase2Deleted, 0);
  assert.deepEqual(result.failedPhases, []);
  const holeCardQuery = queries.find((sql) => sql.includes("hole_card_candidates"));
  const phase2Query = queries.find((sql) => sql.includes("id in (select id from candidates)"));
  assert.match(holeCardQuery, /group by pa\.table_id, pa\.hand_id/);
  assert.match(phase2Query, /poker_hole_cards/);
  assert.match(phase2Query, /not exists[\s\S]+poker_hole_cards/);
});

test("hole-card failure is not retried in later rounds and remains failed after action cleanup succeeds", async () => {
  let holeCardCalls = 0;
  let phase1Calls = 0;
  let phase2Calls = 0;
  const cleanup = createActionHistoryCleanup({
    maxSweepRounds: 3,
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: String(2 * HOUR),
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("hole_card_candidates")) {
          holeCardCalls += 1;
          throw new Error("hole-card database unavailable");
        }
        if (sql.includes("candidate_hands")) {
          phase1Calls += 1;
          return phase1Calls === 1 ? [{ id: 1 }, { id: 2 }] : [];
        }
        if (sql.includes("id in (select id from candidates)")) {
          phase2Calls += 1;
          return phase2Calls === 1 ? [{ id: 3 }] : [];
        }
        return [];
      }
    })
  });

  const result = await cleanup.sweep();
  const status = await cleanup.status();
  assert.equal(holeCardCalls, 1);
  assert.equal(phase1Calls, 2);
  assert.equal(phase2Calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "hole_cards_cleanup_failed");
  assert.deepEqual(result.failedPhases, ["hole_cards"]);
  assert.equal(result.phase1Deleted, 2);
  assert.equal(result.phase2Deleted, 1);
  assert.equal(status.lastRun.result, "failed");
  assert.equal(status.lastRun.errorCode, "hole_cards_cleanup_failed");
  assert.deepEqual(status.lastRun.failedPhases, ["hole_cards"]);
});

test("next sweep retries hole cards after a failed hole-card transaction", async () => {
  let holeCardCalls = 0;
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: String(2 * HOUR),
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("hole_card_candidates")) {
          holeCardCalls += 1;
          if (holeCardCalls === 1) throw new Error("temporary hole-card failure");
          return [{ id: 1 }, { id: 2 }];
        }
        return [];
      }
    })
  });

  const first = await cleanup.sweep();
  const second = await cleanup.sweep();
  assert.equal(first.ok, false);
  assert.deepEqual(first.failedPhases, ["hole_cards"]);
  assert.equal(second.ok, true);
  assert.equal(second.holeCardsDeleted, 2);
  assert.deepEqual(second.failedPhases, []);
  assert.equal(holeCardCalls, 2);
});

test("failed phases are unique and ordered when a main phase fails after hole cards", async () => {
  const cleanup = createActionHistoryCleanup({
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: String(2 * HOUR),
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("hole_card_candidates")) throw new Error("hole-card failure");
        if (sql.includes("candidate_hands")) throw new Error("ordinary action failure");
        return [];
      }
    })
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "ordinary_actions_cleanup_failed");
  assert.deepEqual(result.failedPhases, ["hole_cards", "ordinary_actions"]);
  assert.equal(result.holeCardsDeleted, 0);
  assert.equal(result.phase1Deleted, 0);
  assert.equal(result.phase2Deleted, 0);
});

test("enabled no-op sweep is success and does not emit a completion log", async () => {
  const events = [];
  const cleanup = createActionHistoryCleanup({
    klog: (...args) => events.push(args),
    env: {
      WS_POKER_BOT_ACTION_RETENTION_MS: String(HOUR),
      WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
      WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
      WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
      WS_POKER_ACTION_HISTORY_BATCH_SIZE: "5",
      SUPABASE_DB_URL: "postgres://test/db"
    },
    beginSql: async (fn) => fn({ unsafe: async () => [] })
  });

  const result = await cleanup.sweep();
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.holeCardsDeleted, 0);
  assert.equal(result.phase1Deleted, 0);
  assert.equal(result.phase2Deleted, 0);
  assert.equal(events.length, 0);
});
