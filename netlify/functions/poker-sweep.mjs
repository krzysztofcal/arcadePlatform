import { baseHeaders, beginSql, klog } from "./_shared/supabase-admin.mjs";
import { PRESENCE_TTL_SEC, TABLE_EMPTY_CLOSE_SEC } from "./_shared/poker-utils.mjs";

const STALE_PENDING_CUTOFF_MINUTES = 10;
const STALE_PENDING_LIMIT = 500;
const OLD_REQUESTS_LIMIT = 1000;

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
        `update public.poker_seats set status = 'INACTIVE'
         where status = 'ACTIVE' and last_seen_at < now() - ($1::int * interval '1 second')
         returning table_id;`,
        [PRESENCE_TTL_SEC]
      );
      const expiredCount = Array.isArray(expiredRows) ? expiredRows.length : 0;

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
      const closedCount = Array.isArray(closedRows) ? closedRows.length : 0;

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
      return { cleanupCount, expiredCount, closedCount };
    });

    klog("poker_requests_cleanup", {
      deleted: result.cleanupCount,
      cutoffMinutes: STALE_PENDING_CUTOFF_MINUTES,
      limit: STALE_PENDING_LIMIT,
    });
    return {
      statusCode: 200,
      headers: baseHeaders(),
      body: JSON.stringify({ ok: true, expiredCount: result.expiredCount, closedCount: result.closedCount }),
    };
  } catch (error) {
    klog("poker_sweep_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: baseHeaders(), body: JSON.stringify({ error: "server_error" }) };
  }
}
