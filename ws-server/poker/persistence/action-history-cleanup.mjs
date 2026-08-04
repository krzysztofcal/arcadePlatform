// Action-history retention cleanup.
//
// Bounded three-phase sweep that runs on a timer (see server.mjs).
// The hole-card phase deletes poker_hole_cards for completed hands older than
// the applicable action retention cutoff. Phase 1 deletes ordinary actions
// (everything except HAND_SETTLED). Phase 2 deletes HAND_SETTLED audit rows
// only after both ordinary actions and hole cards are gone.
//
// Retention is per-table: bot-only tables (has_human_participant = false)
// use a short window; tables with human gameplay use a long window.
// A retention value of 0 disables the corresponding category.

import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";

const BACKLOG_CACHE_TTL_MS = 15_000;
const DEFAULT_MAX_SWEEP_ROUNDS = 1;
const MAX_SWEEP_ROUNDS = 20;
// Preview uses bounded repeated batches for stress tests; Production stays at one round.
const CLEANUP_PHASE_ORDER = Object.freeze(["hole_cards", "ordinary_actions", "hand_settled"]);

function resolveCutoff(retentionMs) {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) return null;
  return new Date(Date.now() - retentionMs).toISOString();
}

// Hole-card rows are deleted by unique (table_id, hand_id) candidates. The
// batch bounds hands, while the returned row count reflects all users/cards
// deleted for those hands.
async function sweepHoleCards({ tx, botActionCutoff, humanActionCutoff, batchSize, lockLimit }) {
  const result = await tx.unsafe(
    `with locked_tables as (
  select t.id, t.has_human_participant
    from public.poker_tables t
   where exists (
           select 1
             from public.poker_actions pa
            where pa.table_id = t.id
              and pa.action_type = 'HAND_SETTLED'
              and (
                    (t.has_human_participant = false
                     and $1::timestamptz is not null
                     and pa.created_at < $1::timestamptz)
                 or (t.has_human_participant = true
                     and $2::timestamptz is not null
                     and pa.created_at < $2::timestamptz)
                  )
              and exists (
                    select 1
                      from public.poker_hole_cards hc
                     where hc.table_id = pa.table_id
                       and hc.hand_id = pa.hand_id
                  )
         )
   order by (
     select min(pa2.created_at) from public.poker_actions pa2
      where pa2.table_id = t.id
        and pa2.action_type = 'HAND_SETTLED'
   )
   limit $4
   for update skip locked
), hole_card_candidates as (
  select pa.table_id, pa.hand_id, min(pa.created_at) as created_at
    from public.poker_actions pa
    join locked_tables t on t.id = pa.table_id
   where pa.action_type = 'HAND_SETTLED'
     and (
           (t.has_human_participant = false
            and $1::timestamptz is not null
            and pa.created_at < $1::timestamptz)
        or (t.has_human_participant = true
            and $2::timestamptz is not null
            and pa.created_at < $2::timestamptz)
         )
     and exists (
           select 1
             from public.poker_hole_cards hc
            where hc.table_id = pa.table_id
              and hc.hand_id = pa.hand_id
         )
   group by pa.table_id, pa.hand_id
   order by created_at
   limit $3
)
delete from public.poker_hole_cards hc
 where exists (
   select 1
     from hole_card_candidates ch
    where ch.table_id = hc.table_id
      and ch.hand_id = hc.hand_id
 )
returning hc.table_id, hc.hand_id, hc.user_id;`,
    [botActionCutoff, humanActionCutoff, batchSize, lockLimit]
  );
  return Array.isArray(result) ? result.length : 0;
}

