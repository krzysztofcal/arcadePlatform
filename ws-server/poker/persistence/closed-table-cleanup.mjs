// Closed-table retention cleanup.
//
// Removes old CLOSED poker tables whose gameplay/audit data has already been
// retained away and whose terminal accounting is fully settled. This is the
// FINAL stage of the table lifecycle: it runs after the action-history cleanup
// so that poker_actions and poker_hole_cards are gone first, and it requires
// positive proof that the table is safe to delete.
//
// Safety (all enforced inside the same final DELETE statement):
//   - status = 'CLOSED' and updated_at older than the retention cutoff
//     (terminal close sets updated_at = now() in the same transaction);
//   - terminal persisted state (phase = 'HAND_DONE', handId = ''); a missing
//     or malformed state fails closed;
//   - escrow accounting proof (read-only): an active ESCROW chips_account with
//     balance = 0 for 'POKER_TABLE:<id>';
//   - no poker_actions rows;
//   - no poker_hole_cards rows;
//   - no fresh poker_requests (any kind) inside the retention window;
//   - no unfinished durable ACT request (kind = 'ACT' AND result_json IS NULL).
//
// Runtime safety: candidates are atomically claimed through
// tableManager.beginTableRetirement() (synchronous, checks tables and
// pendingBootstrapByTableId). ensureTable/ensureTableLoaded reject claimed ids
// fail-closed, so a candidate cannot be materialized back into the runtime
// between the final runtime check and the DELETE.
//
// Flow: bounded candidate discovery -> runtime claim -> final guarded
// CTE DELETE (FOR UPDATE SKIP LOCKED) -> release in finally.

import { beginSqlWs } from "../bootstrap/persisted-bootstrap-db.mjs";

const DEFAULT_MAX_SWEEP_ROUNDS = 1;
const MAX_SWEEP_ROUNDS = 20;
const DELETE_LOCK_TIMEOUT_MS = 250;
const DELETE_STATEMENT_TIMEOUT_MS = 10_000;
// Closed-table retention is ON by default (7 days) so unbounded CLOSED-table
// growth is bounded without requiring new env configuration. Set
// WS_POKER_CLOSED_TABLE_RETENTION_MS=0 to disable.
const DEFAULT_CLOSED_TABLE_RETENTION_MS = 7 * 86_400_000;

function resolveCutoff(retentionMs) {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) return null;
  return new Date(Date.now() - retentionMs).toISOString();
}

function postgresErrorDetails(error) {
  const text = (value, maxLength) => typeof value === "string" && value.length > 0
    ? value.slice(0, maxLength)
    : null;
  return {
    code: text(error?.code, 40),
    message: text(error?.message, 500),
    detail: text(error?.detail, 1_000),
    where: text(error?.where, 1_000)
  };
}

// Bounded discovery of candidate CLOSED table ids that currently satisfy the
// DB eligibility predicates. Read-only (no row locks).
async function discoverCandidates({ tx, cutoff, batchSize, statementTimeoutMs }) {
  await tx.unsafe("select set_config('statement_timeout', $1, true);", [`${statementTimeoutMs}ms`]);
  const rows = await tx.unsafe(
    `select t.id
       from public.poker_tables t
      where t.status = 'CLOSED'
        and t.updated_at < $1::timestamptz
        and exists (
              select 1 from public.poker_state ps
               where ps.table_id = t.id
                 and jsonb_typeof(ps.state) = 'object'
                 and ps.state ->> 'phase' = 'HAND_DONE'
                 and jsonb_typeof(ps.state -> 'handId') = 'string'
                 and ps.state ->> 'handId' = ''
            )
        and exists (
              select 1 from public.chips_accounts ca
               where ca.system_key = 'POKER_TABLE:' || t.id::text
                 and ca.account_type = 'ESCROW'
                 and ca.status = 'active'
                 and ca.balance = 0
            )
        and not exists (select 1 from public.poker_actions pa where pa.table_id = t.id)
        and not exists (select 1 from public.poker_hole_cards hc where hc.table_id = t.id)
        and not exists (select 1 from public.poker_requests r
                         where r.table_id = t.id
                           and r.created_at >= $1::timestamptz)
        and not exists (select 1 from public.poker_requests r
                         where r.table_id = t.id
                           and r.kind = 'ACT'
                           and r.result_json is null)
      order by t.updated_at
      limit $2;`,
    [cutoff, batchSize]
  );
  return Array.isArray(rows) ? rows.map((row) => row?.id).filter((id) => typeof id === "string") : [];
}

