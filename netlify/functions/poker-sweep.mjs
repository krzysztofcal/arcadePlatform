import { baseHeaders, beginSql, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { PRESENCE_TTL_SEC, TABLE_EMPTY_CLOSE_SEC } from "./_shared/poker-utils.mjs";

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin) || baseHeaders();
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const sweepSecret = process.env.POKER_SWEEP_SECRET;
  if (!sweepSecret) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "sweep_secret_missing" }) };
  }

  const headerSecret = event.headers?.["x-sweep-secret"] || event.headers?.["X-Sweep-Secret"];
  if (!headerSecret || headerSecret !== sweepSecret) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized" }) };
  }

  try {
    const result = await beginSql(async (tx) => {
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
      return { expiredCount, closedCount };
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, expiredCount: result.expiredCount, closedCount: result.closedCount }),
    };
  } catch (error) {
    klog("poker_sweep_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
