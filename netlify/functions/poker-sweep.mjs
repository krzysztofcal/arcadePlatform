import { baseHeaders, beginSql, klog } from "./_shared/supabase-admin.mjs";
import { PRESENCE_TTL_SEC, TABLE_EMPTY_CLOSE_SEC } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { isHoleCardsTableMissing } from "./_shared/poker-hole-cards-store.mjs";

const STALE_PENDING_CUTOFF_MINUTES = 10;
const STALE_PENDING_LIMIT = 500;
const OLD_REQUESTS_LIMIT = 1000;
const EXPIRED_SEATS_LIMIT = 200;
const CLOSE_CASHOUT_TABLES_LIMIT = 25;

const normalizeSeatStack = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
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

          const amount = normalizeSeatStack(locked.stack) ?? 0;
          if (amount > 0) {
            await postTransaction({
              userId,
              txType: "TABLE_CASH_OUT",
              idempotencyKey: `poker:timeout_cashout:${tableId}:${userId}:${locked.seat_no}:v1`,
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
          return { seatNo: locked.seat_no, amount };
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
          });
        } else {
          klog("poker_timeout_cashout_skip", {
            tableId,
            userId,
            seatNo: processed?.seatNo ?? null,
            amount: processed?.amount ?? 0,
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

    const closeCashoutTables = await beginSql(async (tx) =>
      tx.unsafe(
        `
select t.id
from public.poker_tables t
where (
    t.status = 'CLOSED'
    or not exists (
      select 1 from public.poker_seats s
      where s.table_id = t.id and s.status = 'ACTIVE'
    )
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
            "select seat_no, status, stack, user_id from public.poker_seats where table_id = $1 for update;",
            [tableId]
          );
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
            const normalizedStack = normalizeSeatStack(locked.stack);
            if (normalizedStack == null) {
              klog("poker_close_cashout_stack_invalid", {
                tableId,
                userId,
                seatNo,
                stack: locked?.stack ?? null,
              });
              continue;
            }
            if (normalizedStack < 0) {
              klog("poker_close_cashout_stack_negative", {
                tableId,
                userId,
                seatNo,
                stack: normalizedStack,
              });
              continue;
            }
            if (normalizedStack > 0) {
              try {
                await postTransaction({
                  userId,
                  txType: "TABLE_CASH_OUT",
                  idempotencyKey: `poker:close_cashout:${tableId}:${userId}:${seatNo}:v1`,
                  reference: `table:${tableId}`,
                  metadata: { tableId, seatNo, reason: "table_close" },
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
              klog("poker_close_cashout_ok", { tableId, userId, seatNo, amount: normalizedStack });
              closeCashoutProcessed += 1;
            } else {
              klog("poker_close_cashout_skip", { tableId, userId, seatNo, amount: normalizedStack });
              closeCashoutSkipped += 1;
            }
            await tx.unsafe(
              "update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and seat_no = $2;",
              [tableId, seatNo]
            );
          }
          return { seatCount: lockedRows?.length ?? 0 };
        });
        if (result?.seatCount === 0) {
          closeCashoutSkipped += 1;
        }
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
      body: JSON.stringify({ ok: true, expiredCount, closedCount: closedResult.closedCount }),
    };
  } catch (error) {
    klog("poker_sweep_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: baseHeaders(), body: JSON.stringify({ error: "server_error" }) };
  }
}
