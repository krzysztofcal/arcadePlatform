import test from "node:test";
import assert from "node:assert/strict";
import { createTableSnapshotLoader, loadSnapshotInTx } from "./table-snapshot.mjs";

function makeTx({ tableRow = { id: "table_1" }, seatRows = [], activeSeatRows = null, stateRow, holeCardRows = null, holeCardsError = null, onUpdate = null, onInsertAction = null }) {
  return {
    async unsafe(query) {
      if (query.includes("from public.poker_tables")) return tableRow ? [tableRow] : [];
      if (query.includes("from public.poker_seats") && query.includes("status = 'ACTIVE'")) return activeSeatRows || seatRows.filter((row) => row.status === "ACTIVE" && !row.is_bot);
      if (query.includes("from public.poker_seats")) return seatRows;
      if (query.includes("from public.poker_state")) return stateRow ? [stateRow] : [];
      if (query.includes("from public.poker_hole_cards")) {
        if (holeCardsError) throw holeCardsError;
        return holeCardRows || [];
      }
      if (query.includes("update public.poker_state")) return typeof onUpdate === "function" ? onUpdate(query) : [];
      if (query.includes("insert into public.poker_actions")) {
        if (typeof onInsertAction === "function") onInsertAction();
        return [];
      }
      if (query.includes("set_config('lock_timeout'")) return [{ set_config: "200ms" }];
      if (query.includes("set_config('statement_timeout'")) return [{ set_config: "4000ms" }];
      return [];
    }
  };
}

test("snapshot loader returns sanitized state shape and viewer-scoped myHoleCards for seated viewer", async () => {
  process.env.POKER_DEAL_SECRET = "table-snapshot-test-secret";
  const tx = makeTx({
    seatRows: [{ user_id: "u1", seat_no: 1, status: "ACTIVE", is_bot: false }],
    stateRow: { version: 7, state: { phase: "PREFLOP", handId: "h1", handSeed: "seed-a", communityDealt: 0, seats: [{ userId: "u1", seatNo: 1 }] } },
    holeCardRows: [{ user_id: "u1", cards: [{ r: "A", s: "S" }, { r: "K", s: "H" }] }]
  });

  const result = await loadSnapshotInTx({ tx, tableId: "table_1", userId: "u1" });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.state.version, 7);
  assert.equal(result.snapshot.state.state.holeCardsByUserId, undefined);
  assert.deepEqual(result.snapshot.myHoleCards, [{ r: "A", s: "S" }, { r: "K", s: "H" }]);
});

