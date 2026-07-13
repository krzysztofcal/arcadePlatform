import test from "node:test";
import assert from "node:assert/strict";
import { createPersistedBootstrapRepository } from "./persisted-bootstrap-repository.mjs";
import { createPublicProfileRepository, __testOnly as profileRepositoryTestOnly } from "../profile/public-profile-repository.mjs";

test("fixture repository load is deterministic without DB env", async () => {
  const tableId = "table_fixture_repo";
  const fixture = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6 },
      seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
      stateRow: { version: 4, state: { handId: "h4", phase: "PREFLOP" } }
    }
  };

  const repo = createPersistedBootstrapRepository({
    env: {
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixture),
      SUPABASE_DB_URL: ""
    }
  });

  const first = await repo.load(tableId);
  const second = await repo.load(tableId);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    tableRow: fixture[tableId].tableRow,
    seatRows: fixture[tableId].seatRows,
    stateRow: fixture[tableId].stateRow
  });
});

test("db bootstrap module resolves from ws-server runtime boundary", async () => {
  const dbModule = await import("./persisted-bootstrap-db.mjs");
  assert.equal(typeof dbModule.beginSqlWs, "function");
});

test("public profile repository performs one independent bounded allowlisted query", async () => {
  const userId = "00000000-0000-4000-8000-000000000123";
  let queryCount = 0;
  let queryParams = null;
  const repository = createPublicProfileRepository({
    env: {
      SUPABASE_DB_URL: "postgres://test",
      SUPABASE_URL: "https://stageabc.supabase.co"
    },
    beginSql: async (callback) => callback({
      unsafe: async (_query, params) => {
        queryCount += 1;
        queryParams = params;
        return [{
          user_id: userId,
          handle: "cosmic-panda-123456",
          display_name: "Cosmic Panda 123456",
          bio: "must not be selected",
          avatar_key: null,
          avatar_variant: "panda-pink"
        }];
      }
    })
  });

  const profiles = await repository.loadPublicProfiles(["guest_user", userId, userId]);

  assert.equal(queryCount, 1);
  assert.deepEqual(queryParams, [[userId]]);
  assert.deepEqual(profiles, {
    [userId]: {
      handle: "cosmic-panda-123456",
      displayName: "Cosmic Panda 123456",
      avatar: { type: "default", variant: "panda-pink" }
    }
  });
  assert.equal(JSON.stringify(profiles).includes("bio"), false);
});

test("public profile repository skips invalid ids and caps deterministic candidates", () => {
  const ids = Array.from({ length: 12 }, (_value, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const normalized = profileRepositoryTestOnly.normalizeUserIds(["guest", ...ids.reverse(), ids[0]]);
  assert.equal(normalized.length, 10);
  assert.deepEqual(normalized, [...normalized].sort((left, right) => left.localeCompare(right)));
});
