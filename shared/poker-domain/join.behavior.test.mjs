import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executePokerJoinAuthoritative } from "./join.mjs";
import { calculateCanonicalPokerStakes } from "./table-economy.mjs";
import { isStateStorageValid } from "../../ws-server/poker/snapshot-runtime/poker-state-utils.mjs";

function withBotEnv(fn) {
  const previous = {
    POKER_BOTS_ENABLED: process.env.POKER_BOTS_ENABLED,
    POKER_BOTS_MAX_PER_TABLE: process.env.POKER_BOTS_MAX_PER_TABLE,
    POKER_BOT_BUYIN_BB: process.env.POKER_BOT_BUYIN_BB,
    POKER_BOT_PROFILE_DEFAULT: process.env.POKER_BOT_PROFILE_DEFAULT
  };
  process.env.POKER_BOTS_ENABLED = "1";
  process.env.POKER_BOTS_MAX_PER_TABLE = "2";
  process.env.POKER_BOT_BUYIN_BB = "250";
  process.env.POKER_BOT_PROFILE_DEFAULT = "NORMAL";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function withBotsDisabled(fn) {
  const previous = {
    POKER_BOTS_ENABLED: process.env.POKER_BOTS_ENABLED,
    POKER_BOTS_MAX_PER_TABLE: process.env.POKER_BOTS_MAX_PER_TABLE,
    POKER_BOT_BUYIN_BB: process.env.POKER_BOT_BUYIN_BB,
    POKER_BOT_PROFILE_DEFAULT: process.env.POKER_BOT_PROFILE_DEFAULT
  };
  delete process.env.POKER_BOTS_ENABLED;
  delete process.env.POKER_BOTS_MAX_PER_TABLE;
  delete process.env.POKER_BOT_BUYIN_BB;
  delete process.env.POKER_BOT_PROFILE_DEFAULT;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function withLockedState(args, { validateStateForStorage = () => true } = {}) {
  const configuredBuyIn = Number.isSafeInteger(Number(args?.buyIn)) && Number(args.buyIn) > 0
    ? Number(args.buyIn)
    : 100;
  const originalBeginSql = args?.beginSql;
  const progressionBalance = Number.isSafeInteger(Number(args?.progressionBalance)) && Number(args.progressionBalance) >= 0
    ? Number(args.progressionBalance)
    : configuredBuyIn + Math.ceil(configuredBuyIn / 10);
  const progressionEnv = args?.progressionEnv || {
    POKER_BUY_IN_TIERS_JSON: JSON.stringify([100, 150, 200, 250, 300, 500, 1_000])
  };
  const beginSql = typeof originalBeginSql === "function"
    ? (fn) => originalBeginSql(async (tx) => {
        const wrappedTx = Object.create(tx || null);
        wrappedTx.unsafe = async (sql, params = []) => {
          if (String(sql).includes("to_regclass")) return [{ available: false }];
          assert.doesNotMatch(String(sql), /is_slow_only|poker_auto_class|poker_access_policy|poker_bot_tier_policy/, "legacy JOIN never references new schema");
          const rows = await tx.unsafe(sql, params);
          if (String(sql).includes("from public.poker_tables") && Array.isArray(rows)) {
            return rows.map((row) => {
              if (!row) return row;
              const buyIn = row.buy_in == null ? configuredBuyIn : Number(row.buy_in);
              return {
                ...row,
                buy_in: row.buy_in == null ? configuredBuyIn : row.buy_in,
                stakes: row.stakes == null ? calculateCanonicalPokerStakes(buyIn) : row.stakes
              };
            });
          }
          if (String(sql).includes("from public.chips_accounts") && String(sql).includes("account_type = 'USER'") && Array.isArray(rows) && rows.length === 0) {
            return [{ balance: progressionBalance }];
          }
          return rows;
        };
        return fn(wrappedTx);
      })
    : originalBeginSql;
  return {
    ...args,
    env: progressionEnv,
    beginSql,
    loadStateForUpdate: async (tx, tableId) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      const row = rows?.[0] || null;
      if (!row) return { ok: false, reason: "not_found" };
      return { ok: true, version: row.version, state: row.state };
    },
    updateStateLocked: async (tx, { tableId, nextState }) => {
      const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, nextState]);
      if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: "not_found" };
      const nextVersion = Number(rows?.[0]?.version);
      if (!Number.isInteger(nextVersion) || nextVersion <= 0) return { ok: false, reason: "invalid" };
      return { ok: true, newVersion: nextVersion };
    },
    validateStateForStorage
  };
}

function withStorageValidator(args) {
  return withLockedState(args, {
    validateStateForStorage: (state) => isStateStorageValid(state, {
      requireNoDeck: true,
      requireHandSeed: false,
      requireCommunityDealt: false
    })
  });
}

test("shared join module imports without Netlify adapter dependency at module load", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "join-import-"));
  const stagedDir = path.join(tempDir, "shared", "poker-domain");
  const stagedJoin = path.join(stagedDir, "join.mjs");
  const stagedBots = path.join(stagedDir, "bots.mjs");
  const stagedTableBuyIn = path.join(stagedDir, "table-buy-in.mjs");
  const stagedTableEconomy = path.join(stagedDir, "table-economy.mjs");
  const stagedProgression = path.join(stagedDir, "poker-progression.mjs");
  const stagedBotAccess = path.join(stagedDir, "bot-access.mjs");
  const stagedTableParticipation = path.join(stagedDir, "table-participation.mjs");
  try {
    await fs.mkdir(stagedDir, { recursive: true });
    await fs.copyFile("shared/poker-domain/join.mjs", stagedJoin);
    await fs.copyFile("shared/poker-domain/bots.mjs", stagedBots);
    await fs.copyFile("shared/poker-domain/demand-refill.mjs", path.join(stagedDir, "demand-refill.mjs"));
    await fs.copyFile("shared/poker-domain/table-buy-in.mjs", stagedTableBuyIn);
    await fs.copyFile("shared/poker-domain/table-economy.mjs", stagedTableEconomy);
    await fs.copyFile("shared/poker-domain/poker-progression.mjs", stagedProgression);
    await fs.copyFile("shared/poker-domain/bot-access.mjs", stagedBotAccess);
    await fs.copyFile("shared/poker-domain/table-participation.mjs", stagedTableParticipation);
    const module = await import(pathToFileURL(stagedJoin).href);
    assert.equal(typeof module.executePokerJoinAuthoritative, "function");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("shared join requires injected locked-state validator", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async () => ({ ok: true }),
      tableId: "t1",
      userId: "u1",
      requestId: "missing-validator",
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true }),
      loadStateForUpdate: async () => ({ ok: true, version: 0, state: {} }),
      updateStateLocked: async () => ({ ok: true, newVersion: 1 })
    }),
    (error) => error?.code === "temporarily_unavailable"
  );
});

test("fresh join locks the bankroll row before posting the table buy-in", async () => withBotsDisabled(async () => {
  const events = [];
  const seatRows = [];
  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("from public.poker_tables")) return [{ id: "t-progression-lock", status: "OPEN", max_players: 6, buy_in: 500 }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) return seatRows.map((row) => ({ ...row }));
        if (text.includes("from public.chips_accounts") && text.includes("account_type = 'USER'")) {
          events.push(text);
          return [{ balance: 550 }];
        }
        if (text.includes("insert into public.poker_seats")) {
          seatRows.push({ user_id: "u-progression-lock", seat_no: 1, status: "ACTIVE", is_bot: false, bot_profile: null, leave_after_hand: false, stack: 0 });
          return [{ seat_no: 1 }];
        }
        if (text.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t-progression-lock", seats: [], stacks: {} } }];
        if (text.includes("update public.poker_state set state")) return [{ version: 2 }];
        if (text.includes("update public.poker_seats set stack")) {
          seatRows[0].stack = 500;
          return [{ ok: true }];
        }
        if (text.includes("update public.poker_tables")) return [];
        return [];
      }
    }),
    tableId: "t-progression-lock",
    userId: "u-progression-lock",
    requestId: "join-progression-lock",
    buyIn: 500,
    progressionBalance: 550,
    postTransactionFn: async () => {
      events.push("postTransaction");
      return { ok: true };
    }
  }));
  assert.equal(result.ok, true);
  assert.equal(result.stack, 500);
  assert.match(events[0], /for update/i);
  assert.equal(events.indexOf("postTransaction") > 0, true);
}));

test("authoritative wallet threshold does not mutate automatic class under FORCE_NORMAL (Finding 1)", async () => withBotsDisabled(async () => {
  const userId = "00000000-0000-4000-8000-0000000000f1";
  const tableId = "00000000-0000-4000-8000-0000000000f2";
  const calls = [];
  let seatInserted = false;
  let automaticUpdateCalls = 0;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        calls.push({ text, params });
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) {
          return [{ id: tableId, status: "OPEN", max_players: 6, buy_in: 100, stakes: calculateCanonicalPokerStakes(100), created_by: userId, lifecycle_kind: "STANDARD", has_human_participant: false, is_slow_only: false }];
        }
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return seatInserted ? [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }] : [];
        if (text.includes("from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 1_000_000_000 }];
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 4 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "FORCE_NORMAL", poker_access_revision: 7 }];
        if (text.includes("update public.chips_accounts")) { automaticUpdateCalls += 1; return [{ poker_auto_class: "SLOW", poker_access_override: "FORCE_NORMAL", poker_access_revision: 8, poker_auto_slow_at: "2026-09-27T00:00:00.000Z" }]; }
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: false, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) { seatInserted = true; return [{ seat_no: 1 }]; }
        if (text.startsWith("update public.poker_seats set stack")) return [{ ok: true }];
        if (text.startsWith("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId,
    userId,
    requestId: "force-normal-threshold",
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true }),
    loadStateForUpdate: async (tx) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      return { ok: true, version: rows[0].version, state: rows[0].state };
    },
    updateStateLocked: async (tx, { nextState }) => {
      const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, nextState]);
      return { ok: true, newVersion: rows[0]?.version || 2 };
    },
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  assert.equal(result.ok, true);
  assert.equal(automaticUpdateCalls, 0, "zero DB mutation while override is FORCE_NORMAL");
  assert.equal(calls.some(({ text }) => text.includes("update public.chips_accounts")), false);
  assert.equal(result.access.automaticClass, "NORMAL");
  assert.equal(result.access.override, "FORCE_NORMAL");
  assert.equal(result.access.effectiveClass, "NORMAL");
  assert.equal(result.access.revision, 7);
  assert.equal(result.access.slowThresholdCh, 1_000_000_000);
  assert.equal(result.access.slowHysteresisBps, 500);
  assert.equal(result.access.slowRecoveryThresholdCh, 950_000_000);
}));

test("fresh join with wallet < recovery threshold transitions SLOW->NORMAL and bumps revision (T059, T062)", async () => withBotsDisabled(async () => {
  const userId = "00000000-0000-4000-8000-0000000000a1";
  const tableId = "00000000-0000-4000-8000-0000000000a2";
  const calls = [];
  let seatInserted = false;
  let automaticUpdateCalls = 0;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        calls.push({ text, params });
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) {
          return [{ id: tableId, status: "OPEN", max_players: 6, buy_in: 100, stakes: calculateCanonicalPokerStakes(100), created_by: userId, lifecycle_kind: "STANDARD", has_human_participant: false, is_slow_only: false }];
        }
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return seatInserted ? [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }] : [];
        if (text.includes("from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 500_000_000 }]; // < 950_000_000 recovery threshold
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 5 }];
        if (text.includes("update public.chips_accounts") && text.includes("set poker_auto_class = 'NORMAL'")) {
          automaticUpdateCalls += 1;
          return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 6, poker_auto_slow_at: "2026-09-27T00:00:00.000Z" }];
        }
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: false, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) { seatInserted = true; return [{ seat_no: 1 }]; }
        if (text.startsWith("update public.poker_seats set stack")) return [{ ok: true }];
        if (text.startsWith("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId,
    userId,
    requestId: "recovery-join",
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true }),
    loadStateForUpdate: async (tx) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      return { ok: true, version: rows[0].version, state: rows[0].state };
    },
    updateStateLocked: async (tx, { nextState }) => {
      const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, nextState]);
      return { ok: true, newVersion: rows[0]?.version || 2 };
    },
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  assert.equal(result.ok, true);
  assert.equal(automaticUpdateCalls, 1);
  assert.equal(result.access.automaticClass, "NORMAL");
  assert.equal(result.access.effectiveClass, "NORMAL");
  assert.equal(result.access.revision, 6);
  assert.equal(result.access.slowThresholdCh, 1_000_000_000);
  assert.equal(result.access.slowHysteresisBps, 500);
  assert.equal(result.access.slowRecoveryThresholdCh, 950_000_000);
}));

