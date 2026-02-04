import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { formatStakes, parseStakes } from "./_shared/poker-stakes.mjs";

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
  if (value == null || value === "") return 6;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < 2 || num > 10) return null;
  return num;
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
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const maxPlayers = parseMaxPlayers(payload?.maxPlayers);
  if (maxPlayers == null) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_max_players" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const stakesParsed = parseStakes(payload?.stakes);
  if (!stakesParsed.ok) {
    klog("poker_create_table_invalid_stakes", { reason: stakesParsed.details?.reason || "stakes_invalid" });
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_stakes" }) };
  }
  const stakesJson = formatStakes(stakesParsed.value);

  let tableId = null;
  try {
    await beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        `
insert into public.poker_tables (stakes, max_players, status, created_by, updated_at, last_activity_at)
values ($1::jsonb, $2, 'OPEN', $3, now(), now())
returning id;
        `,
        [stakesJson, maxPlayers, auth.userId]
      );
      tableId = tableRows?.[0]?.id || null;
      if (!tableId) {
        throw new Error("poker_table_insert_failed");
      }

      const state = { tableId, seats: [], stacks: {}, pot: 0, phase: "INIT" };
      await tx.unsafe(
        "insert into public.poker_state (table_id, version, state) values ($1, 0, $2::jsonb);",
        [tableId, JSON.stringify(state)]
      );

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
      if (!escrowId) {
        throw new Error("poker_escrow_missing");
      }
    });
  } catch (error) {
    klog("poker_create_table_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }

  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ tableId, escrowSystemKey }),
  };
}
