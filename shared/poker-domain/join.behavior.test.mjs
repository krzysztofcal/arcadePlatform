import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executePokerJoinAuthoritative } from "./join.mjs";
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
  process.env.POKER_BOT_BUYIN_BB = "100";
  process.env.POKER_BOT_PROFILE_DEFAULT = "TRIVIAL";
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
  return {
    ...args,
    loadStateForUpdate: async (tx, tableId) => {
      const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
      const row = rows?.[0] || null;
      if (!row) return { ok: false, reason: "not_found" };
      return { ok: true, version: row.version, state: row.state };
    },
    updateStateLocked: async (tx, { tableId, nextState }) => {
      const rows = await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, JSON.stringify(nextState)]);
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
  try {
    await fs.mkdir(stagedDir, { recursive: true });
    await fs.copyFile("shared/poker-domain/join.mjs", stagedJoin);
    await fs.copyFile("shared/poker-domain/bots.mjs", stagedBots);
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

test("allows second human join during live post-flop hand when persisted community uses string card codes", async () => withBotsDisabled(async () => {
  const seatRows = [
    { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 98, is_bot: false, bot_profile: null, leave_after_hand: false },
    { user_id: "bot_1", seat_no: 2, status: "ACTIVE", stack: 101, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false },
    { user_id: "bot_2", seat_no: 3, status: "ACTIVE", stack: 101, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false }
  ];
  const stateRow = {
    version: 5,
    state: {
      tableId: "t-live",
      phase: "FLOP",
      handId: "hand_live_join",
      seats: [
        { userId: "human_1", seatNo: 1, status: "ACTIVE" },
        { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
        { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
      ],
      stacks: { human_1: 98, bot_1: 101, bot_2: 101 },
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
          stateRow.state = JSON.parse(params[1]);
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
          stateRow.state = JSON.parse(params[1]);
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

test("returns canonical db seat number and persisted stack on rejoin", async () => {
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("seat_no, stack")) return [{ seat_no: 4, stack: 330 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          return [{ user_id: "u1", seat_no: 4, status: "ACTIVE", stack: 330, is_bot: false, bot_profile: null, leave_after_hand: false }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
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
});

test("rejoin projects stale state-only seats out of the authoritative snapshot", async () => {
  const store = {
    table: { id: "t-poison-rejoin", status: "OPEN", max_players: 4, stakes: '{"sb":1,"bb":2}' },
    seatRows: [
      { user_id: "human_1", seat_no: 1, status: "ACTIVE", stack: 100, is_bot: false, bot_profile: null, leave_after_hand: false },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", stack: 200, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false },
      { user_id: "bot_2", seat_no: 3, status: "ACTIVE", stack: 200, is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false }
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
          store.stateRow.state = JSON.parse(params[1]);
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
    buyIn: 120,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.rejoin, false);
  assert.equal(result.seatNo, 4);
  assert.equal(result.snapshot.stateVersion, 6);
  assert.deepEqual(result.snapshot.seats.map((seat) => seat.userId), ["human_1", "bot_1", "bot_2", "human_2"]);
  assert.equal(result.snapshot.stacks.human_2, 120);
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
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
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
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) { writes.push(JSON.parse(params[1])); return [{ version: 2 }]; }
        return [];
      }
    }),
    tableId: "t1",
    userId: "u2",
    requestId: "r7",
    autoSeat: true,
    preferredSeatNo: 2,
    buyIn: 180,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 3);
  assert.equal(result.stack, 180);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].stacks.u2, 180);
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
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u4",
    requestId: "r7-retry",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 140,
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
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: "t1", seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) return [{ version: 2 }];
        return [];
      }
    }),
    tableId: "t1",
    userId: "u5",
    requestId: "r7-retry-noabort",
    autoSeat: true,
    preferredSeatNo: 1,
    buyIn: 140,
    postTransactionFn: async () => ({ ok: true })
  }));

  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 4);
  assert.deepEqual(selectedSeats, [1, 4]);
}));


test("rejoin with invalid persisted stack fails closed and does not write state", async () => {
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
    (error) => error?.code === "state_invalid"
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

test("first human authoritative join seeds exactly two bots and persists bot seat fields", async () => withBotEnv(async () => {
  const store = {
    table: { id: "t-bots", status: "OPEN", max_players: 6, stakes: '{"sb":1,"bb":2}' },
    seatRows: [],
    stateRow: { version: 3, state: { tableId: "t-bots", seats: [], stacks: {} } },
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
          store.stateRow.state = JSON.parse(params[1]);
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
    buyIn: 150,
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
    { seatNo: 2, botProfile: "TRIVIAL", leaveAfterHand: false },
    { seatNo: 3, botProfile: "TRIVIAL", leaveAfterHand: false }
  ]);
  assert.equal(result.snapshot.stacks.human_1, 150);
  assert.equal(Object.values(result.snapshot.stacks).filter((stack) => stack === 200).length, 2);
  assert.equal(result.snapshot.stateVersion, 4);
  assert.equal(store.stateRow.version, 4);
  assert.equal(store.seatRows.filter((seat) => seat.is_bot).length, 2);
  assert.equal(store.ledgerCalls.length, 3);
}));

test("authoritative join replay does not duplicate bots and only fills missing bot seat", async () => withBotEnv(async () => {
  const state = {
    table: { id: "t-bots-replay", status: "OPEN", max_players: 6, stakes: '{"sb":1,"bb":2}' },
    seatRows: [
      { user_id: "existing_bot", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", leave_after_hand: false, stack: 200 }
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
          state.stateRow.state = JSON.parse(params[1]);
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
    buyIn: 120,
    postTransactionFn: async (payload) => {
      state.ledgerCalls.push(payload);
      return { ok: true };
    }
  }));

  const first = await runJoin("join-replay-1");
  assert.equal(first.seededBots.length, 1);
  assert.equal(first.snapshot.seats.filter((seat) => seat.isBot).length, 2);
  assert.equal(first.snapshot.stateVersion, 5);

  const second = await runJoin("join-replay-2");
  assert.equal(second.rejoin, true);
  assert.equal(second.snapshot.seats.filter((seat) => seat.isBot).length, 2);
  assert.equal(second.snapshot.stacks.existing_bot, 200);
  assert.equal(state.seatRows.filter((seat) => seat.is_bot).length, 2);
  assert.equal(state.ledgerCalls.filter((payload) => payload.txType === "TABLE_BUY_IN").length, 2);
}));

test("fresh authoritative join starting from version 0 returns the persisted post-mutation version", async () => withBotEnv(async () => {
  const store = {
    table: { id: "t-fresh-version", status: "OPEN", max_players: 6, stakes: '{"sb":1,"bb":2}' },
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
          store.stateRow.state = JSON.parse(params[1]);
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