test("fresh join with wallet in hysteresis band retains previous class with zero mutation (T059, T062)", async () => withBotsDisabled(async () => {
  const userId = "00000000-0000-4000-8000-0000000000b1";
  const tableId = "00000000-0000-4000-8000-0000000000b2";
  let automaticUpdateCalls = 0;
  let seatInserted = false;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) {
          return [{ id: tableId, status: "OPEN", max_players: 6, buy_in: 100, stakes: calculateCanonicalPokerStakes(100), created_by: userId, lifecycle_kind: "STANDARD", has_human_participant: false, is_slow_only: false }];
        }
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return seatInserted ? [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }] : [];
        if (text.includes("from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 960_000_000 }]; // Inside [950m, 1b)
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 3 }];
        if (text.includes("update public.chips_accounts")) {
          automaticUpdateCalls += 1;
          return [];
        }
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: false, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) { seatInserted = true; return [{ seat_no: 1 }]; }
        if (text.startsWith("update public.poker_seats set stack")) return [{ ok: true }];
        if (text.startsWith("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId,
    userId,
    requestId: "hysteresis-band-join",
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true }),
    loadStateForUpdate: async (tx) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      return { ok: true, version: rows[0].version, state: rows[0].state };
    },
    updateStateLocked: async (tx, { nextState }) => {
      const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, nextState]);
      return { ok: true, newVersion: rows[0]?.version || 2 };
    },
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  assert.equal(result.ok, true);
  assert.equal(automaticUpdateCalls, 0, "must perform zero DB update when within hysteresis band");
  assert.equal(result.access.automaticClass, "SLOW");
  assert.equal(result.access.effectiveClass, "SLOW");
  assert.equal(result.access.revision, 3);
  assert.equal(result.access.slowThresholdCh, 1_000_000_000);
  assert.equal(result.access.slowHysteresisBps, 500);
  assert.equal(result.access.slowRecoveryThresholdCh, 950_000_000);
}));

test("fresh join with custom policy thresholds entry=2000 and recovery=1500 returns exact thresholds (Finding 2)", async () => withBotsDisabled(async () => {
  const userId = "00000000-0000-4000-8000-0000000000b5";
  const tableId = "00000000-0000-4000-8000-0000000000b6";
  let seatInserted = false;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) {
          return [{ id: tableId, status: "OPEN", max_players: 6, buy_in: 100, stakes: calculateCanonicalPokerStakes(100), created_by: userId, lifecycle_kind: "STANDARD", has_human_participant: false, is_slow_only: false }];
        }
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return seatInserted ? [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }] : [];
        if (text.includes("from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 1800 }]; // In hysteresis band [1500, 2000)
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 2000, slow_hysteresis_bps: 2500, slow_recovery_threshold_ch: 1500, revision: 4 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 2 }];
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: false, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) { seatInserted = true; return [{ seat_no: 1 }]; }
        if (text.startsWith("update public.poker_seats set stack")) return [{ ok: true }];
        if (text.startsWith("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId,
    userId,
    requestId: "custom-thresholds-join",
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true }),
    loadStateForUpdate: async (tx) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      return { ok: true, version: rows[0].version, state: rows[0].state };
    },
    updateStateLocked: async (tx, { nextState }) => {
      const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, nextState]);
      return { ok: true, newVersion: rows[0]?.version || 2 };
    },
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  assert.equal(result.ok, true);
  assert.equal(result.access.slowThresholdCh, 2000);
  assert.equal(result.access.slowHysteresisBps, 2500);
  assert.equal(result.access.slowRecoveryThresholdCh, 1500);
  assert.equal(result.access.policyRevision, 4);
  assert.equal(result.access.automaticClass, "NORMAL");
  assert.equal(result.access.effectiveClass, "NORMAL");
}));

test("is_slow_only remains one-way: recovered NORMAL user cannot fresh-join an existing SLOW-only table (T063)", async () => withBotsDisabled(async () => {
  const userId = "00000000-0000-4000-8000-0000000000c1";
  const tableId = "00000000-0000-4000-8000-0000000000c2";
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          const text = String(sql);
          if (text.includes("to_regclass")) return [{ available: true }];
          if (text.includes("from public.poker_tables")) {
            // Table was marked SLOW-only previously
            return [{ id: tableId, status: "OPEN", max_players: 6, buy_in: 100, stakes: calculateCanonicalPokerStakes(100), created_by: "someone-else", lifecycle_kind: "STANDARD", has_human_participant: true, is_slow_only: true }];
          }
          if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return [];
          if (text.includes("from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
          if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 1000 }];
          if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
          // User is NORMAL (e.g. recovered or always NORMAL)
          if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 2 }];
          return [];
        }
      }),
      tableId,
      userId,
      requestId: "slow-only-one-way-join",
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true }),
      loadStateForUpdate: async (tx) => {
        const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
        return { ok: true, version: rows[0].version, state: rows[0].state };
      },
      updateStateLocked: async (tx, { nextState }) => {
        const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, nextState]);
        return { ok: true, newVersion: rows[0]?.version || 2 };
      },
      validateStateForStorage: () => true,
      env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
    }),
    (error) => error?.message === "normal_table_required" || error?.validationReason === "normal_table_required"
  );
}));

test("fresh FORCE_RESTRICTED own empty STANDARD join accepts with zero bot funding", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-0000000000f3";
  const userId = "00000000-0000-4000-8000-0000000000f4";
  const calls = [];
  let seatInserted = false;
  const tx = {
    unsafe: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes("to_regclass")) return [{ available: true }];
      if (text.includes("from public.poker_tables")) return [{
        id: tableId, status: "OPEN", max_players: 6, buy_in: 100,
        stakes: calculateCanonicalPokerStakes(100), created_by: userId,
        lifecycle_kind: "STANDARD", has_human_participant: false, is_slow_only: false
      }];
      if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) {
        return seatInserted ? [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }] : [];
      }
      if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
      if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
      if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 4 }];
      if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: true, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
      if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
      if (text.startsWith("insert into public.poker_seats")) { seatInserted = true; return [{ seat_no: 1 }]; }
      if (text.startsWith("update public.poker_seats set stack")) return [{ ok: true }];
      if (text.startsWith("select 1 from public.chips_transactions")) return [];
      if (text.startsWith("update public.poker_state set state")) return [{ version: 2 }];
      return [];
    }
  };
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn(tx),
    tableId,
    userId,
    requestId: "restricted-own-empty",
    buyIn: 100,
    postTransactionFn: async ({ metadata }) => {
      calls.push({ text: "postTransaction", metadata });
      return { ok: true };
    },
    loadStateForUpdate: async (lockedTx) => {
      const rows = await lockedTx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      return { ok: true, version: rows[0]?.version || 1, state: rows[0]?.state || { tableId, seats: [], stacks: {} } };
    },
    updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });
  assert.equal(result.ok, true);
  assert.equal(result.access.effectiveClass, "RESTRICTED");
  assert.deepEqual(result.seededBots, []);
  assert.equal(calls.some((entry) => entry?.metadata?.actor === "BOT"), false);
}));

test("an active RESTRICTED human blocks bot seeding for a later NORMAL join", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-0000000000c1";
  const restrictedUserId = "00000000-0000-4000-8000-0000000000c2";
  const normalUserId = "00000000-0000-4000-8000-0000000000c3";
  const accessByUser = new Map([
    [restrictedUserId, { poker_auto_class: "NORMAL", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 2 }],
    [normalUserId, { poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 3 }]
  ]);
  const store = {
    table: {
      id: tableId,
      status: "OPEN",
      max_players: 6,
      buy_in: 100,
      stakes: calculateCanonicalPokerStakes(100),
      created_by: restrictedUserId,
      lifecycle_kind: "STANDARD",
      has_human_participant: false,
      is_slow_only: false
    },
    seatRows: [],
    stateRow: { version: 1, state: { tableId, seats: [], stacks: {} } },
    ledgerCalls: [],
    accessSnapshotReads: 0
  };
  const runJoin = (userId, requestId) => executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) return [store.table];
        if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && seat.status === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return store.seatRows.map((seat) => ({ ...seat }));
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) {
          const access = accessByUser.get(params[0]);
          return access ? [access] : [];
        }
        if (text.includes("select user_id, poker_auto_class, poker_access_override")) {
          store.accessSnapshotReads += 1;
          return (params[0] || []).map((id) => ({ user_id: id, ...accessByUser.get(id) })).filter((row) => row.poker_auto_class);
        }
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: true, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) {
          const isBot = text.includes("is_bot");
          store.seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", is_bot: isBot, stack: isBot ? params[4] : 0 });
          return [{ seat_no: params[2] }];
        }
        if (text.startsWith("update public.poker_seats set stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [];
        }
        if (text.includes("select 1 from public.chips_transactions")) return [];
        if (text.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (text.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          return [{ version: store.stateRow.version }];
        }
        if (text.includes("update public.poker_tables")) return [];
        return [];
      }
    }),
    tableId,
    userId,
    requestId,
    buyIn: 100,
    postTransactionFn: async (payload) => {
      store.ledgerCalls.push(payload);
      return { ok: true };
    },
    loadStateForUpdate: async () => ({ ok: true, version: store.stateRow.version, state: store.stateRow.state }),
    updateStateLocked: async (_tx, { nextState }) => {
      store.stateRow.state = nextState;
      store.stateRow.version += 1;
      return { ok: true, newVersion: store.stateRow.version };
    },
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  const restrictedJoin = await runJoin(restrictedUserId, "restricted-first");
  assert.equal(restrictedJoin.ok, true);
  assert.equal(restrictedJoin.seededBots.length, 0);
  store.table.has_human_participant = true;
  const normalJoin = await runJoin(normalUserId, "normal-second");

  assert.equal(normalJoin.ok, true);
  assert.equal(store.seatRows.filter((seat) => !seat.is_bot).length, 2);
  assert.equal(store.seatRows.filter((seat) => seat.is_bot).length, 0);
  assert.equal(store.ledgerCalls.filter((payload) => payload.metadata?.actor === "BOT").length, 0);
  assert.equal(store.accessSnapshotReads, 1);
}));

