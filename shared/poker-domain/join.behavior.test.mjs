import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executePokerJoinAuthoritative } from "./join.mjs";

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
      if (!Array.isArray(rows) || rows.length === 0) return { ok: true, newVersion: null };
      const nextVersion = Number(rows?.[0]?.version);
      return { ok: true, newVersion: Number.isInteger(nextVersion) ? nextVersion + 1 : null };
    },
    validateStateForStorage
  };
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

test("returns canonical db seat number and persisted stack on rejoin", async () => {
  let reads = 0;
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) {
          reads += 1;
          if (reads === 1) return [{ seat_no: 4 }];
          return [{ seat_no: 4, stack: 330 }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
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

test("maps unique insert conflicts to seat_taken", async () => {
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
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
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
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
  const seatRows = [];
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;")) {
          if (sql.includes("status = 'ACTIVE'")) return [{ seat_no: 1 }, ...seatRows.map((seat) => ({ seat_no: seat.seat_no }))];
          return seatRows.map((seat) => ({ ...seat }));
        }
        if (sql.includes("insert into public.poker_seats")) {
          sequence.push('insert_seat');
          seatRows.push({ user_id: params[1], seat_no: params[2], status: 'ACTIVE', stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: 3 }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          sequence.push('update_stack');
          seatRows[0].stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) { sequence.push('update_state'); return [{ version: 1 }]; }
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
  const seatRows = [];
  const result = await executePokerJoinAuthoritative(withLockedState({
    beginSql: async (fn) => fn({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
        if (sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
        if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [{ seat_no: 1 }, { seat_no: 2 }, { seat_no: 5 }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc;") && !sql.includes("status = 'ACTIVE'")) return seatRows.map((seat) => ({ ...seat }));
        if (sql.includes("insert into public.poker_seats")) {
          seatRows.push({ user_id: params[1], seat_no: params[2], status: 'ACTIVE', stack: 0, is_bot: false, bot_profile: null, leave_after_hand: false });
          return [{ seat_no: params[2] }];
        }
        if (sql.includes("update public.poker_seats set stack")) {
          seatRows[0].stack = params[3];
          return [{ ok: true }];
        }
        if (sql.includes("select version, state from public.poker_state")) return [{ version: 1, state: { tableId: 't1', seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state set state")) { writes.push(JSON.parse(params[1])); return [{ version: 1 }]; }
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


test("rejoin with invalid persisted stack fails closed and does not write state", async () => {
  const writes = { state: 0 };
  await assert.rejects(
    () => executePokerJoinAuthoritative(withLockedState({
      beginSql: async (fn) => fn({
        unsafe: async (sql, params) => {
          if (sql.includes("from public.poker_tables")) return [{ id: "t1", status: "OPEN", max_players: 6 }];
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2") && !sql.includes("seat_no, stack")) return [{ seat_no: 4 }];
          if (sql.includes("seat_no, stack")) return [{ seat_no: 4, stack: 0 }];
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
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2") && !sql.includes("seat_no, stack")) return [];
          if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
          if (sql.includes("insert into public.poker_seats")) return [{ seat_no: 2 }];
          if (sql.includes("seat_no, stack")) return [{ seat_no: 2, stack: 0 }];
          if (sql.includes("update public.poker_seats set stack")) { writes.seatStackUpdate += 1; return [{ ok: true }]; }
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
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
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
          if (sql.includes("from public.poker_seats") && sql.includes("status = 'ACTIVE'") && sql.includes("user_id = $2")) return [];
          if (sql.includes("status = 'ACTIVE'") && sql.includes("order by seat_no asc")) return [];
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
          return [{ version: store.stateRow.version - 1 }];
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
          return [{ version: state.stateRow.version - 1 }];
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
