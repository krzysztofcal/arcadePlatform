import { baseHeaders, beginSql, klog } from "./_shared/supabase-admin.mjs";
import {
  PRESENCE_TTL_SEC,
  TABLE_EMPTY_CLOSE_SEC,
  TABLE_SINGLETON_CLOSE_SEC,
  TABLE_BOT_ONLY_CLOSE_SEC,
  isValidUuid,
} from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { isHoleCardsTableMissing } from "./_shared/poker-hole-cards-store.mjs";
import { postHandSettlementToLedger } from "./_shared/poker-ledger-settlement.mjs";
import { cashoutBotSeatIfNeeded, ensureBotSeatInactiveForCashout } from "./_shared/poker-bot-cashout.mjs";
import { hasActiveHumanGuardSql, tableIdleCutoffExprSql } from "./_shared/poker-table-lifecycle.mjs";
import { isMemoryStore, store } from "./_shared/store-upstash.mjs";

const STALE_PENDING_CUTOFF_MINUTES = 10;
const STALE_PENDING_LIMIT = 500;
const OLD_REQUESTS_LIMIT = 1000;
const EXPIRED_SEATS_LIMIT = 200;
const CLOSE_CASHOUT_TABLES_LIMIT = 25;
const SWEEP_LOCK_KEY = "poker:sweep:lock:v1";
const SWEEP_LOCK_TTL_SEC = 90;

const SWEEP_LOCK_SCRIPT = `
local key = KEYS[1]
local token = ARGV[1]
local ttlSec = tonumber(ARGV[2])
local locked = redis.call('SET', key, token, 'EX', ttlSec, 'NX')
if locked then
  return 1
end
return 0
`;

const SWEEP_UNLOCK_SCRIPT = `
local key = KEYS[1]
local token = ARGV[1]
if redis.call('GET', key) == token then
  return redis.call('DEL', key)
end
return 0
`;

const normalizeNonNegativeInt = (n) =>
  Number.isInteger(n) && n >= 0 && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;

const normalizeState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};

const asPositiveWhole = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (Math.trunc(parsed) !== parsed) return 0;
  if (parsed <= 0) return 0;
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return 0;
  return parsed;
};

const parseTableIdFromSystemKey = (systemKey) => {
  const value = String(systemKey || "");
  return value.startsWith("POKER_TABLE:") ? value.slice("POKER_TABLE:".length) : null;
};

const acquireSweepLock = async (token) => {
  if (isMemoryStore) {
    const existing = await store.get(SWEEP_LOCK_KEY);
    if (existing) return false;
    await store.setex(SWEEP_LOCK_KEY, SWEEP_LOCK_TTL_SEC, token);
    return true;
  }
  const result = await store.eval(SWEEP_LOCK_SCRIPT, [SWEEP_LOCK_KEY], [token, String(SWEEP_LOCK_TTL_SEC)]);
  return Number(result) === 1;
};

const releaseSweepLock = async (token) => {
  if (isMemoryStore) {
    const current = await store.get(SWEEP_LOCK_KEY);
    if (current && current === token) {
      await store.setex(SWEEP_LOCK_KEY, 0, "released");
    }
    return;
  }
  await store.eval(SWEEP_UNLOCK_SCRIPT, [SWEEP_LOCK_KEY], [token]);
};

