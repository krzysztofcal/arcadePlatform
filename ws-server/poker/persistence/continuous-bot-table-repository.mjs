import { createPokerTableWithState } from "../../../netlify/functions/_shared/poker-table-init.mjs";
import {
  applySeatsAndStacksToState,
  getBotConfig,
  parseStakes,
  seedBotsForJoin
} from "../../shared/poker-domain/bots.mjs";
import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";
import { postTransaction } from "./chips-ledger.mjs";

export const CONTINUOUS_BOT_PROFILE_KEY = "CONTINUOUS_BOT_DEFAULT";
const MAX_DESIRED_TABLES = 2;
const MAX_SEATS = 6;
const MAX_INTERVAL_SECONDS = 86_400;

function intInRange(value, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function normalizeContinuousBotProfile(row) {
  const profileKey = typeof row?.profile_key === "string" ? row.profile_key.trim().toUpperCase() : "";
  const desiredTableCount = intInRange(row?.desired_table_count, 0, MAX_DESIRED_TABLES);
  const maxSeats = intInRange(row?.max_seats, 2, MAX_SEATS);
  const minBotCount = intInRange(row?.min_bot_count, 0, MAX_SEATS - 1);
  const targetBotCount = intInRange(row?.target_bot_count, 0, MAX_SEATS - 1);
  const maxBotCount = intInRange(row?.max_bot_count, 0, MAX_SEATS - 1);
  const rotationIntervalSeconds = intInRange(row?.rotation_interval_seconds, 60, MAX_INTERVAL_SECONDS);
  const postponeIntervalSeconds = intInRange(row?.postpone_interval_seconds, 30, 3_600);
  const smallBlind = intInRange(row?.small_blind, 1, 999_999);
  const bigBlind = intInRange(row?.big_blind, 2, 1_000_000);
  if (
    profileKey !== CONTINUOUS_BOT_PROFILE_KEY
    || desiredTableCount == null
    || maxSeats == null
    || minBotCount == null
    || targetBotCount == null
    || maxBotCount == null
    || rotationIntervalSeconds == null
    || postponeIntervalSeconds == null
    || smallBlind == null
    || bigBlind == null
    || bigBlind <= smallBlind
    || minBotCount > targetBotCount
    || targetBotCount > maxBotCount
    || maxBotCount >= maxSeats
  ) {
    return null;
  }
  return {
    profileKey,
    enabled: row?.enabled === true,
    desiredTableCount,
    minBotCount,
    targetBotCount,
    maxBotCount,
    rotationIntervalSeconds,
    postponeIntervalSeconds,
    smallBlind,
    bigBlind,
    maxSeats,
    updatedAt: row?.updated_at ?? null
  };
}

function canonicalStakes(value) {
  const parsed = parseStakes(value);
  return parsed?.ok ? parsed.value : null;
}

function rotationDueAtForTable(table, profile) {
  const createdAtMs = table?.created_at ? new Date(table.created_at).getTime() : Number.NaN;
  const baseMs = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
  return new Date(baseMs + profile.rotationIntervalSeconds * 1_000).toISOString();
}

export function tableMatchesContinuousBotProfile(table, profile) {
  const stakes = canonicalStakes(table?.stakes);
  return table?.managed_profile_key === profile.profileKey
    && Number(table?.max_players) === profile.maxSeats
    && stakes?.sb === profile.smallBlind
    && stakes?.bb === profile.bigBlind;
}

async function createManagedTable(tx, { profile, botConfig, klog }) {
  const stakes = { sb: profile.smallBlind, bb: profile.bigBlind };
  const created = await createPokerTableWithState(tx, {
    userId: null,
    maxPlayers: profile.maxSeats,
    stakesJson: JSON.stringify(stakes),
    lifecycleKind: "CONTINUOUS_BOT",
    managedProfileKey: profile.profileKey,
    rotationDueAt: new Date(Date.now() + profile.rotationIntervalSeconds * 1_000).toISOString()
  });
  const seededBots = await seedBotsForJoin({
    tx,
    tableId: created.tableId,
    maxPlayers: profile.maxSeats,
    tableStakes: stakes,
    cfg: botConfig,
    humanUserId: null,
    postTransaction,
    targetBotCount: profile.targetBotCount,
    allowBotsOnly: true,
    requireExactTarget: true,
    fundingReason: "BOT_SEED_BUY_IN",
    idempotencyPrefix: "managed-bot-seed-buyin",
    klog
  });
  const stateRows = await tx.unsafe(
    "select state from public.poker_state where table_id = $1 and version = 0 for update;",
    [created.tableId]
  );
  const initialState = stateRows?.[0]?.state;
  const projectedState = applySeatsAndStacksToState(initialState, {
    tableId: created.tableId,
    seatEntries: seededBots,
    stackEntries: seededBots.map((bot) => [bot.userId, bot.stack])
  });
  const updatedRows = await tx.unsafe(
    "update public.poker_state set state = $2::jsonb, updated_at = now() where table_id = $1 and version = 0 returning table_id;",
    [created.tableId, JSON.stringify(projectedState)]
  );
  if (updatedRows?.length !== 1) throw new Error("managed_bot_state_projection_failed");
  return created.tableId;
}

export function createContinuousBotTableRepository({
  env = process.env,
  beginSql = beginSqlWs,
  klog = () => {}
} = {}) {
  let lastKnownProfile = null;

  async function reconcile() {
    const botConfig = getBotConfig(env);
    try {
      const result = await beginSql(async (tx) => {
        await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", ["poker:continuous-bot-supervisor:v1"]);
        const profileRows = await tx.unsafe(
          `select profile_key, enabled, desired_table_count, min_bot_count, target_bot_count, max_bot_count,
                  rotation_interval_seconds, postpone_interval_seconds, small_blind, big_blind, max_seats, updated_at
             from public.poker_managed_table_profiles where profile_key = $1 limit 1;`,
          [CONTINUOUS_BOT_PROFILE_KEY]
        );
        const profile = normalizeContinuousBotProfile(profileRows?.[0]);
        if (!profile) throw Object.assign(new Error("managed_profile_invalid"), { code: "managed_profile_invalid" });
        const tableRows = await tx.unsafe(
          `select id, status, max_players, stakes, managed_profile_key, rotation_due_at, created_at
             from public.poker_tables
            where status = 'OPEN' and lifecycle_kind = 'CONTINUOUS_BOT'
            order by created_at asc, id asc
            for update;`
        );
        const openTables = Array.isArray(tableRows) ? tableRows : [];
        const desiredCount = profile.enabled ? profile.desiredTableCount : 0;
        const retirementTableIds = [];
        for (const table of openTables) {
          if (!tableMatchesContinuousBotProfile(table, profile)) {
            retirementTableIds.push(table.id);
          }
        }
        const nonRetiring = openTables.filter((table) => !retirementTableIds.includes(table.id));
        if (nonRetiring.length > desiredCount) {
          retirementTableIds.push(...nonRetiring.slice(desiredCount).map((table) => table.id));
        }
        if (desiredCount === 0) {
          retirementTableIds.splice(0, retirementTableIds.length, ...openTables.map((table) => table.id));
        }
        const uniqueRetirements = [...new Set(retirementTableIds)];
        const rotationScheduledTableIds = [];
        const rotationDueAtByTableId = {};
        for (const table of openTables) {
          if (uniqueRetirements.includes(table.id) || table.rotation_due_at) continue;
          const rotationDueAt = rotationDueAtForTable(table, profile);
          const scheduledRows = await tx.unsafe(
            `update public.poker_tables
                set rotation_due_at = $2, updated_at = now()
              where id = $1 and rotation_due_at is null
              returning id, rotation_due_at;`,
            [table.id, rotationDueAt]
          );
          if (scheduledRows?.length === 1) {
            rotationScheduledTableIds.push(table.id);
            rotationDueAtByTableId[table.id] = new Date(scheduledRows[0].rotation_due_at).toISOString();
          }
        }
        if (uniqueRetirements.length > 0) {
          await tx.unsafe(
            "update public.poker_tables set rotation_due_at = least(coalesce(rotation_due_at, now()), now()), updated_at = now() where id = any($1::uuid[]);",
            [uniqueRetirements]
          );
        }
        const createdTableIds = [];
        const retainedCount = openTables.length;
        for (let index = retainedCount; index < desiredCount; index += 1) {
          if (!botConfig.enabled) throw Object.assign(new Error("bots_disabled"), { code: "bots_disabled" });
          createdTableIds.push(await createManagedTable(tx, { profile, botConfig, klog }));
        }
        return {
          profile,
          createdTableIds,
          activeTableIds: [
            ...openTables.filter((table) => !uniqueRetirements.includes(table.id)).map((table) => table.id),
            ...createdTableIds
          ],
          retirementTableIds: uniqueRetirements,
          rotationScheduledTableIds,
          rotationDueAtByTableId
        };
      }, { env });
      lastKnownProfile = result.profile;
      return { ok: true, ...result };
    } catch (error) {
      klog("ws_continuous_bot_table_supervisor_failed", {
        reason: error?.code || error?.message || "unknown"
      });
      return {
        ok: false,
        reason: error?.code || error?.message || "profile_read_failed",
        profile: lastKnownProfile,
        createdTableIds: [],
        activeTableIds: [],
        retirementTableIds: [],
        rotationScheduledTableIds: [],
        rotationDueAtByTableId: {}
      };
    }
  }

  async function requestRetirement(tableId) {
    const normalizedTableId = typeof tableId === "string" ? tableId.trim() : "";
    if (!normalizedTableId) {
      return { ok: false, reason: "invalid_table_id" };
    }
    try {
      return await beginSql(async (tx) => {
        await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", ["poker:continuous-bot-supervisor:v1"]);
        const tableRows = await tx.unsafe(
          `select id, rotation_due_at
             from public.poker_tables
            where id = $1
              and status = 'OPEN'
              and lifecycle_kind = 'CONTINUOUS_BOT'
              and managed_profile_key = $2
            for update;`,
          [normalizedTableId, CONTINUOUS_BOT_PROFILE_KEY]
        );
        if (!Array.isArray(tableRows) || tableRows.length !== 1) {
          return { ok: false, reason: "managed_table_not_found" };
        }
        const updatedRows = await tx.unsafe(
          `update public.poker_tables
              set rotation_due_at = least(coalesce(rotation_due_at, now()), now()), updated_at = now()
            where id = $1
            returning id, rotation_due_at;`,
          [normalizedTableId]
        );
        return {
          ok: updatedRows?.length === 1,
          changed: updatedRows?.length === 1 && !tableRows[0]?.rotation_due_at,
          rotationDueAt: updatedRows?.[0]?.rotation_due_at ?? tableRows[0]?.rotation_due_at ?? null,
          reason: updatedRows?.length === 1 ? null : "retirement_request_failed"
        };
      }, { env });
    } catch (error) {
      klog("ws_continuous_bot_table_retirement_persist_failed", {
        tableId: normalizedTableId,
        reason: error?.code || error?.message || "unknown"
      });
      return { ok: false, reason: error?.code || error?.message || "retirement_request_failed" };
    }
  }

  async function postponeRotation(tableId, rotationDueAt) {
    const normalizedTableId = typeof tableId === "string" ? tableId.trim() : "";
    const normalizedDueAt = rotationDueAt instanceof Date
      ? rotationDueAt.toISOString()
      : typeof rotationDueAt === "string" ? rotationDueAt.trim() : "";
    if (!normalizedTableId || !normalizedDueAt || !Number.isFinite(new Date(normalizedDueAt).getTime())) {
      return { ok: false, reason: "invalid_rotation_due_at" };
    }
    try {
      return await beginSql(async (tx) => {
        await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", ["poker:continuous-bot-supervisor:v1"]);
        const updatedRows = await tx.unsafe(
          `update public.poker_tables
              set rotation_due_at = $2, updated_at = now()
            where id = $1
              and status = 'OPEN'
              and lifecycle_kind = 'CONTINUOUS_BOT'
              and managed_profile_key = $3
              and rotation_due_at is not null
              and rotation_due_at <= now()
            returning id, rotation_due_at;`,
          [normalizedTableId, normalizedDueAt, CONTINUOUS_BOT_PROFILE_KEY]
        );
        if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
          return { ok: false, reason: "rotation_not_due" };
        }
        return {
          ok: true,
          changed: true,
          rotationDueAt: new Date(updatedRows[0].rotation_due_at).toISOString()
        };
      }, { env });
    } catch (error) {
      klog("ws_continuous_bot_table_rotation_postpone_failed", {
        tableId: normalizedTableId,
        reason: error?.code || error?.message || "unknown"
      });
      return { ok: false, reason: error?.code || error?.message || "rotation_postpone_failed" };
    }
  }

  return {
    reconcile,
    requestRetirement,
    postponeRotation,
    currentProfile: () => lastKnownProfile
  };
}