test("missing existing human access keeps NORMAL JOIN legal but blocks bot funding", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-0000000000c4";
  const existingUserId = "00000000-0000-4000-8000-0000000000c5";
  const joiningUserId = "00000000-0000-4000-8000-0000000000c6";
  const store = {
    table: {
      id: tableId,
      status: "OPEN",
      max_players: 6,
      buy_in: 100,
      stakes: calculateCanonicalPokerStakes(100),
      created_by: existingUserId,
      lifecycle_kind: "STANDARD",
      has_human_participant: true,
      is_slow_only: false
    },
    seatRows: [{ user_id: existingUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }],
    stateRow: {
      version: 2,
      state: { tableId, seats: [{ userId: existingUserId, seatNo: 1, status: "ACTIVE" }], stacks: { [existingUserId]: 100 } }
    },
    ledgerCalls: [],
    accessSnapshotReads: 0
  };
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) return [store.table];
        if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) return [];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return store.seatRows.map((seat) => ({ ...seat }));
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 4 }];
        if (text.includes("select user_id, poker_auto_class, poker_access_override")) {
          store.accessSnapshotReads += 1;
          return [];
        }
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: true, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) {
          const isBot = text.includes("is_bot");
          store.seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", is_bot: isBot, stack: isBot ? params[4] : 0 });
          return [{ seat_no: params[2] }];
        }
        if (text.startsWith("update public.poker_seats set stack")) return [];
        if (text.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (text.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          return [{ version: store.stateRow.version }];
        }
        if (text.includes("update public.poker_tables")) return [];
        return [];
      }
    }),
    tableId,
    userId: joiningUserId,
    requestId: "unknown-existing-human-access",
    buyIn: 100,
    postTransactionFn: async (payload) => {
      store.ledgerCalls.push(payload);
      return { ok: true };
    },
    loadStateForUpdate: async () => ({ ok: true, version: store.stateRow.version, state: store.stateRow.state }),
    updateStateLocked: async (_tx, { nextState }) => {
      store.stateRow.state = nextState;
      store.stateRow.version += 1;
      return { ok: true, newVersion: store.stateRow.version };
    },
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  assert.equal(result.ok, true);
  assert.equal(store.seatRows.filter((seat) => !seat.is_bot).length, 2);
  assert.equal(store.seatRows.filter((seat) => seat.is_bot).length, 0);
  assert.equal(store.ledgerCalls.filter((payload) => payload.metadata?.actor === "BOT").length, 0);
  assert.equal(store.accessSnapshotReads, 1);
}));

test("fresh NORMAL JOIN remains fail-soft when the tier policy disables bot funding", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-0000000000c7";
  const userId = "00000000-0000-4000-8000-0000000000c8";
  const ledgerCalls = [];
  let seatInserted = false;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) return [{
          id: tableId,
          status: "OPEN",
          max_players: 6,
          buy_in: 100,
          stakes: calculateCanonicalPokerStakes(100),
          created_by: userId,
          lifecycle_kind: "STANDARD",
          has_human_participant: false,
          is_slow_only: false
        }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) {
          return seatInserted ? [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }] : [];
        }
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) {
          return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
        }
        if (text.includes("from public.poker_bot_tier_policy")) return [{
          buy_in: 100,
          enabled: false,
          normal_refill_threshold_ch: 1,
          normal_refill_amount_ch: 1,
          slow_refill_threshold_ch: 1,
          slow_refill_amount_ch: 1,
          revision: 1
        }];
        if (text.includes("system_key = any")) return [];
        if (text.startsWith("insert into public.poker_seats")) {
          seatInserted = true;
          return [{ seat_no: 1 }];
        }
        if (text.startsWith("update public.poker_seats set stack")) return [];
        if (text.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
        if (text.includes("update public.poker_state set state")) return [{ version: 2 }];
        if (text.includes("update public.poker_tables")) return [];
        return [];
      }
    }),
    tableId,
    userId,
    requestId: "normal-disabled-tier-fail-soft",
    buyIn: 100,
    postTransactionFn: async (payload) => {
      ledgerCalls.push(payload);
      return { ok: true };
    },
    loadStateForUpdate: async () => ({ ok: true, version: 1, state: { tableId, seats: [], stacks: {} } }),
    updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.seededBots, []);
  assert.equal(ledgerCalls.filter((payload) => payload.metadata?.actor === "BOT").length, 0);
}));

test("fresh FORCE_RESTRICTED join rejects an active bot table before buy-in", async () => withBotsDisabled(async () => {
  let ledgerCalls = 0;
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          const text = String(sql);
          if (text.includes("to_regclass")) return [{ available: true }];
          if (text.includes("from public.poker_tables")) return [{
            id: "00000000-0000-4000-8000-0000000000f5", status: "OPEN", max_players: 6, buy_in: 100,
            stakes: calculateCanonicalPokerStakes(100), created_by: "other", lifecycle_kind: "STANDARD",
            has_human_participant: true, is_slow_only: false
          }];
          if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return [{ user_id: "bot:existing", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 100 }];
          if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
          if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
          if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 4 }];
          return [];
        }
      }),
      tableId: "00000000-0000-4000-8000-0000000000f5",
      userId: "00000000-0000-4000-8000-0000000000f6",
      requestId: "restricted-bot-table",
      buyIn: 100,
      postTransactionFn: async () => { ledgerCalls += 1; return { ok: true }; },
      loadStateForUpdate: async () => ({ ok: true, version: 1, state: { seats: [], stacks: {} } }),
      updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
      validateStateForStorage: () => true,
      env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
    }),
    (error) => error?.code === "restricted_table_required"
  );
  assert.equal(ledgerCalls, 0);
}));

test("existing financed FORCE_RESTRICTED rejoin remains legal without a new debit", async () => withBotsDisabled(async () => {
  const tableId = "00000000-0000-4000-8000-0000000000fa";
  const userId = "00000000-0000-4000-8000-0000000000fb";
  let postTransactionCalls = 0;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) return [{
          id: tableId, status: "OPEN", max_players: 6, buy_in: 100,
          stakes: calculateCanonicalPokerStakes(100), created_by: "owner",
          lifecycle_kind: "STANDARD", has_human_participant: true, is_slow_only: false
        }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) {
          return [{ user_id: userId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }];
        }
        if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) {
          return [{ seat_no: 1, stack: 100 }];
        }
        if (text.includes("from public.poker_state")) {
          return [{ version: 3, state: {
            tableId,
            seats: [{ userId, seatNo: 1, status: "ACTIVE" }],
            stacks: { [userId]: 100 }
          } }];
        }
        return [];
      }
    }),
    tableId,
    userId,
    requestId: "restricted-financed-rejoin",
    buyIn: 100,
    postTransactionFn: async () => { postTransactionCalls += 1; return { ok: true }; },
    loadStateForUpdate: async (tx) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      return { ok: true, version: rows[0].version, state: rows[0].state };
    },
    updateStateLocked: async () => ({ ok: true, newVersion: 4 }),
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });
  assert.equal(result.ok, true);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 100);
  assert.equal(postTransactionCalls, 0);
}));

test("fresh FORCE_RESTRICTED join rejects SLOW-only and CONTINUOUS_BOT targets before buy-in", async () => withBotsDisabled(async () => {
  for (const [label, tableOverrides] of [
    ["slow-only", { lifecycle_kind: "STANDARD", is_slow_only: true }],
    ["continuous", { lifecycle_kind: "CONTINUOUS_BOT", is_slow_only: false }],
  ]) {
    let ledgerCalls = 0;
    await assert.rejects(
      () => executePokerJoinAuthoritative({
        beginSql: async (fn) => fn({
          unsafe: async (sql) => {
            const text = String(sql);
            if (text.includes("to_regclass")) return [{ available: true }];
            if (text.includes("from public.poker_tables")) return [{
              id: `00000000-0000-4000-8000-000000000${label === "slow-only" ? "f7" : "f8"}`,
              status: "OPEN", max_players: 6, buy_in: 100,
              stakes: calculateCanonicalPokerStakes(100), created_by: "other",
              has_human_participant: false, ...tableOverrides
            }];
            if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return [];
            if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
            if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
            if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 4 }];
            return [];
          }
        }),
        tableId: `00000000-0000-4000-8000-000000000${label === "slow-only" ? "f7" : "f8"}`,
        userId: "00000000-0000-4000-8000-0000000000f9",
        requestId: `restricted-${label}`,
        buyIn: 100,
        postTransactionFn: async () => { ledgerCalls += 1; return { ok: true }; },
        loadStateForUpdate: async () => ({ ok: true, version: 1, state: { seats: [], stacks: {} } }),
        updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
        validateStateForStorage: () => true,
        env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
      }),
      (error) => error?.code === "restricted_table_required"
    );
    assert.equal(ledgerCalls, 0, `${label} must reject before ledger buy-in`);
  }
}));

test("existing SLOW human makes an ordinary table reject a fresh NORMAL join before buy-in", async () => withBotsDisabled(async () => {
  const tableId = "00000000-0000-4000-8000-000000000101";
  const slowUserId = "00000000-0000-4000-8000-000000000102";
  const normalUserId = "00000000-0000-4000-8000-000000000103";
  const queries = [];
  let buyInCalls = 0;
  let seatInsertCalls = 0;
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params = []) => {
          const text = String(sql);
          queries.push(text);
          if (text.includes("to_regclass")) return [{ available: true }];
          if (text.includes("from public.poker_tables")) return [{
            id: tableId, status: "OPEN", max_players: 6, buy_in: 100,
            stakes: calculateCanonicalPokerStakes(100), created_by: slowUserId,
            lifecycle_kind: "STANDARD", has_human_participant: true, is_slow_only: false
          }];
          if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) {
            return [{ user_id: slowUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }];
          }
          if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
          if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
          if (text.includes("select poker_auto_class, poker_access_override")) {
            return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 2 }];
          }
          if (text.includes("select user_id, poker_auto_class, poker_access_override")) {
            assert.match(text, /for update/i);
            assert.deepEqual(params[0], [slowUserId]);
            return [{ user_id: slowUserId, poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 3 }];
          }
          if (text.startsWith("insert into public.poker_seats")) { seatInsertCalls += 1; return [{ seat_no: 2 }]; }
          if (text.includes("TABLE_BUY_IN")) buyInCalls += 1;
          return [];
        }
      }),
      tableId,
      userId: normalUserId,
      requestId: "slow-existing-normal-reject",
      buyIn: 100,
      postTransactionFn: async () => { buyInCalls += 1; return { ok: true }; },
      loadStateForUpdate: async () => ({ ok: true, version: 1, state: { tableId, seats: [], stacks: {} } }),
      updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
      validateStateForStorage: () => true,
      env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
    }),
    (error) => error?.code === "normal_table_required"
  );
  assert.equal(seatInsertCalls, 0);
  assert.equal(buyInCalls, 0);
}));

test("existing SLOW human permits a SLOW join and selects sticky SLOW funding", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-000000000104";
  const slowUserId = "00000000-0000-4000-8000-000000000105";
  const joiningUserId = "00000000-0000-4000-8000-000000000106";
  const seatRows = [{ user_id: slowUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }];
  const tableUpdates = [];
  const ledgerCalls = [];
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) return [{
          id: tableId, status: "OPEN", max_players: 6, buy_in: 100,
          stakes: calculateCanonicalPokerStakes(100), created_by: slowUserId,
          lifecycle_kind: "STANDARD", has_human_participant: true, is_slow_only: false
        }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return seatRows.map((row) => ({ ...row }));
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 4 }];
        if (text.includes("select user_id, poker_auto_class, poker_access_override")) return [{ user_id: slowUserId, poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 5 }];
        if (text.includes("from public.poker_bot_tier_policy")) return [{ buy_in: 100, enabled: true, normal_refill_threshold_ch: 1, normal_refill_amount_ch: 1, slow_refill_threshold_ch: 1, slow_refill_amount_ch: 1, revision: 1 }];
        if (text.includes("system_key = any")) return [{ system_key: "POKER_BOT_BANKROLL_100" }, { system_key: "POKER_BOT_SLOW_BANKROLL_100" }];
        if (text.startsWith("insert into public.poker_seats")) {
          const isBot = text.includes("is_bot");
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", is_bot: isBot, stack: isBot ? params[4] : 100 });
          return [{ seat_no: params[2] }];
        }
        if (text.startsWith("update public.poker_seats set stack")) return [];
        if (text.includes("select 1 from public.chips_transactions")) return [];
        if (text.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId, seats: [], stacks: {} } }];
        if (text.includes("update public.poker_state set state")) return [{ version: 2 }];
        if (text.includes("update public.poker_tables")) { tableUpdates.push({ params }); return []; }
        return [];
      }
    }),
    tableId,
    userId: joiningUserId,
    requestId: "slow-existing-slow-join",
    buyIn: 100,
    postTransactionFn: async (payload) => { ledgerCalls.push(payload); return { ok: true }; },
    loadStateForUpdate: async () => ({ ok: true, version: 1, state: {
      tableId,
      seats: [{ userId: slowUserId, seatNo: 1, status: "ACTIVE", isBot: false, stack: 100 }],
      stacks: { [slowUserId]: 100 }
    } }),
    updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });
  assert.equal(result.ok, true);
  assert.equal(result.access.effectiveClass, "SLOW");
  assert.deepEqual(result.seededBots, [], "the existing two-human join keeps the current no-new-seed lifecycle");
  assert.equal(ledgerCalls.filter((entry) => entry.metadata?.actor === "BOT").length, 0);
  assert.equal(tableUpdates.some(({ params }) => params[1] === true), true);
}));

