import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { formatStakes, parseStakes } from "./_shared/poker-stakes.mjs";

const DEFAULT_MAX_PLAYERS = 6;
const DEFAULT_STAKES = { sb: 1, bb: 2 };

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const parseMaxPlayers = (value) => {
  if (value == null || value === "") return DEFAULT_MAX_PLAYERS;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < 2 || num > 10) return null;
  return num;
};

const pickSeatNo = (rows, maxPlayers) => {
  const occupied = new Set();
  for (const row of rows || []) {
    if (Number.isInteger(row?.seat_no)) occupied.add(row.seat_no);
  }
  for (let seatNo = 1; seatNo <= maxPlayers; seatNo += 1) {
    if (!occupied.has(seatNo)) return seatNo;
  }
  return null;
};

const createAndSeat = async (tx, { userId, maxPlayers, stakesJson }) => {
  const tableRows = await tx.unsafe(
    `
insert into public.poker_tables (stakes, max_players, status, created_by, updated_at, last_activity_at)
values ($1::jsonb, $2, 'OPEN', $3, now(), now())
returning id;
    `,
    [stakesJson, maxPlayers, userId]
  );
  const tableId = tableRows?.[0]?.id || null;
  if (!tableId) throw new Error("poker_quick_seat_create_failed");

  const state = { tableId, seats: [], stacks: {}, pot: 0, phase: "INIT" };
  await tx.unsafe("insert into public.poker_state (table_id, version, state) values ($1, 0, $2::jsonb);", [
    tableId,
    JSON.stringify(state),
  ]);

  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  const escrowRows = await tx.unsafe(
    `
with inserted as (
  insert into public.chips_accounts (account_type, system_key, status)
  values ('ESCROW', $1, 'active')
  on conflict (system_key) do nothing
  returning id
)
select id from inserted
union all
select id from public.chips_accounts where system_key = $1
limit 1;
    `,
    [escrowSystemKey]
  );
  const escrowId = escrowRows?.[0]?.id || null;
  if (!escrowId) throw new Error("poker_quick_seat_escrow_missing");

  const seatNo = 1;
  await tx.unsafe(
    `
insert into public.poker_seats (table_id, user_id, seat_no, status, joined_at, last_seen_at)
values ($1, $2, $3, 'ACTIVE', now(), now());
    `,
    [tableId, userId, seatNo]
  );
  await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);

  return { tableId, seatNo, strategy: "create" };
};

const selectCandidate = async (tx, { stakesJson, maxPlayers, requireHuman }) => {
  return tx.unsafe(
    `
select t.id, t.max_players
from public.poker_tables t
where t.status = 'OPEN'
  and t.max_players = $1
  and t.stakes = $2::jsonb
  and (select count(*)::int from public.poker_seats s where s.table_id = t.id and s.status = 'ACTIVE') < t.max_players
  and ($3::boolean = false or exists (
    select 1
    from public.poker_seats hs
    where hs.table_id = t.id
      and hs.status = 'ACTIVE'
      and coalesce(hs.is_bot, false) = false
  ))
order by t.last_activity_at desc nulls last, t.created_at asc nulls last
limit 1
for update of t skip locked;
    `,
    [maxPlayers, stakesJson, requireHuman]
  );
};

const seatUserAtTable = async (tx, { tableId, userId, maxPlayers, allowCreateFallback, createPayload }) => {
  const existingRows = await tx.unsafe(
    "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 limit 1;",
    [tableId, userId]
  );
  const existingSeatNo = existingRows?.[0]?.seat_no;
  if (Number.isInteger(existingSeatNo)) {
    await tx.unsafe(
      "update public.poker_seats set status = 'ACTIVE', last_seen_at = now() where table_id = $1 and user_id = $2;",
      [tableId, userId]
    );
    await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
    return { tableId, seatNo: existingSeatNo };
  }

  const activeSeatRows = await tx.unsafe(
    "select seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc for update;",
    [tableId]
  );
  let seatNo = pickSeatNo(activeSeatRows, maxPlayers);
  if (seatNo == null) {
    if (allowCreateFallback) return createAndSeat(tx, createPayload);
    return null;
  }

  const tryInsertSeat = async (candidateSeatNo) => {
    await tx.unsafe(
      `
insert into public.poker_seats (table_id, user_id, seat_no, status, joined_at, last_seen_at)
values ($1, $2, $3, 'ACTIVE', now(), now());
      `,
      [tableId, userId, candidateSeatNo]
    );
    await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
    return { tableId, seatNo: candidateSeatNo };
  };

  try {
    return await tryInsertSeat(seatNo);
  } catch (error) {
    const isUnique = error?.code === "23505";
    if (!isUnique) throw error;
    const retryRows = await tx.unsafe(
      "select seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc for update;",
      [tableId]
    );
    seatNo = pickSeatNo(retryRows, maxPlayers);
    if (seatNo == null) {
      if (allowCreateFallback) return createAndSeat(tx, createPayload);
      return null;
    }
    return tryInsertSeat(seatNo);
  }
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  }
  const payload = parsed.value ?? {};
  if (!isPlainObject(payload)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const maxPlayers = parseMaxPlayers(payload?.maxPlayers);
  if (maxPlayers == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_max_players" }) };
  }

  const stakesInput = payload?.stakes ?? (payload?.sb != null || payload?.bb != null ? { sb: payload?.sb, bb: payload?.bb } : DEFAULT_STAKES);
  const stakesParsed = parseStakes(stakesInput);
  if (!stakesParsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_stakes" }) };
  }
  const stakesJson = formatStakes(stakesParsed.value);

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const createPayload = { userId: auth.userId, maxPlayers, stakesJson };

      const preferredRows = await selectCandidate(tx, { stakesJson, maxPlayers, requireHuman: true });
      if (preferredRows?.[0]?.id) {
        const seated = await seatUserAtTable(tx, {
          tableId: preferredRows[0].id,
          userId: auth.userId,
          maxPlayers,
          allowCreateFallback: true,
          createPayload,
        });
        if (seated) return { ...seated, strategy: "prefer_humans" };
      }

      const anyRows = await selectCandidate(tx, { stakesJson, maxPlayers, requireHuman: false });
      if (anyRows?.[0]?.id) {
        const seated = await seatUserAtTable(tx, {
          tableId: anyRows[0].id,
          userId: auth.userId,
          maxPlayers,
          allowCreateFallback: true,
          createPayload,
        });
        if (seated) return { ...seated, strategy: "any_open" };
      }

      return createAndSeat(tx, createPayload);
    });

    klog("poker_quick_seat_ok", { tableId: result.tableId, seatNo: result.seatNo, userId: auth.userId, strategy: result.strategy });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, tableId: result.tableId, seatNo: result.seatNo }),
    };
  } catch (error) {
    klog("poker_quick_seat_error", { message: error?.message || "unknown_error", userId: auth.userId });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