test("snapshot loader hides myHoleCards for observer", async () => {
  const tx = makeTx({
    seatRows: [
      { user_id: "u1", seat_no: 1, status: "ACTIVE", is_bot: false },
      { user_id: "u2", seat_no: 2, status: "ACTIVE", is_bot: false }
    ],
    stateRow: { version: 3, state: { phase: "PREFLOP", handId: "h1", seats: [{ userId: "u1", seatNo: 1 }, { userId: "u2", seatNo: 2 }] } },
    holeCardRows: [
      { user_id: "u1", cards: [{ r: "A", s: "S" }, { r: "K", s: "H" }] },
      { user_id: "u2", cards: [{ r: "Q", s: "H" }, { r: "J", s: "D" }] }
    ]
  });

  const result = await loadSnapshotInTx({ tx, tableId: "table_1", userId: "observer" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.myHoleCards, []);
});

test("snapshot loader tolerates missing hole-cards table like HTTP semantics", async () => {
  const tx = makeTx({
    seatRows: [{ user_id: "u1", seat_no: 1, status: "ACTIVE", is_bot: false }],
    stateRow: { version: 1, state: { phase: "PREFLOP", handId: "h1", seats: [{ userId: "u1", seatNo: 1 }] } },
    holeCardsError: { code: "42P01", message: "relation public.poker_hole_cards does not exist" }
  });

  const result = await loadSnapshotInTx({ tx, tableId: "table_1", userId: "u1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.myHoleCards, []);
});

test("loadSnapshotInTx propagates unknown hole-card storage failures to outer sanitization boundary", async () => {
  const internalMessage = "db_internal: timeout in public.poker_hole_cards read path";
  const tx = makeTx({
    seatRows: [{ user_id: "u1", seat_no: 1, status: "ACTIVE", is_bot: false }],
    stateRow: { version: 1, state: { phase: "PREFLOP", handId: "h1", seats: [{ userId: "u1", seatNo: 1 }] } },
    holeCardsError: { code: "XX000", message: internalMessage }
  });

  await assert.rejects(
    () => loadSnapshotInTx({ tx, tableId: "table_1", userId: "u1" }),
    (error) => String(error?.message || "") === internalMessage
  );
});

test("snapshot timeout parity with HTTP semantics", async () => {
  process.env.POKER_DEAL_SECRET = "table-snapshot-timeout-secret";
  let actionInsertCount = 0;
  const tx = makeTx({
    seatRows: [{ user_id: "u1", seat_no: 1, status: "ACTIVE", is_bot: false }],
    activeSeatRows: [{ user_id: "u1", seat_no: 1 }],
    stateRow: {
      version: 1,
      state: {
        phase: "PREFLOP",
        handId: "h-timeout",
        handSeed: "seed-timeout",
        turnNo: 1,
        turnUserId: "u1",
        turnDeadlineAt: 1,
        communityDealt: 0,
        community: [],
        seats: [{ userId: "u1", seatNo: 1 }],
        stacks: { u1: 1000 },
        foldedByUserId: {},
        leftTableByUserId: {},
        sitOutByUserId: {},
        allInByUserId: {},
        betThisRoundByUserId: { u1: 0 },
        currentBet: 0
      }
    },
    holeCardRows: [{ user_id: "u1", cards: [{ r: "A", s: "S" }, { r: "K", s: "H" }] }],
    onUpdate: () => [{ version: 2 }],
    onInsertAction: () => {
      actionInsertCount += 1;
    }
  });

  const first = await loadSnapshotInTx({ tx, tableId: "table_1", userId: "u1", nowMs: 10_000 });
  assert.equal(first.ok, true);
  assert.equal(first.snapshot.state.version, 2);
  assert.equal(actionInsertCount, 1);
});

test("table snapshot loader supports fixture-path deterministic payload", async () => {
  const loader = createTableSnapshotLoader({
    env: {
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify({
        table_fixture: {
          tableId: "table_fixture",
          state: { version: 5, state: { phase: "PREFLOP" } },
          myHoleCards: [],
          legalActions: [],
          actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
          viewer: { userId: "fixture_user", seated: false }
        }
      })
    }
  });
  const result = await loader({ tableId: "table_fixture", userId: "fixture_user" });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.state.version, 5);
});


test("snapshot loader rejects contract-broken actionable turn state", async () => {
  const tx = makeTx({
    seatRows: [{ user_id: "u1", seat_no: 1, status: "ACTIVE", is_bot: false }],
    activeSeatRows: [{ user_id: "u1", seat_no: 1 }],
    stateRow: {
      version: 11,
      state: {
        phase: "PREFLOP",
        handId: "h-broken",
        handSeed: "seed-broken",
        turnUserId: "u1",
        turnDeadlineAt: Date.now() + 60_000,
        seats: [{ userId: "u1", seatNo: 1 }],
        stacks: { u1: 0 },
        foldedByUserId: {},
        leftTableByUserId: {},
        sitOutByUserId: {},
        allInByUserId: {},
        betThisRoundByUserId: { u1: 0 },
        currentBet: 0
      }
    },
    holeCardRows: [{ user_id: "u1", cards: [{ r: "A", s: "S" }, { r: "K", s: "H" }] }]
  });

  const result = await loadSnapshotInTx({ tx, tableId: "table_1", userId: "u1" });
  assert.deepEqual(result, { ok: false, code: "contract_mismatch_empty_legal_actions" });
});

test("createTableSnapshotLoader preserves deterministic typed failure codes", async () => {
  const loader = createTableSnapshotLoader({
    env: {
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify({
        table_fail: {
          ok: false,
          code: "state_invalid"
        }
      })
    }
  });

  const result = await loader({ tableId: "table_fail", userId: "u1" });
  assert.deepEqual(result, { ok: false, code: "state_invalid" });
});

test("createTableSnapshotLoader collapses unknown typed fixture failures to snapshot_failed", async () => {
  const loader = createTableSnapshotLoader({
    env: {
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify({
        table_internal: {
          ok: false,
          code: "db_internal: secret storage details"
        }
      })
    }
  });

  const result = await loader({ tableId: "table_internal", userId: "u1" });
  assert.deepEqual(result, { ok: false, code: "snapshot_failed" });
});