// Final guarded DELETE for claimed ids. Re-validates EVERY eligibility
// predicate in the same statement that takes the row locks, so a claimed id
// that stopped satisfying the guards between discovery and DELETE simply drops
// out (DELETE returns nothing for it). FOR UPDATE SKIP LOCKED skips rows
// locked by other transactions instead of waiting.
async function deleteClaimed({ tx, cutoff, claimedIds, batchSize }) {
  if (!Array.isArray(claimedIds) || claimedIds.length === 0) {
    return { deleted: 0, ids: [] };
  }
  await tx.unsafe("select set_config('lock_timeout', $1, true);", [`${DELETE_LOCK_TIMEOUT_MS}ms`]);
  await tx.unsafe("select set_config('statement_timeout', $1, true);", [`${DELETE_STATEMENT_TIMEOUT_MS}ms`]);
  const rows = await tx.unsafe(
    `with locked as (
  select t.id
    from public.poker_tables t
   where t.id = any($3::uuid[])
     and t.status = 'CLOSED'
     and t.updated_at < $1::timestamptz
     and exists (
           select 1 from public.poker_state ps
            where ps.table_id = t.id
              and jsonb_typeof(ps.state) = 'object'
              and ps.state ->> 'phase' = 'HAND_DONE'
              and jsonb_typeof(ps.state -> 'handId') = 'string'
              and ps.state ->> 'handId' = ''
         )
     and exists (
           select 1 from public.chips_accounts ca
            where ca.system_key = 'POKER_TABLE:' || t.id::text
              and ca.account_type = 'ESCROW'
              and ca.status = 'active'
              and ca.balance = 0
         )
     and not exists (select 1 from public.poker_actions pa where pa.table_id = t.id)
     and not exists (select 1 from public.poker_hole_cards hc where hc.table_id = t.id)
     and not exists (select 1 from public.poker_requests r
                      where r.table_id = t.id
                        and r.created_at >= $1::timestamptz)
     and not exists (select 1 from public.poker_requests r
                      where r.table_id = t.id
                        and r.kind = 'ACT'
                        and r.result_json is null)
   order by t.updated_at
   limit $2
   for update skip locked
)
delete from public.poker_tables t
 using locked l
 where t.id = l.id
returning t.id;`,
    [cutoff, batchSize, claimedIds]
  );
  const ids = Array.isArray(rows) ? rows.map((row) => row?.id).filter((id) => typeof id === "string") : [];
  return { deleted: ids.length, ids };
}

