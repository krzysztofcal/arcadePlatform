// Action-history retention cleanup.
//
// Two-phase sweep that runs on a timer (see server.mjs).
// Phase 1 deletes ordinary actions (everything except HAND_SETTLED)
// for completed hands older than the applicable retention cutoff.
// Phase 2 deletes HAND_SETTLED audit rows for hands whose ordinary
// actions have already been cleaned up.
//
// Retention is per-table: bot-only tables (has_human_participant = false)
// use a short window; tables with human gameplay use a long window.
// A retention value of 0 disables the corresponding category.

import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";

function resolveCutoff(retentionMs) {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) return null;
  return new Date(Date.now() - retentionMs).toISOString();
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

  async function sweep() {
    if (sweepInProgress) return { ok: true, phase1Deleted: 0, phase2Deleted: 0, skipped: true, reason: "sweep_in_progress" };
    sweepInProgress = true;
    try {
      const cutoffs = buildCutoffs();
      const anyEnabled = cutoffs.botActionEnabled || cutoffs.humanActionEnabled
        || cutoffs.botSettledEnabled || cutoffs.humanSettledEnabled;
      if (!anyEnabled) return { ok: true, phase1Deleted: 0, phase2Deleted: 0, skipped: true };

      try {
        return await beginSql(async (tx) => {
        // Phase 1 — ordinary actions (must run before Phase 2)
        const phase1Deleted = await sweepPhase1({
          tx,
          botActionCutoff: cutoffs.botActionCutoff,
          humanActionCutoff: cutoffs.humanActionCutoff,
          batchSize,
          lockLimit,
          klog
        });

        // Phase 2 — HAND_SETTLED rows whose ordinary actions are already gone
        const phase2Deleted = await sweepPhase2({
          tx,
          botSettledCutoff: cutoffs.botSettledCutoff,
          humanSettledCutoff: cutoffs.humanSettledCutoff,
          batchSize,
          lockLimit,
          klog
        });

        if (phase1Deleted > 0 || phase2Deleted > 0) {
          klog("ws_action_history_cleanup_complete", {
            phase1Deleted,
            phase2Deleted,
            batchSize,
            lockLimit
          });
        }

        return { ok: true, phase1Deleted, phase2Deleted };
      }, { env });
    } catch (error) {
      klog("ws_action_history_cleanup_failed", {
        reason: error?.code || error?.message || "unknown"
      });
      return { ok: false, phase1Deleted: 0, phase2Deleted: 0, reason: error?.message };
    }
    } finally {
      sweepInProgress = false;
    }
  }

  return { sweep };
}
