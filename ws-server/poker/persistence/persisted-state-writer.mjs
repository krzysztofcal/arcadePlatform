import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";
import { writePersistedTableToFile } from "./persisted-state-file-store.mjs";


function normalizeJsonState(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function sanitizePersistedState(value) {
  const state = normalizeJsonState(value);
  const { deck: _ignoredDeck, holeCardsByUserId: _ignoredHoleCards, ...persistedState } = state;
  return persistedState;
}

const stableStringify = (value) =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return val;
    return Object.keys(val)
      .sort()
      .reduce((acc, key) => {
        acc[key] = val[key];
        return acc;
      }, {});
  });

export function createPersistedStateWriter({ env = process.env, beginSql = beginSqlWs, klog = () => {} } = {}) {
  async function writeViaDb({ tableId, expectedVersion, nextState }) {
    return beginSql(async (tx) => {
      const persistedState = sanitizePersistedState(nextState);
      const payload = JSON.stringify(persistedState);
      const rows = await tx.unsafe(
        "update public.poker_state set version = version + 1, state = $3::jsonb, updated_at = now() where table_id = $1 and version = $2 returning version;",
        [tableId, expectedVersion, payload]
      );
      const newVersion = Number(rows?.[0]?.version);
      if (Number.isInteger(newVersion) && newVersion >= 0) {
        await tx.unsafe("update public.poker_tables set last_activity_at = now() where id = $1;", [tableId]);
        return { ok: true, newVersion };
      }

      const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
      const currentRow = stateRows?.[0];
      if (!currentRow) return { ok: false, reason: "not_found" };
      const currentVersion = Number(currentRow?.version);
      const currentState = sanitizePersistedState(currentRow?.state);
      const equalState = stableStringify(currentState) === stableStringify(sanitizePersistedState(nextState));
      if (equalState) {
        return { ok: true, newVersion: Number.isInteger(currentVersion) ? currentVersion : expectedVersion, alreadyApplied: true };
      }
      return { ok: false, reason: "conflict", currentVersion: Number.isInteger(currentVersion) ? currentVersion : null };
    }, { env });
  }

  async function writeMutation({ tableId, expectedVersion, nextState, supabaseUrl, supabaseServiceRoleKey, meta = null }) {
    if (!tableId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return { ok: false, reason: "invalid" };
    }
    if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
      return { ok: false, reason: "invalid" };
    }
    const persistedState = sanitizePersistedState(nextState);
    try {
      JSON.stringify(persistedState);
    } catch {
      return { ok: false, reason: "invalid" };
    }

    try {
      const forcedFailureKind = typeof env.WS_TEST_PERSIST_FAIL_KIND === "string" ? env.WS_TEST_PERSIST_FAIL_KIND.trim() : "";
      if (forcedFailureKind && forcedFailureKind === String(meta?.mutationKind || "")) {
        return { ok: false, reason: "conflict" };
      }
      if (env.WS_PERSISTED_STATE_FILE) {
        return writePersistedTableToFile({
          filePath: env.WS_PERSISTED_STATE_FILE,
          tableId,
          expectedVersion,
          nextState: persistedState
        });
      }
      if (!env.SUPABASE_DB_URL && !supabaseUrl && !supabaseServiceRoleKey) {
        return { ok: false, reason: "config_missing" };
      }
      return await writeViaDb({ tableId, expectedVersion, nextState: persistedState });
    } catch (error) {
      klog("ws_persisted_state_write_error", {
        tableId,
        expectedVersion,
        reason: "db_error",
        message: error?.message || "unknown",
        ...(meta && typeof meta === "object" ? meta : {})
      });
      return { ok: false, reason: "db_error", message: error?.message || "unknown" };
    }
  }

  return { writeMutation };
}