const remediateOrphanEscrow = async ({ tableId, escrowBalance, sweepActorUserId }) => {
  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  return beginSql(async (tx) => {
    const accountRows = await tx.unsafe(
      "select balance from public.chips_accounts where account_type = 'ESCROW' and system_key = $1 limit 1 for update;",
      [escrowSystemKey]
    );
    const account = accountRows?.[0] || null;
    const lockedEscrowBalance = asPositiveWhole(account?.balance);
    if (lockedEscrowBalance <= 0) {
      return { action: "skip", reason: "already_zero", escrowBalance: 0 };
    }

    const activeSeatRows = await tx.unsafe(
      "select 1 from public.poker_seats where table_id = $1 and status = 'ACTIVE' limit 1;",
      [tableId]
    );
    if (Array.isArray(activeSeatRows) && activeSeatRows.length > 0) {
      return { action: "skip", reason: "active_seats_present", escrowBalance: lockedEscrowBalance };
    }

    const seatRows = await tx.unsafe(
      "select user_id, stack from public.poker_seats where table_id = $1 for update;",
      [tableId]
    );

    const owedByUser = new Map();
    for (const row of seatRows || []) {
      const userId = row?.user_id;
      if (!userId) continue;
      const stack = asPositiveWhole(row?.stack);
      if (stack <= 0) continue;
      owedByUser.set(userId, (owedByUser.get(userId) || 0) + stack);
    }

    if (owedByUser.size > 0) {
      let cashedOutTotal = 0;
      for (const [userId, owed] of owedByUser.entries()) {
        await postTransaction({
          userId,
          txType: "TABLE_CASH_OUT",
          idempotencyKey: `poker:orphan_cashout:${tableId}:${userId}:v1`,
          reference: `table:${tableId}`,
          metadata: { tableId, reason: "orphan_escrow_remediation" },
          entries: [
            { accountType: "ESCROW", systemKey: escrowSystemKey, amount: -owed },
            { accountType: "USER", amount: owed },
          ],
          createdBy: userId,
          tx,
        });
        cashedOutTotal += owed;
      }

      await tx.unsafe("update public.poker_seats set stack = 0, status = 'INACTIVE' where table_id = $1 and stack > 0;", [tableId]);

      return {
        action: "remediated",
        usersCashedOut: owedByUser.size,
        cashoutTotal: cashedOutTotal,
        escrowBalance: lockedEscrowBalance,
      };
    }

    if (!sweepActorUserId) {
      return { action: "skip", reason: "quarantine_missing_actor", escrowBalance: lockedEscrowBalance };
    }

    await postTransaction({
      userId: sweepActorUserId,
      txType: "TABLE_CASH_OUT",
      idempotencyKey: `poker:orphan_quarantine:${tableId}:v1`,
      reference: `table:${tableId}`,
      metadata: { tableId, reason: "orphan_escrow_quarantine" },
      entries: [
        { accountType: "ESCROW", systemKey: escrowSystemKey, amount: -lockedEscrowBalance },
        { accountType: "USER", amount: lockedEscrowBalance },
      ],
      createdBy: sweepActorUserId,
      tx,
    });

    return { action: "quarantined", escrowBalance: lockedEscrowBalance, userId: sweepActorUserId };
  });
};


const getSweepActorUserIdOrNull = () => {
  const actorUserId = String(process.env.POKER_SYSTEM_ACTOR_USER_ID || "").trim();
  return isValidUuid(actorUserId) ? actorUserId : null;
};

const isExpiredSeat = (value) => {
  const lastSeenMs =
    typeof value === "string" ? Date.parse(value) : value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(lastSeenMs)) return false;
  return Date.now() - lastSeenMs > PRESENCE_TTL_SEC * 1000;
};

