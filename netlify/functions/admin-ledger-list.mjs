import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import {
  badRequest,
  buildPagination,
  escapeLike,
  parseBoolFlag,
  parsePageLimit,
  parseTimestamp,
  parseUuid,
} from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";

function buildLedgerFilters(qs = {}) {
  const positiveOnly = parseBoolFlag(qs.positiveOnly);
  const negativeOnly = parseBoolFlag(qs.negativeOnly);
  if (positiveOnly === true && negativeOnly === true) {
    throw badRequest("invalid_amount_filter", "invalid_amount_filter");
  }
  return {
    page: parsePageLimit(qs, { defaultLimit: 25, maxLimit: 100 }),
    txType: typeof qs.txType === "string" ? qs.txType.trim().toUpperCase() : "",
    userId: qs.userId ? parseUuid(qs.userId, "invalid_user_id") : null,
    email: typeof qs.email === "string" ? qs.email.trim() : "",
    source: typeof qs.source === "string" ? qs.source.trim() : "",
    positiveOnly,
    negativeOnly,
    from: parseTimestamp(qs.from, "invalid_from"),
    to: parseTimestamp(qs.to, "invalid_to"),
    adminOnly: parseBoolFlag(qs.adminOnly),
  };
}

async function listLedger(filters = {}) {
  const parsed = buildLedgerFilters(filters);
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (parsed.txType) where.push(`tx_type = ${nextParam(parsed.txType)}`);
  if (parsed.userId) where.push(`user_id = ${nextParam(parsed.userId)}`);
  if (parsed.email) where.push(`email ilike ${nextParam(`%${escapeLike(parsed.email)}%`)} escape '\\'`);
  if (parsed.source) where.push(`source = ${nextParam(parsed.source)}`);
  if (parsed.positiveOnly === true) where.push("amount > 0");
  if (parsed.negativeOnly === true) where.push("amount < 0");
  if (parsed.from) where.push(`display_created_at >= ${nextParam(parsed.from)}::timestamptz`);
  if (parsed.to) where.push(`display_created_at <= ${nextParam(parsed.to)}::timestamptz`);
  if (parsed.adminOnly === true) where.push("tx_type = 'ADMIN_ADJUST'");
  const whereSql = where.length ? `where ${where.join("\n  and ")}` : "";
  const query = `
with base as (
  select
    e.id as entry_id,
    e.entry_seq,
    e.amount,
    e.metadata as entry_metadata,
    e.created_at,
    t.id as transaction_id,
    t.tx_type,
    t.reference,
    t.description,
    t.idempotency_key,
    t.metadata as tx_metadata,
    t.created_at as tx_created_at,
    a.user_id::text as user_id,
    u.email,
    coalesce(
      nullif(u.raw_user_meta_data->>'full_name', ''),
      nullif(u.raw_user_meta_data->>'name', ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      a.user_id::text
    ) as display_name,
    coalesce(e.metadata->>'source', t.metadata->>'source') as source,
    coalesce(e.created_at, t.created_at) as display_created_at
  from public.chips_entries e
  join public.chips_transactions t on t.id = e.transaction_id
  join public.chips_accounts a on a.id = e.account_id
  left join auth.users u on u.id = a.user_id
  where a.account_type = 'USER'
),
filtered as (
  select * from base
  ${whereSql}
)
select
  filtered.*,
  count(*) over() as total_count
from filtered
order by display_created_at desc, entry_id desc
offset ${nextParam(parsed.page.offset)}
limit ${nextParam(parsed.page.limit)};
  `;
  const rows = await executeSql(query, params);
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0;
  return {
    items: (Array.isArray(rows) ? rows : []).map((row) => ({
      entryId: row.entry_id || null,
      entrySeq: Number.isInteger(Number(row.entry_seq)) ? Number(row.entry_seq) : null,
      transactionId: row.transaction_id || null,
      userId: row.user_id || null,
      email: row.email || null,
      displayName: row.display_name || row.email || row.user_id || "",
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : 0,
      txType: row.tx_type || null,
      reference: row.reference || null,
      description: row.description || null,
      idempotencyKey: row.idempotency_key || null,
      source: row.source || null,
      createdAt: row.created_at || null,
      txCreatedAt: row.tx_created_at || null,
      displayCreatedAt: row.display_created_at || row.tx_created_at || row.created_at || null,
      metadata: row.tx_metadata || null,
      entryMetadata: row.entry_metadata || null,
    })),
    pagination: buildPagination({ page: parsed.page.page, limit: parsed.page.limit, total }),
  };
}

function createAdminLedgerListHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const listLedgerFn = deps.listLedger || listLedger;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    }
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }
    try {
      await requireAdmin(event, env);
      const payload = await listLedgerFn(event.queryStringParameters || {});
      return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminLedgerListHandler();

export {
  createAdminLedgerListHandler,
  handler,
  listLedger,
};