// Phase 1 — delete ordinary actions for completed hands.
//
// Only hands that have a HAND_SETTLED audit row older than the cutoff AND
// still have ordinary action rows are eligible.
async function sweepPhase1({ tx, botActionCutoff, humanActionCutoff, batchSize, lockLimit, klog }) {
  const result = await tx.unsafe(
    `with locked_tables as (
  select t.id, t.has_human_participant
    from public.poker_tables t
   where exists (
           select 1
             from public.poker_actions pa
            where pa.table_id = t.id
              and pa.action_type = 'HAND_SETTLED'
              and (
                    (t.has_human_participant = false
                     and $1::timestamptz is not null
                     and pa.created_at < $1::timestamptz)
                 or (t.has_human_participant = true
                     and $2::timestamptz is not null
                     and pa.created_at < $2::timestamptz)
                  )
              and exists (
                    select 1
                      from public.poker_actions oa
                     where oa.table_id = pa.table_id
                       and oa.hand_id = pa.hand_id
                       and oa.action_type != 'HAND_SETTLED'
                  )
         )
   order by (
     select min(pa2.created_at) from public.poker_actions pa2
      where pa2.table_id = t.id
        and pa2.action_type = 'HAND_SETTLED'
   )
   limit $4
   for update skip locked
),
candidate_hands as (
  select pa.table_id, pa.hand_id, pa.created_at
    from public.poker_actions pa
    join locked_tables t on t.id = pa.table_id
   where pa.action_type = 'HAND_SETTLED'
     and (
           (t.has_human_participant = false
            and $1::timestamptz is not null
            and pa.created_at < $1::timestamptz)
        or (t.has_human_participant = true
            and $2::timestamptz is not null
            and pa.created_at < $2::timestamptz)
         )
     and exists (
           select 1
             from public.poker_actions oa
            where oa.table_id = pa.table_id
              and oa.hand_id = pa.hand_id
              and oa.action_type != 'HAND_SETTLED'
         )
   order by created_at
   limit $3
)
delete from public.poker_actions
 where action_type != 'HAND_SETTLED'
   and (table_id, hand_id) in (
     select table_id, hand_id from candidate_hands
   )
returning id;`,
    [botActionCutoff, humanActionCutoff, batchSize, lockLimit]
  );
  return Array.isArray(result) ? result.length : 0;
}

// Phase 2 — delete HAND_SETTLED rows for hands whose ordinary actions
// have already been cleaned up (no remaining ordinary-action rows).
async function sweepPhase2({ tx, botSettledCutoff, humanSettledCutoff, batchSize, lockLimit, klog }) {
  const result = await tx.unsafe(
    `with locked_tables as (
  select t.id, t.has_human_participant
    from public.poker_tables t
   where exists (
           select 1
             from public.poker_actions pa
            where pa.table_id = t.id
              and pa.action_type = 'HAND_SETTLED'
              and (
                    (t.has_human_participant = false
                     and $1::timestamptz is not null
                     and pa.created_at < $1::timestamptz)
                 or (t.has_human_participant = true
                     and $2::timestamptz is not null
                     and pa.created_at < $2::timestamptz)
                  )
              and not exists (
                    select 1
                      from public.poker_actions oa
                     where oa.table_id = pa.table_id
                       and oa.hand_id = pa.hand_id
                       and oa.action_type != 'HAND_SETTLED'
                  )
              and not exists (
                    select 1
                      from public.poker_hole_cards hc
                     where hc.table_id = pa.table_id
                       and hc.hand_id = pa.hand_id
                  )
         )
   order by (
     select min(pa2.created_at) from public.poker_actions pa2
      where pa2.table_id = t.id
        and pa2.action_type = 'HAND_SETTLED'
   )
   limit $4
   for update skip locked
),
candidates as (
  select pa.id, pa.created_at
    from public.poker_actions pa
    join locked_tables t on t.id = pa.table_id
   where pa.action_type = 'HAND_SETTLED'
     and (
           (t.has_human_participant = false
            and $1::timestamptz is not null
            and pa.created_at < $1::timestamptz)
        or (t.has_human_participant = true
            and $2::timestamptz is not null
            and pa.created_at < $2::timestamptz)
         )
     and not exists (
           select 1
             from public.poker_actions oa
            where oa.table_id = pa.table_id
              and oa.hand_id = pa.hand_id
              and oa.action_type != 'HAND_SETTLED'
         )
     and not exists (
           select 1
             from public.poker_hole_cards hc
            where hc.table_id = pa.table_id
              and hc.hand_id = pa.hand_id
         )
   order by created_at
   limit $3
)
delete from public.poker_actions
 where id in (select id from candidates)
returning id;`,
    [botSettledCutoff, humanSettledCutoff, batchSize, lockLimit]
  );
  return Array.isArray(result) ? result.length : 0;
}