const TABLE_IDLE_EXPR_SQL = tableIdleCutoffExprSql({ tableAlias: "t" });
const ACTIVE_HUMAN_GUARD_SQL = hasActiveHumanGuardSql({ tableAlias: "t" });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: baseHeaders(), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const sweepSecret = process.env.POKER_SWEEP_SECRET;
  if (!sweepSecret) {
    return { statusCode: 500, headers: baseHeaders(), body: JSON.stringify({ error: "sweep_secret_missing" }) };
  }

  const headerSecret = event.headers?.["x-sweep-secret"] || event.headers?.["X-Sweep-Secret"];
  if (!headerSecret || headerSecret !== sweepSecret) {
    return { statusCode: 401, headers: baseHeaders(), body: JSON.stringify({ error: "unauthorized" }) };
  }

  const sweepActorUserId = getSweepActorUserIdOrNull();
  if (!sweepActorUserId) {
    klog("poker_sweep_bot_cashout_disabled_missing_actor", {
      hasActorEnv: Boolean(process.env.POKER_SYSTEM_ACTOR_USER_ID),
    });
  }

  const lockToken = `sweep-${Date.now()}-${process.pid || 0}`;
  let lockAcquired = false;
  try {
    lockAcquired = await acquireSweepLock(lockToken);
    if (!lockAcquired) {
      klog("poker_sweep_skip_locked", { lockKey: SWEEP_LOCK_KEY, lockTtlSec: SWEEP_LOCK_TTL_SEC });
      return {
        statusCode: 200,
        headers: baseHeaders(),
        body: JSON.stringify({ ok: true, skipped: "locked" }),
      };
    }

    const result = await beginSql(async (tx) => {
      const cleanupRows = await tx.unsafe(
        `with candidates as (
          select ctid
          from public.poker_requests
          where result_json is null
            and created_at is not null
            and created_at < now() - ($1::int * interval '1 minute')
          limit $2
        )
        delete from public.poker_requests
        where ctid in (select ctid from candidates)
        returning 1;`,
        [STALE_PENDING_CUTOFF_MINUTES, STALE_PENDING_LIMIT]
      );
      const cleanupCount = Array.isArray(cleanupRows) ? cleanupRows.length : 0;

      const expiredRows = await tx.unsafe(
        `select table_id, user_id, seat_no, stack, last_seen_at
         from public.poker_seats
         where status = 'ACTIVE'
           and last_seen_at < now() - ($1::int * interval '1 second')
         order by last_seen_at asc
         limit $2;`,
        [PRESENCE_TTL_SEC, EXPIRED_SEATS_LIMIT]
      );

      await tx.unsafe(
        `with candidates as (
          select ctid
          from public.poker_requests
          where created_at < now() - interval '24 hours'
          limit $1
        )
        delete from public.poker_requests
        where ctid in (select ctid from candidates);`,
        [OLD_REQUESTS_LIMIT]
      );
      return { cleanupCount, expiredRows };
    });

    if (result.cleanupCount > 0) {
      klog("poker_requests_cleanup", {
        deleted: result.cleanupCount,
        cutoffMinutes: STALE_PENDING_CUTOFF_MINUTES,
        limit: STALE_PENDING_LIMIT,
      });
    }

    const expiredSeats = Array.isArray(result.expiredRows) ? result.expiredRows : [];
    if (expiredSeats.length === EXPIRED_SEATS_LIMIT) {
      klog("poker_sweep_expired_seats_capped", { limit: EXPIRED_SEATS_LIMIT, returned: expiredSeats.length });
    }
    let expiredCount = 0;
    for (const seat of expiredSeats) {
      const tableId = seat?.table_id;
      const userId = seat?.user_id;
      if (!tableId || !userId) continue;
      try {
        const processed = await beginSql(async (tx) => {
          const lockedRows = await tx.unsafe(
            "select seat_no, status, stack, last_seen_at, is_bot from public.poker_seats where table_id = $1 and user_id = $2 for update;",
            [tableId, userId]
          );
          const locked = lockedRows?.[0] || null;
          if (!locked || locked.status !== "ACTIVE") {
            return { skipped: true, seatNo: locked?.seat_no ?? null };
          }
          if (!isExpiredSeat(locked.last_seen_at)) {
            return { skipped: true, seatNo: locked.seat_no };
          }

          const stateRows = await tx.unsafe("select state from public.poker_state where table_id = $1 for update;", [tableId]);
          const stateRow = stateRows?.[0] || null;
          const currentState = normalizeState(stateRow?.state);
          const handSettlement =
            currentState?.handSettlement && typeof currentState.handSettlement === "object"
              ? currentState.handSettlement
              : null;
          const usableSettlement =
            Boolean(handSettlement?.handId) &&
            handSettlement?.payouts &&
            typeof handSettlement.payouts === "object" &&
            !Array.isArray(handSettlement.payouts);
          const stateStack = normalizeNonNegativeInt(Number(currentState?.stacks?.[userId]));
          const seatStack = normalizeNonNegativeInt(Number(locked.stack));
          const amount = usableSettlement ? 0 : stateStack ?? seatStack ?? 0;
          const stackSource = usableSettlement
            ? "settlement"
            : stateStack != null
              ? "state"
              : seatStack != null
                ? "seat"
                : "none";

          let effectiveAmount = amount;
          let safeToClearStateStack = false;
          let botResult = null;
          if (usableSettlement) {
            try {
              await postHandSettlementToLedger({ tableId, handSettlement, postTransaction, klog, tx });
              safeToClearStateStack = true;
            } catch (error) {
              klog("poker_settlement_ledger_post_failed", {
                tableId,
                handId: handSettlement?.handId || null,
                error: error?.message || "unknown_error",
                source: "timeout_cashout",
              });
              return { skipped: true, seatNo: locked.seat_no, reason: "settlement_post_failed" };
            }
          } else if (locked?.is_bot === true) {
            const inactiveResult = await ensureBotSeatInactiveForCashout(tx, { tableId, botUserId: userId });
            if (!inactiveResult?.ok) {
              klog("poker_timeout_cashout_bot_skip", {
                tableId,
                userId,
                seatNo: locked.seat_no ?? null,
                reason: inactiveResult?.reason || "bot_inactive_failed",
              });
              return {
                skipped: true,
                seatNo: locked.seat_no ?? null,
                reason: inactiveResult?.reason || "bot_inactive_failed",
                isBot: true,
                amount: 0,
                stackSource,
              };
            }
            const botStatusRows = await tx.unsafe(
              "select status, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update;",
              [tableId, userId]
            );
            const botStatus = botStatusRows?.[0] || null;
            if (botStatus?.status === "ACTIVE") {
              await tx.unsafe(
                "update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true and status = 'ACTIVE';",
                [tableId, userId]
              );
              const botStatusAfterRows = await tx.unsafe(
                "select status, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update;",
                [tableId, userId]
              );
              const botStatusAfter = botStatusAfterRows?.[0] || null;
              if (botStatusAfter?.status === "ACTIVE") {
                klog("poker_timeout_cashout_bot_skip", {
                  tableId,
                  userId,
                  seatNo: locked.seat_no ?? null,
                  reason: "failed_to_inactivate",
                });
                return { skipped: true, seatNo: locked.seat_no ?? null, reason: "failed_to_inactivate", isBot: true, amount: 0, stackSource };
              }
            }
            if (!sweepActorUserId) {
              klog("poker_timeout_cashout_bot_skip", {
                tableId,
                userId,
                seatNo: locked.seat_no ?? null,
                reason: "missing_actor",
              });
              return { skipped: true, seatNo: locked.seat_no ?? null, reason: "missing_actor", isBot: true, amount: 0, stackSource };
            }
            try {
              botResult = await cashoutBotSeatIfNeeded(tx, {
                tableId,
                botUserId: userId,
                seatNo: locked.seat_no,
                reason: "SWEEP_TIMEOUT",
                actorUserId: sweepActorUserId,
                idempotencyKeySuffix: "timeout_cashout:v1",
                expectedAmount: amount,
              });
              effectiveAmount = botResult?.amount > 0 ? botResult.amount : 0;
              safeToClearStateStack = botResult?.cashedOut === true;
              if (!safeToClearStateStack && botResult?.reason === "non_positive_stack") {
                safeToClearStateStack = (stateStack ?? 0) === 0;
              }
            } catch (error) {
              klog("poker_timeout_cashout_bot_fail", {
                tableId,
                userId,
                seatNo: locked.seat_no ?? null,
                error: error?.message || "unknown_error",
              });
              if (error && typeof error === "object") {
                error.botTimeoutCashoutLogged = true;
              }
              throw error;
            }
          } else if (amount > 0) {
            await postTransaction({
              userId,
              txType: "TABLE_CASH_OUT",
              idempotencyKey: `poker:timeout_cashout:${tableId}:${userId}:${locked.seat_no}:v1`,
              reference: `table:${tableId}`,
              metadata: { tableId, seatNo: locked.seat_no, reason: "timeout_inactive", stackSource },
              entries: [
                { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -amount },
                { accountType: "USER", amount },
              ],
              createdBy: userId,
              tx,
            });
            safeToClearStateStack = true;
          }

          if (locked?.is_bot !== true) {
            await tx.unsafe(
              "update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and user_id = $2;",
              [tableId, userId]
            );
          }

          if (safeToClearStateStack && stateRow && currentState?.stacks && typeof currentState.stacks === "object") {
            const nextStacks = { ...currentState.stacks };
            if (Object.prototype.hasOwnProperty.call(nextStacks, userId)) {
              delete nextStacks[userId];
              const nextState = { ...currentState, stacks: nextStacks };
              await tx.unsafe("update public.poker_state set state = $2 where table_id = $1;", [tableId, JSON.stringify(nextState)]);
            }
          }

          return { seatNo: locked.seat_no, amount: effectiveAmount, stackSource, isBot: locked?.is_bot === true, botCashedOut: botResult?.cashedOut === true };
        });

        if (processed?.skipped) {
          continue;
        }
        expiredCount += 1;
        if (processed?.isBot === true) {
          if (processed?.botCashedOut === true) {
            klog("poker_timeout_cashout_bot_ok", {
              tableId,
              userId,
              seatNo: processed.seatNo ?? null,
              amount: processed.amount,
              stackSource: processed.stackSource ?? "none",
            });
          } else {
            klog("poker_timeout_cashout_bot_skip", {
              tableId,
              userId,
              seatNo: processed?.seatNo ?? null,
              amount: processed?.amount ?? 0,
              stackSource: processed?.stackSource ?? "none",
            });
          }
        } else if (processed?.amount > 0) {
          klog("poker_timeout_cashout_ok", {
            tableId,
            userId,
            seatNo: processed.seatNo ?? null,
            amount: processed.amount,
            stackSource: processed.stackSource ?? "none",
          });
        } else {
          klog("poker_timeout_cashout_skip", {
            tableId,
            userId,
            seatNo: processed?.seatNo ?? null,
            amount: processed?.amount ?? 0,
            stackSource: processed?.stackSource ?? "none",
          });
        }
      } catch (error) {
        if (!error?.botTimeoutCashoutLogged) {
          klog("poker_timeout_cashout_fail", {
            tableId,
            userId,
            seatNo: seat?.seat_no ?? null,
            error: error?.message || "unknown_error",
          });
        }
      }
    }
    klog("poker_sweep_timeout_summary", {
      scanned: expiredSeats.length,
      processed: expiredCount,
      limit: EXPIRED_SEATS_LIMIT,
    });

    const singletonClosedResult = await beginSql(async (tx) => {
      const singletonClosedRows = await tx.unsafe(
        `
with singleton_tables as (
  select t.id
  from public.poker_tables t
  join public.poker_seats s
    on s.table_id = t.id
   and s.status = 'ACTIVE'
  where t.status != 'CLOSED'
    and ${TABLE_IDLE_EXPR_SQL} < now() - ($1::int * interval '1 second')
    and ${ACTIVE_HUMAN_GUARD_SQL}
  group by t.id
  having count(*) = 1
  order by min(s.last_seen_at) asc nulls last
  limit $2
)
update public.poker_tables t
set status = 'CLOSED', updated_at = now()
from singleton_tables st
where t.id = st.id
returning t.id;`,
        [TABLE_SINGLETON_CLOSE_SEC, CLOSE_CASHOUT_TABLES_LIMIT]
      );
      const botOnlyClosedRows = await tx.unsafe(
        `
with bot_only_tables as (
  select t.id
  from public.poker_tables t
  where t.status = 'OPEN'
    and ${TABLE_IDLE_EXPR_SQL} < now() - ($1::int * interval '1 second')
    and ${ACTIVE_HUMAN_GUARD_SQL}
    and exists (
      select 1
      from public.poker_seats bs
      where bs.table_id = t.id
        and bs.status = 'ACTIVE'
        and bs.is_bot = true
    )
  order by ${TABLE_IDLE_EXPR_SQL} asc nulls first
  limit $2
)
update public.poker_tables t
set status = 'CLOSED', updated_at = now()
from bot_only_tables bt
where t.id = bt.id
returning t.id;`,
        [TABLE_BOT_ONLY_CLOSE_SEC, CLOSE_CASHOUT_TABLES_LIMIT]
      );
      const singletonClosedTableIds = Array.isArray(singletonClosedRows)
        ? singletonClosedRows.map((row) => row?.id).filter(Boolean)
        : [];
      const botOnlyClosedTableIds = Array.isArray(botOnlyClosedRows)
        ? botOnlyClosedRows.map((row) => row?.id).filter(Boolean)
        : [];
      const closedTableIds = [...new Set([...singletonClosedTableIds, ...botOnlyClosedTableIds])];
      if (closedTableIds.length) {
        await tx.unsafe(
          "update public.poker_seats set status = 'INACTIVE' where table_id = any($1::uuid[]) and status = 'ACTIVE';",
          [closedTableIds]
        );
        try {
          await tx.unsafe("delete from public.poker_hole_cards where table_id = any($1::uuid[]);", [closedTableIds]);
        } catch (error) {
          if (isHoleCardsTableMissing(error)) {
            klog("poker_hole_cards_missing", {
              tableIds: closedTableIds,
              error: error?.message || "unknown_error",
            });
          } else {
            throw error;
          }
        }
      }
      return { closedCount: closedTableIds.length };
    });

    const closeCashoutTables = await beginSql(async (tx) =>
      tx.unsafe(
        `
select t.id
from public.poker_tables t
where not exists (
    select 1 from public.poker_seats s
    where s.table_id = t.id and s.status = 'ACTIVE'
  )
  and exists (
    select 1 from public.poker_seats s
    where s.table_id = t.id and s.stack > 0
  )
order by t.updated_at asc nulls last
limit $1;`,
        [CLOSE_CASHOUT_TABLES_LIMIT]
      )
    );
    const closeCashoutTableIds = Array.isArray(closeCashoutTables)
      ? closeCashoutTables.map((row) => row?.id).filter(Boolean)
      : [];
    let closeCashoutProcessed = 0;
    let closeCashoutSkipped = 0;
    for (const tableId of closeCashoutTableIds) {
      try {
        const result = await beginSql(async (tx) => {
          const lockedRows = await tx.unsafe(
            "select seat_no, status, stack, user_id, is_bot from public.poker_seats where table_id = $1 for update;",
            [tableId]
          );
          const stateRows = await tx.unsafe("select state from public.poker_state where table_id = $1 for update;", [tableId]);
          const stateRow = stateRows?.[0] || null;
          const currentState = normalizeState(stateRow?.state);
          const currentStacks =
            currentState?.stacks && typeof currentState.stacks === "object" && !Array.isArray(currentState.stacks)
              ? currentState.stacks
              : {};
          const handSettlement =
            currentState?.handSettlement && typeof currentState.handSettlement === "object"
              ? currentState.handSettlement
              : null;
          const usableSettlement =
            Boolean(handSettlement?.handId) &&
            handSettlement?.payouts &&
            typeof handSettlement.payouts === "object" &&
            !Array.isArray(handSettlement.payouts);
          if (usableSettlement) {
            try {
              await postHandSettlementToLedger({ tableId, handSettlement, postTransaction, klog, tx });
            } catch (error) {
              klog("poker_settlement_ledger_post_failed", {
                tableId,
                handId: handSettlement?.handId || null,
                error: error?.message || "unknown_error",
                source: "close_cashout",
              });
            }
          }
          let stateChanged = false;
          const nextStacks = { ...currentStacks };
          let tableProcessed = 0;
          let tableSkipped = 0;
          for (const locked of lockedRows || []) {
            const userId = locked?.user_id;
            const seatNo = locked?.seat_no ?? null;
            if (!userId || seatNo == null) {
              klog("poker_close_cashout_seat_invalid", {
                tableId,
                userId: userId ?? null,
                seatNo,
              });
              continue;
            }
            if (locked?.status === "ACTIVE" && locked?.is_bot !== true) {
              klog("poker_close_cashout_skip_active_seat", { tableId, userId, seatNo });
              continue;
            }
            const stateStack = normalizeNonNegativeInt(Number(currentStacks?.[userId]));
            const seatStack = normalizeNonNegativeInt(Number(locked.stack));
            const normalizedStack = usableSettlement ? 0 : stateStack ?? seatStack ?? 0;
            const stackSource = usableSettlement
              ? "settlement"
              : stateStack != null
                ? "state"
                : seatStack != null
                  ? "seat"
                  : "none";
            if (locked?.is_bot === true) {
              let botResult = null;
              if (!sweepActorUserId) {
                await ensureBotSeatInactiveForCashout(tx, { tableId, botUserId: userId });
                klog("poker_close_cashout_skip", { tableId, userId, seatNo, amount: normalizedStack, stackSource, reason: "missing_actor" });
                tableSkipped += 1;
                continue;
              }
              try {
                const inactiveResult = await ensureBotSeatInactiveForCashout(tx, { tableId, botUserId: userId });
                if (!inactiveResult?.ok) {
                  klog("poker_close_cashout_bot_invalid", {
                    tableId,
                    userId,
                    seatNo,
                    reason: inactiveResult?.reason || "unknown",
                  });
                  tableSkipped += 1;
                  continue;
                }
                const botSeatRows = await tx.unsafe(
                  "select status, stack, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update;",
                  [tableId, userId]
                );
                const botSeat = botSeatRows?.[0] || null;
                if (botSeat?.status === "ACTIVE") {
                  klog("poker_close_cashout_skip", {
                    tableId,
                    userId,
                    seatNo,
                    amount: normalizedStack,
                    stackSource,
                    reason: "failed_to_inactivate",
                  });
                  tableSkipped += 1;
                  continue;
                }
                botResult = await cashoutBotSeatIfNeeded(tx, {
                  tableId,
                  botUserId: userId,
                  seatNo,
                  reason: "SWEEP_CLOSE",
                  actorUserId: sweepActorUserId,
                  idempotencyKeySuffix: "close_cashout:v1",
                  expectedAmount: normalizedStack,
                });
              } catch (error) {
                klog("poker_close_cashout_fail", {
                  tableId,
                  userId,
                  seatNo,
                  error: error?.message || "unknown_error",
                });
                if (error && typeof error === "object") {
                  error.closeCashoutLogged = true;
                }
                throw error;
              }
              let botSafeToClearState = botResult?.cashedOut === true;
              if (!botSafeToClearState && botResult?.reason === "non_positive_stack") {
                botSafeToClearState = (stateStack ?? 0) === 0;
              }
              if (botSafeToClearState) {
                if (Object.prototype.hasOwnProperty.call(nextStacks, userId)) {
                  delete nextStacks[userId];
                  stateChanged = true;
                }
                if (botResult?.amount > 0 || botResult?.cashedOut === true) {
                  tableProcessed += 1;
                } else {
                  tableSkipped += 1;
                }
              } else {
                klog("poker_close_cashout_skip", {
                  tableId,
                  userId,
                  seatNo,
                  amount: botResult?.amount ?? normalizedStack,
                  stackSource,
                  reason: botResult?.reason || "bot_not_safe_to_clear",
                });
                tableSkipped += 1;
                continue;
              }
            } else if (normalizedStack > 0) {
              try {
                await postTransaction({
                  userId,
                  txType: "TABLE_CASH_OUT",
                  idempotencyKey: `poker:close_cashout:${tableId}:${userId}:${seatNo}:v1`,
                  reference: `table:${tableId}`,
                  metadata: { tableId, seatNo, reason: "table_close", stackSource },
                  entries: [
                    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -normalizedStack },
                    { accountType: "USER", amount: normalizedStack },
                  ],
                  createdBy: userId,
                  tx,
                });
              } catch (error) {
                klog("poker_close_cashout_fail", {
                  tableId,
                  userId,
                  seatNo,
                  error: error?.message || "unknown_error",
                });
                if (error && typeof error === "object") {
                  error.closeCashoutLogged = true;
                }
                throw error;
              }
              if (Object.prototype.hasOwnProperty.call(nextStacks, userId)) {
                delete nextStacks[userId];
                stateChanged = true;
              }
              klog("poker_close_cashout_ok", { tableId, userId, seatNo, amount: normalizedStack, stackSource });
              tableProcessed += 1;
            } else {
              klog("poker_close_cashout_skip", { tableId, userId, seatNo, amount: normalizedStack, stackSource });
              tableSkipped += 1;
            }
            if (locked?.is_bot !== true) {
              if (normalizedStack === 0 && Object.prototype.hasOwnProperty.call(nextStacks, userId)) {
                delete nextStacks[userId];
                stateChanged = true;
              }
            }
            if (locked?.is_bot !== true) {
              await tx.unsafe(
                "update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and seat_no = $2;",
                [tableId, seatNo]
              );
            }
          }
          if (stateRow && stateChanged) {
            const nextState = { ...currentState, stacks: nextStacks };
            await tx.unsafe("update public.poker_state set state = $2 where table_id = $1;", [tableId, JSON.stringify(nextState)]);
          }
          const seatCount = lockedRows?.length ?? 0;
          if (seatCount === 0) {
            tableSkipped += 1;
          }
          return { seatCount, tableProcessed, tableSkipped };
        });
        closeCashoutProcessed += Number(result?.tableProcessed || 0);
        closeCashoutSkipped += Number(result?.tableSkipped || 0);
      } catch (error) {
        if (!error?.closeCashoutLogged) {
          klog("poker_close_cashout_fail", {
            tableId,
            error: error?.message || "unknown_error",
          });
        }
      }
    }
    klog("poker_sweep_close_cashout_summary", {
      tables: closeCashoutTableIds.length,
      processed: closeCashoutProcessed,
      skipped: closeCashoutSkipped,
    });

    const closedResult = await beginSql(async (tx) => {
      const closedRows = await tx.unsafe(
        `
update public.poker_tables t
set status = 'CLOSED', updated_at = now()
where t.status != 'CLOSED'
  and ${TABLE_IDLE_EXPR_SQL} < now() - ($1::int * interval '1 second')
  and not exists (
    select 1 from public.poker_seats s
    where s.table_id = t.id and s.status = 'ACTIVE'
  )
  and ${ACTIVE_HUMAN_GUARD_SQL}
returning t.id;
        `,
        [TABLE_EMPTY_CLOSE_SEC]
      );
      const closedTableIds = Array.isArray(closedRows)
        ? closedRows.map((row) => row?.id).filter(Boolean)
        : [];
      if (closedTableIds.length) {
        try {
          await tx.unsafe("delete from public.poker_hole_cards where table_id = any($1::uuid[]);", [closedTableIds]);
        } catch (error) {
          if (isHoleCardsTableMissing(error)) {
            klog("poker_hole_cards_missing", {
              tableIds: closedTableIds,
              error: error?.message || "unknown_error",
            });
          } else {
            throw error;
          }
        }
      }
      return { closedCount: closedTableIds.length };
    });

    const totalClosedCount = singletonClosedResult.closedCount + closedResult.closedCount;

    const orphanRows = await beginSql(async (tx) =>
      tx.unsafe(
        `
select a.system_key, a.balance
from public.chips_accounts a
where a.account_type = 'ESCROW'
  and a.system_key like 'POKER_TABLE:%'
  and a.balance <> 0
  and not exists (
    select 1
    from public.poker_seats s
    where s.status = 'ACTIVE'
      and ('POKER_TABLE:' || s.table_id) = a.system_key
  );`
      )
    );
    if (Array.isArray(orphanRows)) {
      for (const row of orphanRows) {
        const tableId = parseTableIdFromSystemKey(row?.system_key);
        const escrowBalance = asPositiveWhole(row?.balance);
        klog("poker_escrow_orphan_detected", { tableId, escrowBalance });
        if (!tableId || escrowBalance <= 0) {
          klog("poker_escrow_orphan_skip", { tableId, escrowBalance, reason: "invalid_or_zero_balance" });
          continue;
        }
        const remediation = await remediateOrphanEscrow({ tableId, escrowBalance, sweepActorUserId });
        if (remediation?.action === "remediated") {
          klog("poker_escrow_orphan_remediated", {
            tableId,
            usersCashedOut: remediation.usersCashedOut,
            total: remediation.cashoutTotal,
            escrowBalance: remediation.escrowBalance,
          });
        } else if (remediation?.action === "quarantined") {
          klog("poker_escrow_orphan_quarantined", {
            tableId,
            escrowBalance: remediation.escrowBalance,
            userId: remediation.userId || null,
          });
        } else {
          if (remediation?.reason === "quarantine_missing_actor") {
            klog("poker_escrow_orphan_quarantine_disabled_missing_actor", {
              tableId,
              escrowBalance: remediation?.escrowBalance ?? escrowBalance,
            });
          }
          klog("poker_escrow_orphan_skip", {
            tableId,
            escrowBalance: remediation?.escrowBalance ?? escrowBalance,
            reason: remediation?.reason || "noop",
          });
        }
      }
    }

    return {
      statusCode: 200,
      headers: baseHeaders(),
      body: JSON.stringify({ ok: true, expiredCount, closedCount: totalClosedCount }),
    };
  } catch (error) {
    klog("poker_sweep_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: baseHeaders(), body: JSON.stringify({ error: "server_error" }) };
  } finally {
    if (lockAcquired) {
      try {
        await releaseSweepLock(lockToken);
      } catch (error) {
        klog("poker_sweep_lock_release_failed", {
          lockKey: SWEEP_LOCK_KEY,
          message: error?.message || "unknown_error",
        });
      }
    }
  }
}