export function createClosedTableCleanup({
  env = process.env,
  maxSweepRounds = DEFAULT_MAX_SWEEP_ROUNDS,
  beginSql = beginSqlWs,
  klog = () => {}
} = {}) {
  function resolveRetentionMs(rawValue, label) {
    if (rawValue === undefined) return DEFAULT_CLOSED_TABLE_RETENTION_MS;
    const num = Number(rawValue);
    if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
      throw new Error(
        `WS_POKER_CLOSED_TABLE_RETENTION_MS must be a finite non-negative integer, got: ${JSON.stringify(rawValue)}`
      );
    }
    return num;
  }

  function resolveBatchSize(rawValue) {
    if (rawValue === undefined) return 20;
    const num = Number(rawValue);
    if (!Number.isFinite(num) || num < 1 || num > 100 || !Number.isInteger(num)) {
      throw new Error(
        `WS_POKER_CLOSED_TABLE_BATCH_SIZE must be an integer 1-100, got: ${JSON.stringify(rawValue)}`
      );
    }
    return num;
  }

  const retentionMs = resolveRetentionMs(env.WS_POKER_CLOSED_TABLE_RETENTION_MS, "CLOSED_TABLE");
  const batchSize = resolveBatchSize(env.WS_POKER_CLOSED_TABLE_BATCH_SIZE);
  const sweepRounds = Number.isInteger(maxSweepRounds)
    && maxSweepRounds >= DEFAULT_MAX_SWEEP_ROUNDS
    && maxSweepRounds <= MAX_SWEEP_ROUNDS
    ? maxSweepRounds
    : DEFAULT_MAX_SWEEP_ROUNDS;

  let sweepInProgress = false;
  let lastRun = null;

  function buildCutoff() {
    return resolveCutoff(retentionMs);
  }

  async function sweep({ claimTableIds = null, releaseTableIds = null } = {}) {
    if (sweepInProgress) {
      return {
        ok: true,
        skipped: true,
        reason: "sweep_in_progress",
        claimed: 0,
        skippedIds: 0,
        deleted: 0,
        failedPhases: []
      };
    }
    sweepInProgress = true;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    let result = null;
    let claimedIds = [];
    try {
      const cutoff = buildCutoff();
      if (!cutoff) {
        result = {
          ok: true,
          skipped: true,
          reason: "cleanup_disabled",
          claimed: 0,
          skippedIds: 0,
          deleted: 0,
          failedPhases: []
        };
        return result;
      }

      let claimedTotal = 0;
      let skippedTotal = 0;
      let deletedTotal = 0;
      const failedPhases = new Set();

      for (let round = 0; round < sweepRounds; round += 1) {
        const candidates = await beginSql((tx) => discoverCandidates({
          tx,
          cutoff,
          batchSize,
          statementTimeoutMs: DELETE_STATEMENT_TIMEOUT_MS
        }), { env });

        if (candidates.length === 0) break;

        const claimed = typeof claimTableIds === "function"
          ? claimTableIds(candidates)
          : { claimed: candidates, skipped: [] };
        const safeClaimed = Array.isArray(claimed?.claimed) ? claimed.claimed : [];
        const safeSkipped = Array.isArray(claimed?.skipped) ? claimed.skipped : [];
        claimedIds.push(...safeClaimed);
        claimedTotal += safeClaimed.length;
        skippedTotal += safeSkipped.length;

        if (safeClaimed.length > 0) {
          try {
            const outcome = await beginSql((tx) => deleteClaimed({
              tx,
              cutoff,
              claimedIds: safeClaimed,
              batchSize
            }), { env });
            deletedTotal += outcome.deleted;
          } catch (error) {
            failedPhases.add("closed_table_delete");
            klog("ws_closed_table_cleanup_failed", {
              errorCode: "closed_table_cleanup_failed",
              failedPhases: ["closed_table_delete"],
              claimed: safeClaimed.length,
              skippedIds: safeSkipped.length,
              deleted: deletedTotal,
              batchSize,
              sweepRounds,
              reason: postgresErrorDetails(error)
            });
            break;
          }
        }
      }

      result = {
        ok: failedPhases.size === 0,
        claimed: claimedTotal,
        skippedIds: skippedTotal,
        deleted: deletedTotal,
        failedPhases: [...failedPhases],
        errorCode: failedPhases.size > 0 ? "closed_table_cleanup_failed" : null,
        skipped: false,
        reason: failedPhases.size > 0 ? "closed_table_cleanup_failed" : null
      };

      if (result.ok && (claimedTotal > 0 || deletedTotal > 0)) {
        klog("ws_closed_table_cleanup_complete", {
          claimed: claimedTotal,
          skippedIds: skippedTotal,
          deleted: deletedTotal,
          batchSize,
          sweepRounds
        });
      } else if (!result.ok) {
        klog("ws_closed_table_cleanup_failed", {
          errorCode: result.errorCode,
          failedPhases: result.failedPhases,
          claimed: claimedTotal,
          skippedIds: skippedTotal,
          deleted: deletedTotal,
          batchSize,
          sweepRounds
        });
      }
      return result;
    } catch (error) {
      result = {
        ok: false,
        claimed: 0,
        skippedIds: 0,
        deleted: 0,
        failedPhases: ["closed_table_cleanup"],
        errorCode: "closed_table_cleanup_failed",
        skipped: false,
        reason: "closed_table_cleanup_failed"
      };
      klog("ws_closed_table_cleanup_failed", {
        errorCode: result.errorCode,
        failedPhases: result.failedPhases,
        claimed: 0,
        skippedIds: 0,
        deleted: 0,
        batchSize,
        sweepRounds,
        reason: postgresErrorDetails(error)
      });
      return result;
    } finally {
      if (typeof releaseTableIds === "function" && claimedIds.length > 0) {
        releaseTableIds(claimedIds);
      }
      sweepInProgress = false;
      lastRun = {
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        claimed: Number(result?.claimed || 0),
        skippedIds: Number(result?.skippedIds || 0),
        deleted: Number(result?.deleted || 0),
        result: result?.ok === true ? (result?.skipped ? "skipped" : "success") : "failed",
        skipped: result?.skipped === true,
        reason: result?.reason || null,
        errorCode: result?.errorCode || null,
        failedPhases: Array.isArray(result?.failedPhases) ? result.failedPhases : []
      };
    }
  }

  async function readBacklog() {
    const cutoff = buildCutoff();
    if (!cutoff) {
      return { available: false, eligibleTables: null, measuredAt: new Date().toISOString() };
    }
    try {
      const rows = await beginSql(async (tx) => {
        await tx.unsafe("select set_config('statement_timeout', '2000ms', true);");
        return tx.unsafe(
          `select count(*)::bigint as eligible
             from public.poker_tables t
            where t.status = 'CLOSED'
              and t.updated_at < $1::timestamptz
              and exists (
                    select 1 from public.poker_state ps
                     where ps.table_id = t.id
                       and jsonb_typeof(ps.state) = 'object'
                       and ps.state ->> 'phase' = 'HAND_DONE'
                       and jsonb_typeof(ps.state -> 'handId') = 'string'
                       and ps.state ->> 'handId' = ''
                  )
              and exists (
                    select 1 from public.chips_accounts ca
                     where ca.system_key = 'POKER_TABLE:' || t.id::text
                       and ca.account_type = 'ESCROW'
                       and ca.status = 'active'
                       and ca.balance = 0
                  )
              and not exists (select 1 from public.poker_actions pa where pa.table_id = t.id)
              and not exists (select 1 from public.poker_hole_cards hc where hc.table_id = t.id)
              and not exists (select 1 from public.poker_requests r
                               where r.table_id = t.id
                                 and r.created_at >= $1::timestamptz)
              and not exists (select 1 from public.poker_requests r
                               where r.table_id = t.id
                                 and r.kind = 'ACT'
                                 and r.result_json is null);`,
          [cutoff]
        );
      }, { env });
      return {
        available: true,
        eligibleTables: Number(rows?.[0]?.eligible || 0),
        measuredAt: new Date().toISOString(),
        cached: false
      };
    } catch (error) {
      return {
        available: false,
        eligibleTables: null,
        measuredAt: new Date().toISOString(),
        cached: false,
        error: String(error?.code || "backlog_query_failed").slice(0, 120)
      };
    }
  }

  async function status() {
    return {
      retentionMs,
      batchSize,
      sweepRounds,
      sweepInProgress,
      lastRun,
      lastError: lastRun?.errorCode ? { code: lastRun.errorCode } : null,
      backlog: await readBacklog()
    };
  }

  return { sweep, status, readBacklog };
}
