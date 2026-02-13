import { baseHeaders, beginSql, klog } from "./_shared/supabase-admin.mjs";
import { PRESENCE_TTL_SEC, TABLE_EMPTY_CLOSE_SEC, TABLE_SINGLETON_CLOSE_SEC, isValidUuid } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { isHoleCardsTableMissing } from "./_shared/poker-hole-cards-store.mjs";
import { postHandSettlementToLedger } from "./_shared/poker-ledger-settlement.mjs";
import { getBotConfig } from "./_shared/poker-bots.mjs";
import { cashoutBotSeatIfNeeded } from "./_shared/poker-bot-cashout.mjs";

const STALE_PENDING_CUTOFF_MINUTES = 10;
const STALE_PENDING_LIMIT = 500;
const OLD_REQUESTS_LIMIT = 1000;
const EXPIRED_SEATS_LIMIT = 200;
const CLOSE_CASHOUT_TABLES_LIMIT = 25;

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


const getSweepActorUserId = () => {
  const actorUserId = String(process.env.POKER_SYSTEM_ACTOR_USER_ID || "").trim();
  if (!isValidUuid(actorUserId)) {
    const error = new Error("invalid_system_actor_user_id");
    error.code = "invalid_system_actor_user_id";
    throw error;
  }
  return actorUserId;
};

const isExpiredSeat = (value) => {
  const lastSeenMs =
    typeof value === "string" ? Date.parse(value) : value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(lastSeenMs)) return false;
  return Date.now() - lastSeenMs > PRESENCE_TTL_SEC * 1000;
};

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

  try {
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
            "select seat_no, status, stack, last_seen_at from public.poker_seats where table_id = $1 and user_id = $2 for update;",
            [tableId, userId]
          );
          const locked = lockedRows?.[0] || null;
          if (!locked || locked.status !== "ACTIVE") {
            return { skipped: true, seatNo: locked?.seat_no ?? null };
          }
          if (!isExpiredSeat(locked.last_seen_at)) {
            return { skipped: true, seatNo: locked.seat_no };
          }

          const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
          const stateRow = stateRows?.[0] || null;
          const stateVersion = Number(stateRow?.version);
          const stateVersionSuffix = Number.isInteger(stateVersion) && stateVersion >= 0 ? String(stateVersion) : "unknown_version";
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

          if (usableSettlement) {
            try {
              await postHandSettlementToLedger({ tableId, handSettlement, postTransaction, klog, tx });
            } catch (error) {
              klog("poker_settlement_ledger_post_failed", {
                tableId,
                handId: handSettlement?.handId || null,
                error: error?.message || "unknown_error",
                source: "timeout_cashout",
              });
              return { skipped: true, seatNo: locked.seat_no, reason: "settlement_post_failed" };
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
          }

          await tx.unsafe(
            "update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and user_id = $2;",
            [tableId, userId]
          );

          if (amount > 0 && stateRow && currentState?.stacks && typeof currentState.stacks === "object") {
            const nextStacks = { ...currentState.stacks };
            if (Object.prototype.hasOwnProperty.call(nextStacks, userId)) {
              delete nextStacks[userId];
              const nextState = { ...currentState, stacks: nextStacks };
              await tx.unsafe("update public.poker_state set state = $2 where table_id = $1;", [tableId, JSON.stringify(nextState)]);
            }
          }

          return { seatNo: locked.seat_no, amount, stackSource };
        });

        if (processed?.skipped) {
          continue;
        }
        expiredCount += 1;
        if (processed?.amount > 0) {
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
        klog("poker_timeout_cashout_fail", {
          tableId,
          userId,
          seatNo: seat?.seat_no ?? null,
          error: error?.message || "unknown_error",
        });
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
    and t.last_activity_at < now() - ($1::int * interval '1 second')
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
      const singletonClosedTableIds = Array.isArray(singletonClosedRows)
        ? singletonClosedRows.map((row) => row?.id).filter(Boolean)
        : [];
      if (singletonClosedTableIds.length) {
        await tx.unsafe(
          "update public.poker_seats set status = 'INACTIVE' where table_id = any($1::uuid[]) and status = 'ACTIVE';",
          [singletonClosedTableIds]
        );
        try {
          await tx.unsafe("delete from public.poker_hole_cards where table_id = any($1::uuid[]);", [singletonClosedTableIds]);
        } catch (error) {
          if (isHoleCardsTableMissing(error)) {
            klog("poker_hole_cards_missing", {
              tableIds: singletonClosedTableIds,
              error: error?.message || "unknown_error",
            });
          } else {
            throw error;
          }
        }
      }
      return { closedCount: singletonClosedTableIds.length };
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
          const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
          const stateRow = stateRows?.[0] || null;
          const stateVersion = Number(stateRow?.version);
          const stateVersionSuffix = Number.isInteger(stateVersion) && stateVersion >= 0 ? String(stateVersion) : "unknown_version";
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
          const botConfig = getBotConfig();
          const sweepActorUserId = getSweepActorUserId();
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
            if (locked?.status === "ACTIVE") {
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
              try {
                const botResult = await cashoutBotSeatIfNeeded(tx, {
                  tableId,
                  botUserId: userId,
                  seatNo,
                  bankrollSystemKey: botConfig.bankrollSystemKey,
                  reason: "SWEEP_CLOSE",
                  actorUserId: sweepActorUserId,
                  idempotencyKeySuffix: `close_cashout:v1:${stateVersionSuffix}`,
                });
                if (botResult?.amount > 0) {
                  tableProcessed += 1;
                } else {
                  tableSkipped += 1;
                }
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
            if ((normalizedStack === 0 || locked?.is_bot === true) && Object.prototype.hasOwnProperty.call(nextStacks, userId)) {
              delete nextStacks[userId];
              stateChanged = true;
            }
            if (locked?.is_bot === true) {
              await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and seat_no = $2;", [
                tableId,
                seatNo,
              ]);
            } else {
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
          return { seatCount: lockedRows?.length ?? 0, tableProcessed, tableSkipped };
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
  and t.last_activity_at < now() - ($1::int * interval '1 second')
  and not exists (
    select 1 from public.poker_seats s
    where s.table_id = t.id and s.status = 'ACTIVE'
  )
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
      orphanRows.forEach((row) => {
        const systemKey = row?.system_key || "";
        const tableId = systemKey.startsWith("POKER_TABLE:") ? systemKey.slice("POKER_TABLE:".length) : null;
        klog("poker_escrow_orphan_detected", { tableId, escrowBalance: row?.balance ?? null });
      });
    }

    return {
      statusCode: 200,
      headers: baseHeaders(),
      body: JSON.stringify({ ok: true, expiredCount, closedCount: totalClosedCount }),
    };
  } catch (error) {
    klog("poker_sweep_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: baseHeaders(), body: JSON.stringify({ error: "server_error" }) };
  }
}