test("fresh JOIN serializes with a committed FORCE_RESTRICTED override before bot funding", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-000000000107";
  const existingUserId = "00000000-0000-4000-8000-000000000108";
  const joiningUserId = "00000000-0000-4000-8000-000000000109";
  const seatRows = [{ user_id: existingUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }];
  const ledgerCalls = [];
  let adminCommitted = false;
  let sawAccessRowLock = false;
  const result = await executePokerJoinAuthoritative({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("to_regclass")) return [{ available: true }];
        if (text.includes("from public.poker_tables")) return [{
          id: tableId, status: "OPEN", max_players: 6, buy_in: 100,
          stakes: calculateCanonicalPokerStakes(100), created_by: existingUserId,
          lifecycle_kind: "STANDARD", has_human_participant: true, is_slow_only: false
        }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc")) return seatRows.map((row) => ({ ...row }));
        if (text.includes("select balance") && text.includes("chips_accounts")) return [{ balance: 100 }];
        if (text.includes("from public.poker_access_policy")) return [{ slow_threshold_ch: 1_000_000_000, slow_hysteresis_bps: 500, slow_recovery_threshold_ch: 950_000_000, revision: 1 }];
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
        if (text.includes("select user_id, poker_auto_class, poker_access_override")) {
          sawAccessRowLock = /for update/i.test(text);
          // This is the deterministic interleaving point: Admin has committed
          // before JOIN can use the locked snapshot for funding.
          adminCommitted = true;
          return [{ user_id: existingUserId, poker_auto_class: "NORMAL", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 2 }];
        }
        if (text.startsWith("insert into public.poker_seats")) {
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", is_bot: false, stack: 100 });
          return [{ seat_no: params[2] }];
        }
        if (text.startsWith("update public.poker_seats set stack")) return [];
        if (text.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId, seats: [{ userId: existingUserId, seatNo: 1, status: "ACTIVE", isBot: false }], stacks: { [existingUserId]: 100 } } }];
        if (text.includes("update public.poker_state set state")) return [{ version: 2 }];
        if (text.includes("update public.poker_tables")) return [];
        return [];
      }
    }),
    tableId,
    userId: joiningUserId,
    requestId: "join-admin-restricted-race",
    buyIn: 100,
    postTransactionFn: async (payload) => { ledgerCalls.push(payload); return { ok: true }; },
    loadStateForUpdate: async () => ({ ok: true, version: 1, state: { tableId, seats: [{ userId: existingUserId, seatNo: 1, status: "ACTIVE", isBot: false }], stacks: { [existingUserId]: 100 } } }),
    updateStateLocked: async () => ({ ok: true, newVersion: 2 }),
    validateStateForStorage: () => true,
    env: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) }
  });
  assert.equal(result.ok, true);
  assert.equal(adminCommitted, true);
  assert.equal(sawAccessRowLock, true);
  assert.equal(ledgerCalls.filter((entry) => entry.metadata?.actor === "BOT").length, 0);
}));

test("fresh join rejects a 500 CH tier when bankroll is 549 CH", async () => withBotsDisabled(async () => {
  const writes = [];
  await assert.rejects(
    () => executePokerJoinAuthoritative(withStorageValidator({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          const text = String(sql);
          if (text.includes("from public.poker_tables")) return [{ id: "t-tier-locked", status: "OPEN", max_players: 6, buy_in: 500 }];
          if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) return [];
          if (text.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t-tier-locked", seats: [], stacks: {} } }];
          if (text.includes("insert into public.poker_seats")) writes.push("insert_seat");
          return [];
        }
      }),
      tableId: "t-tier-locked",
      userId: "u-tier-locked",
      requestId: "join-tier-locked",
      buyIn: 500,
      progressionBalance: 549,
      postTransactionFn: async () => { writes.push("ledger_buyin"); return { ok: true }; }
    })),
    (error) => {
      assert.equal(error?.code, "buy_in_tier_locked");
      assert.equal(error?.buyIn, 500);
      assert.equal(error?.requiredBankroll, 550);
      assert.equal(error?.balance, 549);
      return true;
    }
  );
  assert.deepEqual(writes, []);
}));

test("active rejoin succeeds below the current tier threshold without reading progression", async () => withBotsDisabled(async () => {
  let progressionReads = 0;
  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("from public.poker_tables")) return [{ id: "t-rejoin-low-bankroll", status: "OPEN", max_players: 6, buy_in: 500 }];
        if (text.includes("from public.chips_accounts")) {
          progressionReads += 1;
          return [{ balance: 0 }];
        }
        if (text.includes("from public.poker_seats") && text.includes("seat_no, stack")) return [{ seat_no: 1, stack: 500 }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) {
          return [{ user_id: "u-rejoin-low-bankroll", seat_no: 1, status: "ACTIVE", stack: 500, is_bot: false, bot_profile: null, leave_after_hand: false }];
        }
        if (text.includes("select version, state from public.poker_state")) {
          return [{ version: 1, state: { tableId: "t-rejoin-low-bankroll", seats: [{ userId: "u-rejoin-low-bankroll", seatNo: 1, status: "ACTIVE" }], stacks: { "u-rejoin-low-bankroll": 500 } } }];
        }
        return [];
      }
    }),
    tableId: "t-rejoin-low-bankroll",
    userId: "u-rejoin-low-bankroll",
    requestId: "rejoin-low-bankroll",
    buyIn: 500,
    progressionBalance: 0,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 500);
  assert.equal(progressionReads, 0);
}));

test("active rejoin succeeds when its buy-in is absent from the current catalog", async () => withBotsDisabled(async () => {
  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("from public.poker_tables")) return [{ id: "t-rejoin-config-drift", status: "OPEN", max_players: 6, buy_in: 500 }];
        if (text.includes("from public.poker_seats") && text.includes("seat_no, stack")) return [{ seat_no: 1, stack: 500 }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) {
          return [{ user_id: "u-rejoin-config-drift", seat_no: 1, status: "ACTIVE", stack: 500, is_bot: false, bot_profile: null, leave_after_hand: false }];
        }
        if (text.includes("select version, state from public.poker_state")) {
          return [{ version: 1, state: { tableId: "t-rejoin-config-drift", seats: [{ userId: "u-rejoin-config-drift", seatNo: 1, status: "ACTIVE" }], stacks: { "u-rejoin-config-drift": 500 } } }];
        }
        return [];
      }
    }),
    tableId: "t-rejoin-config-drift",
    userId: "u-rejoin-config-drift",
    requestId: "rejoin-config-drift",
    buyIn: 500,
    progressionBalance: 0,
    progressionEnv: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) },
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 500);
}));

test("fresh join rejects a table whose persisted stakes do not match its buy-in", async () => withBotsDisabled(async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative(withStorageValidator({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          const text = String(sql);
          if (text.includes("from public.poker_tables")) {
            return [{ id: "t-noncanonical-economy", status: "OPEN", max_players: 6, buy_in: 500, stakes: { sb: 1, bb: 2 } }];
          }
          if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) return [];
          if (text.includes("select version, state from public.poker_state")) {
            return [{ version: 1, state: { tableId: "t-noncanonical-economy", seats: [], stacks: {} } }];
          }
          return [];
        }
      }),
      tableId: "t-noncanonical-economy",
      userId: "u-noncanonical-economy",
      requestId: "join-noncanonical-economy",
      buyIn: 500,
      progressionBalance: 550,
      postTransactionFn: async () => { throw new Error("ledger must not run"); }
    })),
    (error) => error?.code === "invalid_buy_in"
  );
}));

test("active rejoin remains allowed for a table whose persisted stakes drifted", async () => withBotsDisabled(async () => {
  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        const text = String(sql);
        if (text.includes("from public.poker_tables")) {
          return [{ id: "t-rejoin-noncanonical-economy", status: "OPEN", max_players: 6, buy_in: 500, stakes: { sb: 1, bb: 2 } }];
        }
        if (text.includes("from public.poker_seats") && text.includes("seat_no, stack")) return [{ seat_no: 1, stack: 500 }];
        if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) {
          return [{ user_id: "u-rejoin-noncanonical-economy", seat_no: 1, status: "ACTIVE", stack: 500, is_bot: false, bot_profile: null, leave_after_hand: false }];
        }
        if (text.includes("select version, state from public.poker_state")) {
          return [{ version: 1, state: { tableId: "t-rejoin-noncanonical-economy", seats: [{ userId: "u-rejoin-noncanonical-economy", seatNo: 1, status: "ACTIVE" }], stacks: { "u-rejoin-noncanonical-economy": 500 } } }];
        }
        return [];
      }
    }),
    tableId: "t-rejoin-noncanonical-economy",
    userId: "u-rejoin-noncanonical-economy",
    requestId: "rejoin-noncanonical-economy",
    buyIn: 500,
    progressionBalance: 0,
    progressionEnv: { POKER_BUY_IN_TIERS_JSON: JSON.stringify([100]) },
    postTransactionFn: async () => { throw new Error("rejoin must not debit"); }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 500);
}));

test("rejects malformed stringified state with state_invalid", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("status = 'ACTIVE'")) return [];
          if (sql.includes("insert into public.poker_seats")) return [{ seat_no: 1 }];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: "{bad" }];
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r1",
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true })
    })),
    (error) => error?.code === "state_invalid"
  );
});

