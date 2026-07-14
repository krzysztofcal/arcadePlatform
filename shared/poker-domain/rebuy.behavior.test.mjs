import assert from "node:assert/strict";
import test from "node:test";
import { executePokerRebuyAuthoritative } from "./rebuy.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness({ ledgerFails = false, stateUpdateFails = false, handSeats = [] } = {}) {
  let store = {
    table: { id: "table-1", status: "OPEN" },
    seat: { user_id: "user-1", seat_no: 2, stack: 0, status: "ACTIVE", is_bot: false },
    stateVersion: 7,
    state: { phase: "PREFLOP", handId: "hand-1", handSeats, seats: handSeats, stacks: { "user-1": 0, bot: 90 } },
    requests: {},
    ledger: { user: 500, escrow: 200, posts: 0 }
  };

  const beginSql = async (fn) => {
    const draft = clone(store);
    const tx = {
      __draft: draft,
      unsafe: async (query, params = []) => {
        const sql = String(query).toLowerCase();
        if (sql.includes("select result_json") && sql.includes("poker_requests")) {
          const row = draft.requests[params[2]];
          return row ? [{ result_json: row.result_json, created_at: row.created_at }] : [];
        }
        if (sql.includes("insert into public.poker_requests")) {
          if (draft.requests[params[2]]) return [];
          draft.requests[params[2]] = { result_json: null, created_at: new Date().toISOString() };
          return [{ request_id: params[2] }];
        }
        if (sql.includes("update public.poker_requests set result_json")) {
          draft.requests[params[2]].result_json = params[4];
          return [];
        }
        if (sql.includes("delete from public.poker_requests")) {
          delete draft.requests[params[2]];
          return [];
        }
        if (sql.includes("from public.poker_tables") && sql.includes("for update")) return [draft.table];
        if (sql.includes("from public.poker_seats") && sql.includes("for update")) return [draft.seat];
        if (sql.includes("update public.poker_seats")) {
          if (draft.seat.user_id !== params[1] || draft.seat.seat_no !== params[2]) return [];
          draft.seat.stack = params[3];
          return [{ user_id: draft.seat.user_id }];
        }
        if (sql.includes("update public.poker_tables")) return [];
        throw new Error(`unexpected_sql:${sql.slice(0, 80)}`);
      }
    };
    const result = await fn(tx);
    store = draft;
    return result;
  };

  const loadStateForUpdate = async (tx) => ({ ok: true, version: tx.__draft.stateVersion, state: clone(tx.__draft.state) });
  const updateStateLocked = async (tx, { nextState }) => {
    if (stateUpdateFails) return { ok: false, reason: "conflict" };
    tx.__draft.stateVersion += 1;
    tx.__draft.state = clone(nextState);
    return { ok: true, newVersion: tx.__draft.stateVersion };
  };
  const postTransactionFn = async ({ entries, tx }) => {
    if (ledgerFails) throw Object.assign(new Error("insufficient_funds"), { code: "insufficient_funds" });
    const userDelta = entries.find((entry) => entry.accountType === "USER")?.amount || 0;
    const escrowDelta = entries.find((entry) => entry.accountType === "ESCROW")?.amount || 0;
    tx.__draft.ledger.user += userDelta;
    tx.__draft.ledger.escrow += escrowDelta;
    tx.__draft.ledger.posts += 1;
    return { transaction: { id: "ledger-1" } };
  };

  const execute = (requestId = "request-1") => executePokerRebuyAuthoritative({
    beginSql,
    tableId: "table-1",
    userId: "user-1",
    requestId,
    amount: 100,
    postTransactionFn,
    loadStateForUpdate,
    updateStateLocked,
    validateStateForStorage: () => true
  });
  return { execute, read: () => clone(store) };
}

test("manual rebuy atomically funds USER to ESCROW and queues the next hand", async () => {
  const harness = createHarness();
  const before = harness.read();
  const result = await harness.execute();
  const after = harness.read();
  assert.equal(result.ok, true);
  assert.equal(after.ledger.user, before.ledger.user - 100);
  assert.equal(after.ledger.escrow, before.ledger.escrow + 100);
  assert.equal(after.state.stacks["user-1"], 100);
  assert.equal(after.state.waitingForNextHandByUserId["user-1"], true);
  assert.equal(after.seat.stack, 100);
  assert.deepEqual(after.state.handSeats, []);
});

test("stored rebuy result survives restart semantics and cannot fund twice", async () => {
  const harness = createHarness();
  const first = await harness.execute("same-request");
  const second = await harness.execute("same-request");
  const after = harness.read();
  assert.equal(first.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(after.ledger.posts, 1);
  assert.equal(after.ledger.user, 400);
  assert.equal(after.ledger.escrow, 300);
});

test("failed ledger funding rolls back state, seat, request, and balances", async () => {
  const harness = createHarness({ ledgerFails: true });
  const before = harness.read();
  await assert.rejects(harness.execute(), (error) => error?.code === "insufficient_funds");
  assert.deepEqual(harness.read(), before);
});

test("state update conflict prevents any rebuy ledger funding", async () => {
  const harness = createHarness({ stateUpdateFails: true });
  const before = harness.read();
  await assert.rejects(harness.execute(), (error) => error?.code === "state_conflict");
  assert.deepEqual(harness.read(), before);
  assert.equal(harness.read().ledger.posts, 0);
});

test("rebuy is rejected while the busted player remains in current handSeats", async () => {
  const harness = createHarness({ handSeats: [{ userId: "user-1", seatNo: 2 }] });
  await assert.rejects(harness.execute(), (error) => error?.code === "rebuy_not_available");
  assert.equal(harness.read().ledger.posts, 0);
});