export function createActionHistoryCleanup({
  env = process.env,
  maxSweepRounds = DEFAULT_MAX_SWEEP_ROUNDS,
  beginSql = beginSqlWs,
  klog = () => {}
} = {}) {
  // --- Fail-fast config validation ---------------------------------------

  function resolveRetentionMs(rawValue, label) {
    if (rawValue === undefined) return 0;
    const num = Number(rawValue);
    if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
      throw new Error(
        `WS_POKER_${label}_RETENTION_MS must be a finite non-negative integer, got: ${JSON.stringify(rawValue)}`
      );
    }
    return num;
  }

  const botActionMs = resolveRetentionMs(env.WS_POKER_BOT_ACTION_RETENTION_MS, "BOT_ACTION");
  const botSettledMs = resolveRetentionMs(env.WS_POKER_BOT_SETTLED_RETENTION_MS, "BOT_SETTLED");
  const humanActionMs = resolveRetentionMs(env.WS_POKER_HUMAN_ACTION_RETENTION_MS, "HUMAN_ACTION");
  const humanSettledMs = resolveRetentionMs(env.WS_POKER_HUMAN_SETTLED_RETENTION_MS, "HUMAN_SETTLED");

  function validateRetentionPair(actionMs, settledMs, label) {
    if (actionMs === 0 && settledMs > 0) {
      throw new Error(
        `WS_POKER_${label}_ACTION_RETENTION_MS=0 with WS_POKER_${label}_SETTLED_RETENTION_MS>0 ` +
        "is unsafe: HAND_SETTLED markers would be deleted while ordinary actions remain."
      );
    }
    if (actionMs > 0 && settledMs > 0 && settledMs < actionMs) {
      throw new Error(
        `WS_POKER_${label}_SETTLED_RETENTION_MS must be >= ` +
        `WS_POKER_${label}_ACTION_RETENTION_MS when both are >0.`
      );
    }
  }
  validateRetentionPair(botActionMs, botSettledMs, "BOT");
  validateRetentionPair(humanActionMs, humanSettledMs, "HUMAN");

  function resolveBatchSize(rawValue) {
    if (rawValue === undefined) return 20;
    const num = Number(rawValue);
    if (!Number.isFinite(num) || num < 1 || num > 100 || !Number.isInteger(num)) {
      throw new Error(
        `WS_POKER_ACTION_HISTORY_BATCH_SIZE must be an integer 1-100, got: ${JSON.stringify(rawValue)}`
      );
    }
    return num;
  }

  const batchSize = resolveBatchSize(env.WS_POKER_ACTION_HISTORY_BATCH_SIZE);
  const lockLimit = batchSize * 2;
  const sweepRounds = Number.isInteger(maxSweepRounds)
    && maxSweepRounds >= DEFAULT_MAX_SWEEP_ROUNDS
    && maxSweepRounds <= MAX_SWEEP_ROUNDS
    ? maxSweepRounds
    : DEFAULT_MAX_SWEEP_ROUNDS;

  function buildCutoffs() {

    return {
      botActionCutoff: resolveCutoff(botActionMs),
      botSettledCutoff: resolveCutoff(botSettledMs),
      humanActionCutoff: resolveCutoff(humanActionMs),
      humanSettledCutoff: resolveCutoff(humanSettledMs),
      botActionEnabled: botActionMs > 0,
      humanActionEnabled: humanActionMs > 0,
      botSettledEnabled: botSettledMs > 0,
      humanSettledEnabled: humanSettledMs > 0
    };
  }

  let sweepInProgress = false;
  let lastRun = null;
  let backlogCache = null;

  function orderedFailedPhases(failedPhases) {
    return CLEANUP_PHASE_ORDER.filter((phase) => failedPhases.has(phase));
  }

  function primaryErrorCode(failedPhases) {
    if (failedPhases.has("ordinary_actions")) return "ordinary_actions_cleanup_failed";
    if (failedPhases.has("hand_settled")) return "hand_settled_cleanup_failed";
    if (failedPhases.has("hole_cards")) return "hole_cards_cleanup_failed";
    return null;
  }

  async function readBacklog(cutoffs) {
    const nowMs = Date.now();
    if (backlogCache && nowMs - backlogCache.measuredAtMs < BACKLOG_CACHE_TTL_MS) {
      return { ...backlogCache.value, cached: true };
    }
    try {
      const value = await beginSql(async (tx) => {
        await tx.unsafe("select set_config('statement_timeout', '2000ms', true);");
        const rows = await tx.unsafe(
          `with phase1_locked_tables as (
  select t.id, t.has_human_participant
    from public.poker_tables t
   where exists (
           select 1 from public.poker_actions pa
            where pa.table_id = t.id
              and pa.action_type = 'HAND_SETTLED'
              and (
                    (t.has_human_participant = false and $1::timestamptz is not null and pa.created_at < $1::timestamptz)
                 or (t.has_human_participant = true and $2::timestamptz is not null and pa.created_at < $2::timestamptz)
                  )
              and exists (
                    select 1 from public.poker_actions oa
                     where oa.table_id = pa.table_id
                       and oa.hand_id = pa.hand_id
                       and oa.action_type != 'HAND_SETTLED'
                  )
         )
   order by (select min(pa2.created_at) from public.poker_actions pa2
              where pa2.table_id = t.id and pa2.action_type = 'HAND_SETTLED')
   limit $6
), phase1_hands as (
  select pa.table_id, pa.hand_id
    from public.poker_actions pa
    join phase1_locked_tables t on t.id = pa.table_id
   where pa.action_type = 'HAND_SETTLED'
     and (
           (t.has_human_participant = false and $1::timestamptz is not null and pa.created_at < $1::timestamptz)
        or (t.has_human_participant = true and $2::timestamptz is not null and pa.created_at < $2::timestamptz)
         )
     and exists (
           select 1 from public.poker_actions oa
            where oa.table_id = pa.table_id and oa.hand_id = pa.hand_id and oa.action_type != 'HAND_SETTLED'
         )
   order by pa.created_at
   limit $3
), phase2_locked_tables as (
  select t.id, t.has_human_participant
    from public.poker_tables t
   where exists (
           select 1 from public.poker_actions pa
            where pa.table_id = t.id
              and pa.action_type = 'HAND_SETTLED'
              and (
                    (t.has_human_participant = false and $4::timestamptz is not null and pa.created_at < $4::timestamptz)
                 or (t.has_human_participant = true and $5::timestamptz is not null and pa.created_at < $5::timestamptz)
                  )
              and not exists (
                    select 1 from public.poker_actions oa
                     where oa.table_id = pa.table_id
                       and oa.hand_id = pa.hand_id
                       and oa.action_type != 'HAND_SETTLED'
                  )
              and not exists (
                    select 1 from public.poker_hole_cards hc
                     where hc.table_id = pa.table_id
                       and hc.hand_id = pa.hand_id
                  )
         )
   order by (select min(pa2.created_at) from public.poker_actions pa2
              where pa2.table_id = t.id and pa2.action_type = 'HAND_SETTLED')
   limit $6
), phase2_hands as (
  select pa.id
    from public.poker_actions pa
    join phase2_locked_tables t on t.id = pa.table_id
   where pa.action_type = 'HAND_SETTLED'
     and (
           (t.has_human_participant = false and $4::timestamptz is not null and pa.created_at < $4::timestamptz)
        or (t.has_human_participant = true and $5::timestamptz is not null and pa.created_at < $5::timestamptz)
         )
     and not exists (
           select 1 from public.poker_actions oa
            where oa.table_id = pa.table_id and oa.hand_id = pa.hand_id and oa.action_type != 'HAND_SETTLED'
         )
     and not exists (
           select 1 from public.poker_hole_cards hc
            where hc.table_id = pa.table_id and hc.hand_id = pa.hand_id
         )
   order by pa.created_at
   limit $3
)
select
  (select count(*)::bigint from public.poker_actions oa
    join phase1_hands h on h.table_id = oa.table_id and h.hand_id = oa.hand_id
   where oa.action_type != 'HAND_SETTLED') as ordinary_action_rows,
  (select count(*)::bigint from phase2_hands) as hand_settled_rows;`,
          [
            cutoffs.botActionCutoff,
            cutoffs.humanActionCutoff,
            batchSize,
            cutoffs.botSettledCutoff,
            cutoffs.humanSettledCutoff,
            lockLimit
          ]
        );
        const row = rows?.[0] || {};
        return {
          available: true,
          ordinaryActionRows: Number(row.ordinary_action_rows || 0),
          handSettledRows: Number(row.hand_settled_rows || 0),
          measuredAt: new Date().toISOString(),
          cappedAtBatchSize: true,
          cached: false
        };
      }, { env });
      backlogCache = { measuredAtMs: nowMs, value };
      return value;
    } catch (error) {
      return {
        available: false,
        ordinaryActionRows: null,
        handSettledRows: null,
        measuredAt: new Date().toISOString(),
        cached: false,
        error: String(error?.code || "backlog_query_failed").slice(0, 120)
      };
    }
  }

  async function sweep() {
    if (sweepInProgress) {
      return {
        ok: true,
        holeCardsDeleted: 0,
        phase1Deleted: 0,
        phase2Deleted: 0,
        failedPhases: [],
        skipped: true,
        reason: "sweep_in_progress"
      };
    }
    sweepInProgress = true;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    let result = null;
    try {
      const cutoffs = buildCutoffs();
      const anyEnabled = cutoffs.botActionEnabled || cutoffs.humanActionEnabled
        || cutoffs.botSettledEnabled || cutoffs.humanSettledEnabled;
      if (!anyEnabled) {
        result = {
          ok: true,
          holeCardsDeleted: 0,
          phase1Deleted: 0,
          phase2Deleted: 0,
          failedPhases: [],
          skipped: true,
          reason: "cleanup_disabled"
        };
        return result;
      }

      let holeCardsDeleted = 0;
      let phase1Deleted = 0;
      let phase2Deleted = 0;
      let holeCardsPhaseEnabledForSweep = cutoffs.botActionEnabled || cutoffs.humanActionEnabled;
      const failedPhases = new Set();

      for (let round = 0; round < sweepRounds; round += 1) {
        let holeCardsRoundDeleted = 0;
        if (holeCardsPhaseEnabledForSweep) {
          try {
            holeCardsRoundDeleted = await beginSql((tx) => sweepHoleCards({
              tx,
              botActionCutoff: cutoffs.botActionCutoff,
              humanActionCutoff: cutoffs.humanActionCutoff,
              batchSize,
              lockLimit
            }), { env });
            holeCardsDeleted += holeCardsRoundDeleted;
          } catch (_error) {
            failedPhases.add("hole_cards");
            holeCardsPhaseEnabledForSweep = false;
          }
        }

        let phase1RoundDeleted = 0;
        try {
          phase1RoundDeleted = await beginSql((tx) => sweepPhase1({
            tx,
            botActionCutoff: cutoffs.botActionCutoff,
            humanActionCutoff: cutoffs.humanActionCutoff,
            batchSize,
            lockLimit,
            klog
          }), { env });
          phase1Deleted += phase1RoundDeleted;
        } catch (_error) {
          failedPhases.add("ordinary_actions");
          break;
        }

        let phase2RoundDeleted = 0;
        try {
          phase2RoundDeleted = await beginSql((tx) => sweepPhase2({
            tx,
            botSettledCutoff: cutoffs.botSettledCutoff,
            humanSettledCutoff: cutoffs.humanSettledCutoff,
            batchSize,
            lockLimit,
            klog
          }), { env });
          phase2Deleted += phase2RoundDeleted;
        } catch (_error) {
          failedPhases.add("hand_settled");
          break;
        }

        if (holeCardsRoundDeleted === 0 && phase1RoundDeleted === 0 && phase2RoundDeleted === 0) break;
      }

      const orderedPhases = orderedFailedPhases(failedPhases);
      const errorCode = primaryErrorCode(failedPhases);
      result = {
        ok: orderedPhases.length === 0,
        holeCardsDeleted,
        phase1Deleted,
        phase2Deleted,
        failedPhases: orderedPhases,
        errorCode,
        skipped: false,
        reason: errorCode
      };

      if (result.ok && (holeCardsDeleted > 0 || phase1Deleted > 0 || phase2Deleted > 0)) {
        klog("ws_action_history_cleanup_complete", {
          holeCardsDeleted,
          phase1Deleted,
          phase2Deleted,
          batchSize,
          lockLimit,
          sweepRounds
        });
      } else if (!result.ok) {
        klog("ws_action_history_cleanup_failed", {
          errorCode,
          failedPhases: orderedPhases,
          holeCardsDeleted,
          phase1Deleted,
          phase2Deleted,
          batchSize,
          lockLimit,
          sweepRounds
        });
      }
      return result;
    } catch (_error) {
      result = {
        ok: false,
        holeCardsDeleted: 0,
        phase1Deleted: 0,
        phase2Deleted: 0,
        failedPhases: ["ordinary_actions"],
        errorCode: "ordinary_actions_cleanup_failed",
        skipped: false,
        reason: "ordinary_actions_cleanup_failed"
      };
      klog("ws_action_history_cleanup_failed", {
        errorCode: result.errorCode,
        failedPhases: result.failedPhases,
        holeCardsDeleted: 0,
        phase1Deleted: 0,
        phase2Deleted: 0,
        batchSize,
        lockLimit,
        sweepRounds
      });
      return result;
    } finally {
      sweepInProgress = false;
      const finishedAt = new Date().toISOString();
      lastRun = {
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        holeCardsDeleted: Number(result?.holeCardsDeleted || 0),
        phase1Deleted: Number(result?.phase1Deleted || 0),
        phase2Deleted: Number(result?.phase2Deleted || 0),
        result: result?.ok === true ? (result?.skipped ? "skipped" : "success") : "failed",
        skipped: result?.skipped === true,
        reason: result?.reason || null,
        errorCode: result?.errorCode || null,
        failedPhases: Array.isArray(result?.failedPhases) ? result.failedPhases : []
      };
    }
  }

  async function status() {
    const cutoffs = buildCutoffs();
    return {
      retention: {
        botActionsMs: botActionMs,
        botSettledMs,
        humanActionsMs: humanActionMs,
        humanSettledMs: humanSettledMs
      },
      batchSize,
      sweepRounds,
      sweepInProgress,
      lastRun,
      lastError: lastRun?.errorCode ? { code: lastRun.errorCode } : null,
      backlog: await readBacklog(cutoffs)
    };
  }

  return { sweep, status, readBacklog };
}