for (const phase of ["FLOP", "SETTLED"]) test(`fresh funded ${phase} join preserves stacks and waits for the next hand`, async () => withBotsDisabled(async () => {
  const seatRows = [
    { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 98, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "bot_1", seat_no: 2, status: "ACTIVE", stack: 100, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false },
    { user_id: "bot_2", seat_no: 3, status: "ACTIVE", stack: 100, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false }
  ];
  const stateRow = {
    version: 5,
    state: {
      tableId: "t-live",
      phase,
      handId: "hand_live_join",
      handSeats: [
        { userId: "human_1", seatNo: 1 },
        { userId: "bot_1", seatNo: 2, isBot: true },
        { userId: "bot_2", seatNo: 3, isBot: true }
      ],
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
        { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
      ],
      stacks: { human_1: 98, bot_1: 120, bot_2: 84 },
      community: ["AS", "KS", "QS"],
      communityDealt: 3,
      dealerSeatNo: 1,
      turnUserId: "bot_1",
      toCallByUserId: { human_1: 0, bot_1: 0, bot_2: 0 },
      betThisRoundByUserId: { human_1: 0, bot_1: 0, bot_2: 0 },
      actedThisRoundByUserId: { human_1: true, bot_1: false, bot_2: false },
      foldedByUserId: { human_1: false, bot_1: false, bot_2: false },
      lastBettingRoundActionByUserId: { human_1: "check", bot_1: null, bot_2: null },
      contributionsByUserId: { human_1: 2, bot_1: 2, bot_2: 2 },
      leftTableByUserId: {},
      sitOutByUserId: {},
      pendingAutoSitOutByUserId: {},
      sidePots: []
    }
  };

  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t-live", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2") && !sql.includes("seat_no, stack")) return [];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc;")) {
          return seatRows.map((seat) => ({ seat_no: seat.seat_no }));
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [stateRow];
        if (sql.includes("update public.poker_state set state")) {
          stateRow.state = params[1];
          stateRow.version += 1;
          return [{ version: stateRow.version }];
        }
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        return [];
      }
    }),
    tableId: "t-live",
    userId: "human_2",
    requestId: "join-live-2",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.equal(result.stack, 100);
  assert.equal(result.snapshot.stateVersion, 6);
  assert.equal(result.snapshot.seats.length, 4);
  assert.equal(result.snapshot.stacks.human_2, 100);
  assert.equal(result.snapshot.stacks.bot_1, 120);
  assert.equal(result.snapshot.stacks.bot_2, 84);
  assert.equal(result.joinStatus, "WAITING_NEXT_HAND");
  assert.equal(seatRows.find(seat => seat.user_id === "human_2").status, "ACTIVE");
  assert.equal(stateRow.state.waitingForNextHandByUserId.human_2, true);
  assert.deepEqual(stateRow.state.handSeats.map((seat) => seat.userId), ["human_1", "bot_1", "bot_2"]);
  assert.equal(stateRow.state.stacks.bot_1, 120);
  assert.equal(stateRow.state.stacks.bot_2, 84);
  assert.deepEqual(stateRow.state.community, ["AS", "KS", "QS"]);
}));

test("allows second human join when legacy persisted private cards leaked into storage", async () => withBotsDisabled(async () => {
  const seatRows = [
    { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 98, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "bot_1", seat_no: 2, status: "ACTIVE", stack: 101, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false },
    { user_id: "bot_2", seat_no: 3, status: "ACTIVE", stack: 101, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false }
  ];
  const stateRow = {
    version: 5,
    state: {
      tableId: "t-live-private",
      phase: "RIVER",
      handId: "hand_live_private_join",
      handSeed: "seed_live_private_join",
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
        { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
      ],
      stacks: { human_1: 98, bot_1: 101, bot_2: 101 },
      community: ["AS", "KS", "QS", "JD", "TC"],
      holeCardsByUserId: {
        human_1: ["2C", "2D"],
        bot_1: ["3C", "3D"],
        bot_2: ["4C", "4D"]
      },
      deck: ["5C"],
      communityDealt: 5,
      dealerSeatNo: 1,
      turnUserId: "bot_1",
      toCallByUserId: { human_1: 0, bot_1: 0, bot_2: 0 },
      betThisRoundByUserId: { human_1: 0, bot_1: 0, bot_2: 0 },
      actedThisRoundByUserId: { human_1: true, bot_1: false, bot_2: false },
      foldedByUserId: { human_1: false, bot_1: false, bot_2: false },
      lastBettingRoundActionByUserId: { human_1: "check", bot_1: null, bot_2: null },
      contributionsByUserId: { human_1: 2, bot_1: 2, bot_2: 2 },
      leftTableByUserId: {},
      sitOutByUserId: {},
      pendingAutoSitOutByUserId: {},
      sidePots: []
    }
  };

  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t-live-private", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2") && !sql.includes("seat_no, stack")) return [];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc;")) {
          return seatRows.map((seat) => ({ seat_no: seat.seat_no }));
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [stateRow];
        if (sql.includes("update public.poker_state set state")) {
          stateRow.state = params[1];
          stateRow.version += 1;
          return [{ version: stateRow.version }];
        }
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        return [];
      }
    }),
    tableId: "t-live-private",
    userId: "human_2",
    requestId: "join-live-private-2",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.equal(result.stack, 100);
  assert.equal(result.snapshot.stateVersion, 6);
  assert.equal(result.snapshot.seats.length, 4);
  assert.equal(result.snapshot.stacks.human_2, 100);
  assert.equal(Object.prototype.hasOwnProperty.call(stateRow.state, "holeCardsByUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stateRow.state, "deck"), false);
  assert.deepEqual(stateRow.state.community, ["AS", "KS", "QS", "JD", "TC"]);
}));

test("returns canonical db seat number and authoritative stack on rejoin", async () => {
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("seat_no, stack")) return [{ seat_no: 4, stack: 330 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return [{ user_id: "u1", seat_no: 4, status: "ACTIVE", stack: 330, is_bot: false, bot_profile: null, leave_after_hand: false }];
        }
        if (sql.includes("select version, state from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId: "t1",
              phase: "SETTLED",
              handSeats: [{ userId: "u1", seatNo: 4 }],
              seats: [{ userId: "u1", seatNo: 4, status: "ACTIVE" }],
              stacks: { u1: 330 }
            }
          }];
        }
        if (sql.includes("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u1",
    requestId: "r2",
    buyIn: 120,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.equal(result.rejoin, true);
  assert.equal(result.stack, 330);
  assert.equal(result.joinStatus, "ACTIVE");
});

test("rejoin projects stale state-only seats out of the authoritative snapshot", async () => {
  const store = {
    table: { id: "t-poison-rejoin", status: "OPEN", max_players: 4, stakes: '{"sb":1,"bb":2}' },
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", stack: 100, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false },
      { user_id: "bot_2", seat_no: 3, status: "ACTIVE", stack: 100, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false }
    ],
    stateRow: {
      version: 8,
      state: {
        tableId: "t-poison-rejoin",
        seats: [
          { userId: "human_1", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
          { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
          { userId: "ghost_human", seatNo: 4, status: "ACTIVE" }
        ],
        stacks: { human_1: 100, bot_1: 200, bot_2: 200, ghost_human: 100 },
      }
    }
  };

  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [store.table];
        if (sql.includes("from public.poker_seats") && sql.includes("seat_no, stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return store.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (sql.includes("update public.poker_seats set status = 'ACTIVE', last_seen_at = now()")) return [];
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        return [];
      }
    }),
    tableId: "t-poison-rejoin",
    userId: "human_1",
    requestId: "join-poison-rejoin",
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, true);
  assert.equal(result.snapshot.stateVersion, 8);
  assert.deepEqual(result.snapshot.seats.map((seat) => seat.userId), ["human_1", "bot_1", "bot_2"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot.stacks, "ghost_human"), false);
});

test("rejoin does not zero stale active seat rows while projecting them out of the snapshot", async () => {
  const store = {
    table: { id: "t-poison-no-seat-row-mutation", status: "OPEN", max_players: 4, stakes: '{"sb":1,"bb":2}' },
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
      { user_id: "stale_human", seat_no: 99, status: "ACTIVE", stack: 250, is_bot: false, bot_profile: null, leave_after_hand: false }
    ],
    stateRow: {
      version: 8,
      state: {
        tableId: "t-poison-no-seat-row-mutation",
        seats: [{ userId: "human_1", seatNo: 1, status: "ACTIVE" }],
        stacks: { human_1: 100 }
      }
    },
    inactiveZeroUpdates: 0
  };

  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [store.table];
        if (sql.includes("from public.poker_seats") && sql.includes("seat_no, stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return store.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (sql.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          return [{ version: store.stateRow.version }];
        }
        if (sql.includes("update public.poker_seats set status = 'INACTIVE', stack = 0")) {
          store.inactiveZeroUpdates += 1;
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && Number(seat.seat_no) === Number(params[2]));
          if (row) {
            row.status = "INACTIVE";
            row.stack = 0;
          }
          return [];
        }
        if (sql.includes("update public.poker_seats set status = 'ACTIVE', last_seen_at = now()")) return [];
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        return [];
      }
    }),
    tableId: "t-poison-no-seat-row-mutation",
    userId: "human_1",
    requestId: "join-poison-no-seat-row-mutation",
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, true);
  assert.equal(store.inactiveZeroUpdates, 0);
  assert.equal(store.seatRows.find((seat) => seat.user_id === "stale_human").stack, 250);
  assert.deepEqual(result.snapshot.seats.map((seat) => seat.userId), ["human_1"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot.stacks, "stale_human"), false);
});

test("new join replaces stale state-only seat occupants that conflict with the inserted seat", async () => {
  const store = {
    table: { id: "t-poison-new-join", status: "OPEN", max_players: 4, stakes: '{"sb":1,"bb":2}' },
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", stack: 200, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false },
      { user_id: "bot_2", seat_no: 3, status: "ACTIVE", stack: 200, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false }
    ],
    stateRow: {
      version: 5,
      state: {
        tableId: "t-poison-new-join",
        seats: [
          { userId: "human_1", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
          { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
          { userId: "ghost_human", seatNo: 4, status: "ACTIVE" }
        ],
        stacks: { human_1: 100, bot_1: 200, bot_2: 200, ghost_human: 100 },
      }
    }
  };

  const result = await executePokerJoinAuthoritative(withStorageValidator({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [store.table];
        if (sql.includes("from public.poker_seats") && sql.includes("seat_no, stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return store.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          store.seatRows.push({
            user_id: params[1],
            seat_no: params[2],
            status: "ACTIVE",
            stack: 0,
            is_bot: false,
            bot_profile: null,
            leave_after_hand: false
          });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [];
        }
        if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (sql.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          return [{ version: store.stateRow.version }];
        }
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        return [];
      }
    }),
    tableId: "t-poison-new-join",
    userId: "human_2",
    requestId: "join-poison-new",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 100,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, false);
  assert.equal(result.seatNo, 4);
  assert.equal(result.snapshot.stateVersion, 6);
  assert.deepEqual(result.snapshot.seats.map((seat) => seat.userId), ["human_1", "bot_1", "bot_2", "human_2"]);
  assert.equal(result.snapshot.stacks.human_2, 100);
  assert.equal(result.snapshot.stacks.human_1, 100);
  assert.equal(result.snapshot.stacks.bot_1, 200);
  assert.equal(result.snapshot.stacks.bot_2, 200);
  assert.deepEqual(store.stateRow.state.stacks, { human_1: 100, bot_1: 200, bot_2: 200, human_2: 100 });
  assert.deepEqual(store.stateRow.state.seats.map((seat) => seat.userId), ["human_1", "bot_1", "bot_2", "human_2"]);
  assert.equal(Object.prototype.hasOwnProperty.call(store.stateRow.state.stacks, "ghost_human"), false);
});

test("maps unique insert conflicts to seat_taken", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
          if (sql.includes("insert into public.poker_seats")) {
            const err = new Error("duplicate key");
            err.code = "23505";
            err.constraint = "poker_seats_table_id_seat_no_key";
            throw err;
          }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r3",
      seatNo: 2,
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true })
    })),
    (error) => error?.code === "seat_taken"
  );
});

test("authoritative join rejects when financial mutation fails", async () => {
  const writes = [];
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
          if (sql.includes("insert into public.poker_seats")) return [{ seat_no: 1 }];
          if (sql.includes("update public.poker_state set state")) { writes.push(params[1]); return [{ ok: true }]; }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r4",
      buyIn: 200,
      postTransactionFn: async () => {
        const err = new Error("insufficient_funds");
        err.code = "insufficient_funds";
        throw err;
      }
    })),
    (error) => error?.code === "insufficient_funds"
  );
  assert.equal(writes.length, 0);
});

test("authoritative join funds stack only after financial mutation succeeds", async () => withBotsDisabled(async () => {
  const sequence = [];
  const seatRows = [{ user_id: "u-existing", seat_no: 1, status: "ACTIVE", stack: 50, is_bot: false, bot_profile: null, leave_after_hand: false }];
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          sequence.push('insert_seat');
          seatRows.push({ user_id: params[1], seat_no: params[2], status: 'ACTIVE', stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: 3 }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          sequence.push('update_stack');
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId: "t1",
              seats: [{ userId: "u-existing", seatNo: 1, status: "ACTIVE" }],
              stacks: { "u-existing": 50 }
            }
          }];
        }
        if (sql.includes("update public.poker_state set state")) { sequence.push('update_state'); return [{ version: 2 }]; }
        return [];
      }
    }),
    tableId: "t1",
    userId: "u1",
    requestId: "r5",
    seatNo: 3,
    buyIn: 250,
    postTransactionFn: async () => { sequence.push('ledger_buyin'); return { ok: true }; }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.stack, 250);
  assert.deepEqual(sequence, ['insert_seat', 'ledger_buyin', 'update_stack', 'update_state']);
}));

test("authoritative auto-seat respects preferred seat and initializes stack from buyIn", async () => withBotsDisabled(async () => {
  const writes = [];
  const seatRows = [
    { user_id: "u-seat-1", seat_no: 1, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-seat-2", seat_no: 2, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-seat-5", seat_no: 5, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false }
  ];
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) return seatRows.map((seat) => ({ ...seat }));
        if (sql.includes("insert into public.poker_seats")) {
          seatRows.push({ user_id: params[1], seat_no: params[2], status: 'ACTIVE', stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId: "t1",
              seats: [
                { userId: "u-seat-1", seatNo: 1, status: "ACTIVE" },
                { userId: "u-seat-2", seatNo: 2, status: "ACTIVE" },
                { userId: "u-seat-5", seatNo: 5, status: "ACTIVE" }
              ],
              stacks: { "u-seat-1": 100, "u-seat-2": 100, "u-seat-5": 100 }
            }
          }];
        }
        if (sql.includes("update public.poker_state set state")) { writes.push(params[1]); return [{ version: 2 }]; }
        return [];
      }
    }),
    tableId: "t1",
    userId: "u2",
    requestId: "r7",
    autoSeat: true,
    preferredSeatNo: 2,
    buyIn: 200,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 3);
  assert.equal(result.stack, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].stacks.u2, 200);
}));

test("authoritative auto-seat retries past stale seat conflicts and uses the next free seat", async () => withBotsDisabled(async () => {
  const seatRows = [
    { user_id: "u-seat-2", seat_no: 2, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-seat-3", seat_no: 3, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false }
  ];
  const selectedSeats = [];
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) return seatRows.map((seat) => ({ ...seat }));
        if (sql.includes("insert into public.poker_seats")) {
          selectedSeats.push(params[2]);
          if (params[2] === 1) {
            const err = new Error("duplicate key");
            err.code = "23505";
            err.constraint = "poker_seats_table_id_seat_no_key";
            throw err;
          }
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId: "t1",
              seats: [
                { userId: "u-seat-2", seatNo: 2, status: "ACTIVE" },
                { userId: "u-seat-3", seatNo: 3, status: "ACTIVE" }
              ],
              stacks: { "u-seat-2": 100, "u-seat-3": 100 }
            }
          }];
        }
        if (sql.includes("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u4",
    requestId: "r7-retry",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 200,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.deepEqual(selectedSeats, [1, 4]);
}));

test("authoritative auto-seat retries when insert is skipped by unique conflict without aborting the transaction", async () => withBotsDisabled(async () => {
  const seatRows = [
    { user_id: "u-seat-2", seat_no: 2, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-seat-3", seat_no: 3, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false }
  ];
  const selectedSeats = [];
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) return seatRows.map((seat) => ({ ...seat }));
        if (sql.includes("insert into public.poker_seats")) {
          selectedSeats.push(params[2]);
          if (params[2] === 1) {
            return [];
          }
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId: "t1",
              seats: [
                { userId: "u-seat-2", seatNo: 2, status: "ACTIVE" },
                { userId: "u-seat-3", seatNo: 3, status: "ACTIVE" }
              ],
              stacks: { "u-seat-2": 100, "u-seat-3": 100 }
            }
          }];
        }
        if (sql.includes("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u5",
    requestId: "r7-retry-noabort",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 200,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.deepEqual(selectedSeats, [1, 4]);
}));

test("authoritative auto-seat reclaims inactive seat blockers before reporting table_full", async () => withBotsDisabled(async () => {
  const seatRows = [
    { user_id: "u-seat-1", seat_no: 1, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-seat-2", seat_no: 2, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-seat-3", seat_no: 3, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-stale-4", seat_no: 4, status: "INACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-stale-5", seat_no: 5, status: "INACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "u-stale-6", seat_no: 6, status: "INACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false }
  ];
  const selectedSeats = [];
  const deletedSeats = [];

  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) return seatRows.map((seat) => ({ ...seat }));
        if (sql.includes("delete from public.poker_seats") && sql.includes("user_id = $2")) return [];
        if (sql.includes("delete from public.poker_seats") && sql.includes("seat_no = $2")) {
          const deleted = seatRows.filter((seat) => seat.seat_no === params[1] && String(seat.status || "ACTIVE").toUpperCase() !== "ACTIVE" && Number(seat.stack || 0) === 0);
          if (deleted.length > 0) {
            deletedSeats.push(...deleted.map((seat) => seat.seat_no));
          }
          for (let i = seatRows.length - 1; i >= 0; i -= 1) {
            const seat = seatRows[i];
            if (seat.seat_no === params[1] && String(seat.status || "ACTIVE").toUpperCase() !== "ACTIVE" && Number(seat.stack || 0) === 0) {
              seatRows.splice(i, 1);
            }
          }
          return deleted.map((seat) => ({ user_id: seat.user_id }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          selectedSeats.push(params[2]);
          const conflict = seatRows.some((seat) => seat.seat_no === params[2] || seat.user_id === params[1]);
          if (conflict) return [];
          seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId: "t1",
              seats: [
                { userId: "u-seat-1", seatNo: 1, status: "ACTIVE" },
                { userId: "u-seat-2", seatNo: 2, status: "ACTIVE" },
                { userId: "u-seat-3", seatNo: 3, status: "ACTIVE" }
              ],
              stacks: { "u-seat-1": 100, "u-seat-2": 100, "u-seat-3": 100 }
            }
          }];
        }
        if (sql.includes("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u-new",
    requestId: "r-inactive-reclaim",
    autoSeat: true,
    preferredSeatNo: 4,
    buyIn: 200,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.deepEqual(selectedSeats, [4, 4]);
  assert.deepEqual(deletedSeats, [4]);
}));


test("rejoin with missing authoritative stack fails closed and does not write state", async () => {
  const writes = { state: 0 };
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc")) return [{ user_id: "u1", seat_no: 4, status: "ACTIVE", stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false }];
          if (sql.includes("seat_no, stack")) return [{ seat_no: 4, stack: 0 }];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
          if (sql.includes("update public.poker_state set state")) { writes.state += 1; return [{ ok: true }]; }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u1",
      requestId: "r8",
      buyIn: 999,
      postTransactionFn: async () => ({ ok: true })
    })),
    (error) => error?.code === "authoritative_state_invalid"
      && error?.validationReason === "active_seat_authoritative_stack_missing"
  );
  assert.equal(writes.state, 0);
});

test("duplicate buyin idempotency without funded persisted stack fails closed", async () => {
  const writes = { state: 0, seatStackUpdate: 0 };
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("insert into public.poker_seats")) return [{ seat_no: 2 }];
          if (sql.includes("seat_no, stack")) return [{ seat_no: 2, stack: 0 }];
          if (sql.includes("update public.poker_seats set stack")) { writes.seatStackUpdate += 1; return [{ ok: true }]; }
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
          if (sql.includes("update public.poker_state set state")) { writes.state += 1; return [{ ok: true }]; }
          return [];
        }
      }),
      tableId: "t1",
      userId: "u3",
      requestId: "r9",
      seatNo: 2,
      buyIn: 150,
      postTransactionFn: async () => {
        const err = new Error("duplicate idempotency");
        err.code = "23505";
        err.constraint = "chips_transactions_idempotency_key_unique";
        throw err;
      }
    })),
    (error) => error?.code === "state_invalid"
  );
  assert.equal(writes.seatStackUpdate, 0);
  assert.equal(writes.state, 0);
});

test("authoritative join rejects explicit and preferred seat numbers below 1", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
          return [];
        }
      }),
      tableId: "t1",
      userId: "u3",
      requestId: "r10",
      seatNo: 0,
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true })
    })),
    (error) => error?.code === "invalid_seat_no"
  );

  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
          return [];
        }
      }),
      tableId: "t1",
      userId: "u3",
      requestId: "r11",
      autoSeat: true,
      preferredSeatNo: 0,
      buyIn: 100,
      postTransactionFn: async () => ({ ok: true })
    })),
    (error) => error?.code === "invalid_seat_no"
  );
});

test("pre-migration first human JOIN preserves historical 100 CH funding provenance", async () => withBotEnv(async () => {
  process.env.POKER_BOTS_MAX_PER_TABLE = "5";
  const originalRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls += 1;
    return randomCalls === 1 ? 0 : 0.999999;
  };
  const store = {
    table: { id: "t-bots", status: "OPEN", max_players: 6, buy_in: 100, stakes: '{"sb":1,"bb":2}' },
    seatRows: [],
    stateRow: { version: 3, state: { tableId: "t-bots", seats: [], stacks: {} } },
    ledgerCalls: []
  };

  try {
    const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [store.table];
        if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          if (sql.includes("status = 'ACTIVE'")) {
            return store.seatRows.filter((seat) => String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE").map((seat) => ({ seat_no: seat.seat_no }));
          }
          return store.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          const isBot = sql.includes("is_bot");
          store.seatRows.push({
            user_id: params[1],
            seat_no: params[2],
            status: "ACTIVE",
            is_bot: isBot,
            bot_profile: isBot ? params[3] : null,
            leave_after_hand: false,
            stack: isBot ? params[4] : 0
          });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (sql.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          return [{ version: store.stateRow.version }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [];
        }
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        if (sql.includes("delete from public.poker_seats")) {
          store.seatRows = store.seatRows.filter((seat) => !(seat.user_id === params[1] && seat.seat_no === params[2]));
          return [];
        }
        return [];
      }
    }),
    tableId: "t-bots",
    userId: "human_1",
    requestId: "join-bots-1",
    seatNo: 1,
    buyIn: 100,
    postTransactionFn: async (payload) => {
      store.ledgerCalls.push(payload);
      return { ok: true };
    }
  }));

    assert.equal(result.ok, true);
    assert.equal(result.seededBots.length, 2);
    assert.equal(result.snapshot.seats.length, 3);
    assert.deepEqual(result.snapshot.seats.map((seat) => seat.seatNo), [1, 2, 3]);
    assert.deepEqual(result.snapshot.seats.filter((seat) => seat.isBot).map((seat) => ({ seatNo: seat.seatNo, botProfile: seat.botProfile, leaveAfterHand: seat.leaveAfterHand === true })), [
      { seatNo: 2, botProfile: "NORMAL", leaveAfterHand: false },
      { seatNo: 3, botProfile: "NORMAL", leaveAfterHand: false }
    ]);
    assert.equal(result.snapshot.stacks.human_1, 100);
    assert.deepEqual(Object.values(result.snapshot.stacks), [100, 100, 100]);
    assert.equal(result.snapshot.stateVersion, 4);
    assert.equal(store.stateRow.version, 4);
    assert.equal(store.seatRows.filter((seat) => seat.is_bot).length, 2);
    assert.equal(store.ledgerCalls.length, 3);
    assert.equal(store.ledgerCalls.every((call) => call.entries.some((entry) => entry.accountType === "ESCROW" && entry.amount === 100)), true);
    assert.equal(store.ledgerCalls.filter((call) => call.entries.some((entry) => entry.accountType === "USER" && entry.amount === -100)).length, 1);
    assert.equal(store.ledgerCalls.filter((call) => call.entries.some((entry) => entry.accountType === "SYSTEM" && entry.amount === -100)).length, 2);
    assert.equal(randomCalls, 1);
  } finally {
    Math.random = originalRandom;
  }
}));

test("first human authoritative join on the 500 CH tier seeds bots from the bounded bankroll", async () => withBotEnv(async () => {
  process.env.POKER_BOTS_MAX_PER_TABLE = "5";
  const originalRandom = Math.random;
  Math.random = () => 0;
  const store = {
    table: { id: "t-bounded-bots", status: "OPEN", max_players: 6, buy_in: 500, stakes: '{"sb":5,"bb":10}' },
    seatRows: [],
    stateRow: { version: 3, state: { tableId: "t-bounded-bots", seats: [], stacks: {} } },
    ledgerCalls: []
  };

  try {
    const result = await executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params = []) => {
          if (sql.includes("from public.poker_tables")) return [store.table];
          if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
            const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
            return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
          }
          if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
            if (sql.includes("status = 'ACTIVE'")) {
              return store.seatRows.filter((seat) => String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE").map((seat) => ({ seat_no: seat.seat_no }));
            }
            return store.seatRows.map((seat) => ({ ...seat }));
          }
          if (sql.includes("insert into public.poker_seats")) {
            const isBot = sql.includes("is_bot");
            store.seatRows.push({
              user_id: params[1],
              seat_no: params[2],
              status: "ACTIVE",
              is_bot: isBot,
              bot_profile: isBot ? params[3] : null,
              leave_after_hand: false,
              stack: isBot ? params[4] : 0
            });
            return [{ seat_no: params[2] }];
          }
          if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
          if (sql.includes("update public.poker_state set state")) {
            store.stateRow.state = params[1];
            store.stateRow.version += 1;
            return [{ version: store.stateRow.version }];
          }
          if (sql.includes("update public.poker_seats set stack")) {
            const row = store.seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
            if (row) row.stack = params[3];
            return [];
          }
          if (sql.includes("update public.poker_tables set last_activity_at")) return [];
          return [];
        }
      }),
      tableId: "t-bounded-bots",
      userId: "human_1",
      requestId: "join-bounded-bots",
      seatNo: 1,
      buyIn: 500,
      postTransactionFn: async (payload) => {
        store.ledgerCalls.push(payload);
        return { ok: true };
      }
    }));

    assert.equal(result.ok, true);
    assert.equal(result.seededBots.length, 2);
    assert.equal(result.snapshot.seats.length, 3);
    assert.equal(store.seatRows.filter((seat) => seat.is_bot).length, 2);
    assert.equal(store.ledgerCalls.length, 3);
    assert.equal(store.ledgerCalls.filter((call) => call.entries.some((entry) => entry.accountType === "SYSTEM" && entry.systemKey === "POKER_BOT_BANKROLL" && entry.amount === -500)).length, 2);
    assert.equal(store.ledgerCalls.some((call) => call.entries.some((entry) => entry.accountType === "SYSTEM" && entry.systemKey === "TREASURY")), false);
  } finally {
    Math.random = originalRandom;
  }
}));

test("500 CH join remains successful with partial bot seed when bounded bankroll is exhausted", async () => withBotEnv(async () => {
  process.env.POKER_BOTS_MAX_PER_TABLE = "5";
  const store = {
    table: { id: "t-bounded-exhausted", status: "OPEN", max_players: 6, buy_in: 500, stakes: '{"sb":5,"bb":10}' },
    seatRows: [],
    stateRow: { version: 3, state: { tableId: "t-bounded-exhausted", seats: [], stacks: {} } },
    ledgerCalls: []
  };

  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [store.table];
        if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          if (sql.includes("status = 'ACTIVE'")) return store.seatRows.filter((seat) => seat.status === "ACTIVE").map((seat) => ({ seat_no: seat.seat_no }));
          return store.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          const isBot = sql.includes("is_bot");
          store.seatRows.push({ user_id: params[1], seat_no: params[2], status: "ACTIVE", is_bot: isBot, bot_profile: isBot ? params[3] : null, leave_after_hand: false, stack: isBot ? params[4] : 0 });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (sql.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          return [{ version: store.stateRow.version }];
        }
        if (sql.includes("update public.poker_seats set stack")) return [];
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        if (sql.includes("delete from public.poker_seats")) {
          store.seatRows = store.seatRows.filter((seat) => !(seat.user_id === params[1] && seat.seat_no === params[2]));
          return [];
        }
        return [];
      }
    }),
    tableId: "t-bounded-exhausted",
    userId: "human_1",
    requestId: "join-bounded-exhausted",
    seatNo: 1,
    buyIn: 500,
    postTransactionFn: async (payload) => {
      store.ledgerCalls.push(payload);
      if (payload.entries.some((entry) => entry.accountType === "SYSTEM")) {
        const error = new Error("insufficient_funds");
        error.code = "insufficient_funds";
        throw error;
      }
      return { ok: true };
    }
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.seededBots, []);
  assert.equal(result.snapshot.seats.length, 1);
  assert.equal(store.seatRows.filter((seat) => seat.is_bot).length, 0);
  assert.equal(store.ledgerCalls.length, 2);
  assert.equal(store.ledgerCalls.filter((call) => call.entries.some((entry) => entry.accountType === "SYSTEM")).length, 1);
}));

test("same-request authoritative join replay becomes rejoin without duplicate seat, stack, or buy-in", async () => withBotEnv(async () => {
  const state = {
    table: { id: "t-bots-replay", status: "OPEN", max_players: 6, stakes: '{"sb":1,"bb":2}' },
    seatRows: [
      { user_id: "existing_bot", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false, stack: 999 }
    ],
    stateRow: {
      version: 4,
      state: {
        tableId: "t-bots-replay",
        seats: [{ userId: "existing_bot", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }],
        stacks: { existing_bot: 200 }
      }
    },
    ledgerCalls: []
  };

  const runJoin = (requestId) => executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [state.table];
        if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
          const row = state.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          if (sql.includes("status = 'ACTIVE'")) {
            return state.seatRows.filter((seat) => String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE").map((seat) => ({ seat_no: seat.seat_no }));
          }
          return state.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          const isBot = sql.includes("is_bot");
          const row = {
            user_id: params[1],
            seat_no: params[2],
            status: "ACTIVE",
            is_bot: isBot,
            bot_profile: isBot ? params[3] : null,
            leave_after_hand: false,
            stack: isBot ? params[4] : 0
          };
          state.seatRows.push(row);
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [state.stateRow];
        if (sql.includes("update public.poker_state set state")) {
          state.stateRow.state = params[1];
          state.stateRow.version += 1;
          return [{ version: state.stateRow.version }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = state.seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [];
        }
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        if (sql.includes("delete from public.poker_seats")) return [];
        return [];
      }
    }),
    tableId: "t-bots-replay",
    userId: "human_replay",
    requestId,
    seatNo: 1,
    buyIn: 100,
    postTransactionFn: async (payload) => {
      state.ledgerCalls.push(payload);
      return { ok: true };
    }
  }));

  const first = await runJoin("join-replay-same-request");
  assert.equal(first.seededBots.length, 1);
  assert.equal(first.snapshot.seats.filter((seat) => seat.isBot).length, 2);
  assert.equal(first.snapshot.stateVersion, 5);
  assert.equal(first.snapshot.stacks.existing_bot, 200);
  assert.equal(state.stateRow.state.stacks.existing_bot, 200);
  assert.equal(first.snapshot.stacks[first.seededBots[0].userId], first.seededBots[0].stack);
  assert.equal(state.stateRow.state.stacks[first.seededBots[0].userId], first.seededBots[0].stack);

  const second = await runJoin("join-replay-same-request");
  assert.equal(second.rejoin, true);
  assert.equal(second.seatNo, first.seatNo);
  assert.equal(second.joinStatus, "ACTIVE");
  assert.equal(second.snapshot.seats.filter((seat) => seat.isBot).length, 2);
  assert.equal(second.snapshot.stacks.existing_bot, 200);
  assert.equal(state.seatRows.filter((seat) => seat.user_id === "human_replay").length, 1);
  assert.equal(state.stateRow.state.stacks.human_replay, 100);
  assert.equal(state.seatRows.filter((seat) => seat.is_bot).length, 2);
  assert.equal(state.ledgerCalls.filter((payload) => payload.txType === "TABLE_BUY_IN").length, 2);
}));

test("fresh authoritative join starting from version 0 returns the persisted post-mutation version", async () => withBotEnv(async () => {
  const store = {
    table: { id: "t-fresh-version", status: "OPEN", max_players: 6, stakes: '{"sb":1,"bb":3}' },
    seatRows: [],
    stateRow: { version: 0, state: { tableId: "t-fresh-version", seats: [], stacks: {}, phase: "INIT", pot: 0 } },
    updateVersions: []
  };

  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params = []) => {
        if (sql.includes("from public.poker_tables")) return [store.table];
        if (sql.includes("from public.poker_seats") && sql.includes("user_id = $2") && sql.includes("limit 1")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE");
          return row ? [{ seat_no: row.seat_no, stack: row.stack }] : [];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          if (sql.includes("status = 'ACTIVE'")) {
            return store.seatRows.filter((seat) => String(seat.status || "ACTIVE").toUpperCase() === "ACTIVE").map((seat) => ({ seat_no: seat.seat_no }));
          }
          return store.seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          const isBot = sql.includes("is_bot");
          store.seatRows.push({
            user_id: params[1],
            seat_no: params[2],
            status: "ACTIVE",
            is_bot: isBot,
            bot_profile: isBot ? params[3] : null,
            leave_after_hand: false,
            stack: isBot ? params[4] : 0
          });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          const row = store.seatRows.find((seat) => seat.user_id === params[1] && seat.seat_no === params[2]);
          if (row) row.stack = params[3];
          return [];
        }
        if (sql.includes("select version, state from public.poker_state")) return [store.stateRow];
        if (sql.includes("update public.poker_state set state")) {
          store.stateRow.state = params[1];
          store.stateRow.version += 1;
          store.updateVersions.push(store.stateRow.version);
          return [{ version: store.stateRow.version }];
        }
        if (sql.includes("update public.poker_tables set last_activity_at")) return [];
        if (sql.includes("delete from public.poker_seats")) return [];
        return [];
      }
    }),
    tableId: "t-fresh-version",
    userId: "fresh_human",
    requestId: "fresh-version-join",
    seatNo: 1,
    buyIn: 150,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.stateVersion > 0, true);
  assert.equal(result.snapshot.stateVersion, store.stateRow.version);
  assert.equal(result.snapshot.stateVersion, store.updateVersions.at(-1));
  assert.notEqual(result.snapshot.stateVersion, 0);
}));

test("T071/T072/T074: first AUTO/SLOW human joins empty table with depleted SLOW bot pool; bot fails with insufficient_funds; human JOIN commits with seededBots=[]; table is_slow_only=true; second SLOW human joins without bot funding; NORMAL human rejected", async () => withBotEnv(async () => {
  const tableId = "00000000-0000-4000-8000-000000000501";
  const ownerId = "00000000-0000-4000-8000-000000000502";
  const secondSlowUserId = "00000000-0000-4000-8000-000000000503";
  const normalUserId = "00000000-0000-4000-8000-000000000504";

  const table = {
    id: tableId,
    status: "OPEN",
    max_players: 6,
    buy_in: 500,
    stakes: calculateCanonicalPokerStakes(500),
    created_by: ownerId,
    lifecycle_kind: "STANDARD",
    has_human_participant: false,
    is_slow_only: false,
  };

  const users = new Map([
    [ownerId, { bankroll: 3375, autoClass: "NORMAL", override: "AUTO", revision: 1 }],
    [secondSlowUserId, { bankroll: 2500, autoClass: "SLOW", override: "AUTO", revision: 1 }],
    [normalUserId, { bankroll: 1000, autoClass: "NORMAL", override: "AUTO", revision: 1 }],
  ]);

  let tableSeats = [];
  let tableState = {
    version: 1,
    state: { tableId, seats: [], stacks: {} },
  };

  const ledgerCalls = [];
  const systemAccountCalls = [];

  const createScopeHarness = () => {
    let savepoints = 0;

    const makeScope = (name, parentScope = null) => {
      let scopeUncaughtError = null;
      let snapshotSeats = [...tableSeats];
      let snapshotTable = { ...table };

      const scopeSql = {
        savepoint: async (spName, fn) => {
          const childScope = makeScope("s" + savepoints++ + "_" + (spName || "sp"), scopeSql);
          try {
            return await childScope.execute(fn);
          } catch (childErr) {
            // Roll back snapshot on savepoint failure
            throw childErr;
          }
        },
        unsafe: async (sql, params = []) => {
          const text = String(sql);

          if (text.includes("to_regclass")) {
            return [{ available: true }];
          }
          if (text.includes("from public.poker_tables") && text.includes("for update")) {
            return [{ ...table }];
          }
          if (text.includes("from public.poker_tables")) {
            return [{ ...table }];
          }
          if (text.includes("from public.poker_seats") && text.includes("order by seat_no asc;")) {
            return tableSeats.map((s) => ({ ...s }));
          }
          if (text.includes("from public.poker_access_policy")) {
            return [{
              slow_threshold_ch: 2000,
              slow_hysteresis_bps: 500,
              slow_recovery_threshold_ch: 1900,
              revision: 1
            }];
          }
          if (text.includes("from public.poker_bot_tier_policy")) {
            return [{
              buy_in: 500,
              enabled: true,
              normal_refill_threshold_ch: 1000,
              normal_refill_amount_ch: 1000,
              slow_refill_threshold_ch: 1000,
              slow_refill_amount_ch: 1000,
              revision: 1
            }];
          }
          if (text.includes("from public.chips_accounts") && text.includes("account_type = 'SYSTEM'")) {
            return [
              { system_key: "POKER_BOT_BANKROLL" },
              { system_key: "POKER_BOT_SLOW_BANKROLL_500" }
            ];
          }
          if (text.includes("from public.chips_accounts") && text.includes("account_type = 'USER'")) {
            const user = users.get(params[0]);
            return [{
              balance: user?.bankroll ?? 1000,
              poker_auto_class: user?.autoClass ?? "NORMAL",
              poker_access_override: user?.override ?? "AUTO",
              poker_access_revision: user?.revision ?? 1,
            }];
          }
          if (text.includes("update public.chips_accounts") && text.includes("poker_auto_class")) {
            const user = users.get(params[0]);
            if (user) {
              const match = text.match(/poker_auto_class\s*=\s*'([^']+)'/);
              if (match) user.autoClass = match[1];
              user.revision += 1;
            }
            return [{
              user_id: params[0],
              poker_auto_class: user?.autoClass,
              poker_access_override: user?.override,
              poker_access_revision: user?.revision,
            }];
          }
          if (text.includes("insert into public.poker_seats")) {
            const isBot = text.includes("is_bot") || params[3] !== undefined;
            const newSeat = {
              table_id: params[0],
              user_id: params[1],
              seat_no: params[2],
              status: "ACTIVE",
              is_bot: isBot,
              bot_profile: isBot ? (params[3] || "NORMAL") : null,
              stack: isBot ? (params[4] || 500) : 0,
            };
            tableSeats.push(newSeat);
            return [{ seat_no: params[2] }];
          }
          if (text.includes("update public.poker_seats set stack")) {
            const seat = tableSeats.find((s) => s.table_id === params[0] && s.user_id === params[1] && s.seat_no === params[2]);
            if (seat) seat.stack = params[3];
            return [];
          }
          if (text.includes("delete from public.poker_seats")) {
            tableSeats = tableSeats.filter((s) => !(s.table_id === params[0] && s.user_id === params[1] && s.seat_no === params[2]));
            return [];
          }
          if (text.includes("update public.poker_tables")) {
            if (text.includes("is_slow_only = case when $2::boolean then true")) {
              if (params[1] === true) table.is_slow_only = true;
            }
            table.has_human_participant = true;
            return [];
          }
          if (text.includes("select 1 from public.chips_transactions")) {
            return [];
          }
          return [];
        }
      };

      return {
        sql: scopeSql,
        execute: async (fn) => {
          let outcome;
          try {
            outcome = await fn(scopeSql);
            if (scopeUncaughtError) throw scopeUncaughtError;
          } catch (err) {
            // Restore snapshot on error
            tableSeats = snapshotSeats;
            table.is_slow_only = snapshotTable.is_slow_only;
            table.has_human_participant = snapshotTable.has_human_participant;
            throw err;
          }
          return outcome;
        },
        hasUncaughtError: () => Boolean(scopeUncaughtError)
      };
    };

    return makeScope("root");
  };

  const sharedPostTransaction = async (payload) => {
    ledgerCalls.push(payload);
    for (const entry of payload.entries || []) {
      if (entry.accountType === "SYSTEM" || entry.kind === "SYSTEM") {
        systemAccountCalls.push(entry.systemKey);
        if (entry.systemKey === "POKER_BOT_SLOW_BANKROLL_500") {
          // Depleted SLOW pool: raise real reason-equivalent insufficient_funds!
          const error = new Error("insufficient_funds");
          error.code = "P0001";
          throw error;
        }
      }
    }
    return {
      transaction: { id: `tx-${ledgerCalls.length}`, user_id: payload.userId },
      entries: payload.entries,
      account: { balance: 0 }
    };
  };

  // STEP 1: First AUTO/SLOW human (owner) joins empty ordinary table with depleted SLOW pool
  const harness1 = createScopeHarness();
  const result1 = await executePokerJoinAuthoritative({
    beginSql: async (fn) => harness1.execute(fn),
    tableId,
    userId: ownerId,
    requestId: "join-step-1-owner-slow",
    buyIn: 500,
    postTransactionFn: sharedPostTransaction,
    loadStateForUpdate: async () => ({ ok: true, version: tableState.version, state: tableState.state }),
    updateStateLocked: async (tx, { nextState }) => {
      tableState.state = nextState;
      tableState.version += 1;
      return { ok: true, newVersion: tableState.version };
    },
    validateStateForStorage: isStateStorageValid,
    env: {
      POKER_BUY_IN_TIERS_JSON: JSON.stringify([100, 200, 500]),
      POKER_BOTS_ENABLED: "1",
      POKER_BOTS_MIN_PER_TABLE: "2",
      POKER_BOTS_MAX_PER_TABLE: "2",
      POKER_BOT_SLOW_BANKROLL_500: "0",
    }
  });

  // Verify Step 1 outcomes:
  assert.equal(result1.ok, true, "human join accepted even with depleted SLOW bot pool");
  assert.deepEqual(result1.seededBots, [], "seededBots is empty array on depleted pool");
  assert.equal(result1.access.effectiveClass, "SLOW", "owner classified as SLOW");
  assert.equal(result1.seatNo, 1, "owner seated at seat 1");
  assert.equal(result1.stack, 500, "owner funded stack is 500");
  assert.equal(table.is_slow_only, true, "table becomes is_slow_only=true");
  assert.equal(tableSeats.length, 1, "only 1 seat persists in tableSeats");
  assert.equal(tableSeats[0].user_id, ownerId, "only owner is seated");
  assert.equal(tableSeats[0].is_bot, false, "seated player is not a bot");
  assert.equal(tableSeats.filter((s) => s.is_bot).length, 0, "failed bot seat was rolled back");
  assert.equal(result1.snapshot.seats.length, 1, "snapshot has exactly 1 seat");
  assert.equal(result1.snapshot.seats[0].userId, ownerId, "snapshot has owner");
  assert.equal(result1.snapshot.stacks[ownerId], 500, "snapshot has owner stack 500");

  // Verify economic boundaries:
  assert.equal(systemAccountCalls.includes("POKER_BOT_SLOW_BANKROLL_500"), true, "attempted bot funding from SLOW pool");
  assert.equal(systemAccountCalls.includes("POKER_BOT_BANKROLL"), false, "never fell back to NORMAL bot pool");
  assert.equal(systemAccountCalls.includes("TREASURY"), false, "never fell back to TREASURY");
  assert.equal(systemAccountCalls.includes("GENESIS"), false, "never fell back to GENESIS");
  assert.equal(ledgerCalls.filter((c) => c.txType === "MINT").length, 0, "zero JOIN-time MINT/refill");

  // STEP 2: Second effective SLOW human joins the human-only SLOW table while pool is still depleted
  const harness2 = createScopeHarness();
  const botFundingBeforeStep2 = systemAccountCalls.length;
  const result2 = await executePokerJoinAuthoritative({
    beginSql: async (fn) => harness2.execute(fn),
    tableId,
    userId: secondSlowUserId,
    requestId: "join-step-2-second-slow",
    buyIn: 500,
    postTransactionFn: sharedPostTransaction,
    loadStateForUpdate: async () => ({ ok: true, version: tableState.version, state: tableState.state }),
    updateStateLocked: async (tx, { nextState }) => {
      tableState.state = nextState;
      tableState.version += 1;
      return { ok: true, newVersion: tableState.version };
    },
    validateStateForStorage: isStateStorageValid,
    env: {
      POKER_BUY_IN_TIERS_JSON: JSON.stringify([100, 200, 500]),
      POKER_BOTS_ENABLED: "1",
      POKER_BOTS_MIN_PER_TABLE: "2",
      POKER_BOTS_MAX_PER_TABLE: "2",
      POKER_BOT_SLOW_BANKROLL_500: "0",
    }
  });

  // Verify Step 2 outcomes:
  assert.equal(result2.ok, true, "second SLOW human join succeeds on human-only SLOW table");
  assert.equal(result2.seatNo, 2, "second human seated at seat 2");
  assert.equal(result2.stack, 500, "second human stack is 500");
  assert.deepEqual(result2.seededBots, [], "zero bots seeded for second human");
  assert.equal(systemAccountCalls.length, botFundingBeforeStep2, "no bot funding attempted or required for second human");
  assert.equal(tableSeats.length, 2, "table has 2 humans seated");
  assert.equal(tableSeats.every((s) => !s.is_bot), true, "all seated players are human");
  assert.equal(result2.snapshot.seats.length, 2, "snapshot has 2 seats");
  assert.equal(result2.snapshot.stacks[secondSlowUserId], 500, "second human stack in snapshot is 500");

  // STEP 3: Fresh effective NORMAL human is rejected from the SLOW-only table
  const harness3 = createScopeHarness();
  const ledgerCallsBeforeStep3 = ledgerCalls.length;
  await assert.rejects(
    () => executePokerJoinAuthoritative({
      beginSql: async (fn) => harness3.execute(fn),
      tableId,
      userId: normalUserId,
      requestId: "join-step-3-normal-rejected",
      buyIn: 500,
      postTransactionFn: sharedPostTransaction,
      loadStateForUpdate: async () => ({ ok: true, version: tableState.version, state: tableState.state }),
      updateStateLocked: async () => ({ ok: true, newVersion: tableState.version }),
      validateStateForStorage: isStateStorageValid,
      env: {
        POKER_BUY_IN_TIERS_JSON: JSON.stringify([100, 200, 500]),
      }
    }),
    (error) => {
      assert.equal(error?.code, "normal_table_required", "NORMAL user rejected from SLOW-only table");
      return true;
    }
  );

  // Verify Step 3 zero financial mutations:
  assert.equal(ledgerCalls.length, ledgerCallsBeforeStep3, "zero ledger mutation for rejected normal user");
  assert.equal(tableSeats.length, 2, "seats remain untouched");
}));
