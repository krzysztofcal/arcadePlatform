import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { listUserLedger } from "./_shared/chips-ledger.mjs";

const CHIPS_ENABLED = process.env.CHIPS_ENABLED === "1";
const LEDGER_VERSION = process.env.COMMIT_REF || process.env.BUILD_ID || process.env.DEPLOY_ID || new Date().toISOString();

function withLedgerVersion(headers) {
  return { ...headers, "x-chips-ledger-version": LEDGER_VERSION };
}

function isValidDateString(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export async function handler(event) {
  if (!CHIPS_ENABLED) {
    return {
      statusCode: 404,
      headers: withLedgerVersion(baseHeaders()),
      body: JSON.stringify({ error: "not_found" }),
    };
  }

  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return {
      statusCode: 403,
      headers: withLedgerVersion(baseHeaders()),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: withLedgerVersion(cors), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: withLedgerVersion(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("chips_ledger_debug_auth_failed", { reason: auth.reason });
    return {
      statusCode: 401,
      headers: withLedgerVersion(cors),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
  }

  const limitRaw = event.queryStringParameters?.limit;
  const parsedLimit = Number(limitRaw);
  const limit = Number.isInteger(parsedLimit) ? parsedLimit : 3;
  const cappedLimit = Math.min(Math.max(1, limit), 5);

  try {
    const ledger = await listUserLedger(auth.userId, { limit: cappedLimit });
    const items = Array.isArray(ledger.items) ? ledger.items : ledger.entries || [];
    const sample = items.slice(0, cappedLimit).map(entry => ({
      entry_seq: entry.entry_seq ?? null,
      tx_type: entry.tx_type ?? null,
      amount: entry.amount ?? null,
      reference: entry.reference ?? null,
      description: entry.description ?? null,
      idempotency_key: entry.idempotency_key ?? null,
      display_created_at: entry.display_created_at ?? null,
      sort_id: entry.sort_id ?? null,
    }));
    const checks = {
      has_display_created_at: sample.every(entry => !!entry.display_created_at),
      display_created_at_parseable: sample.every(entry => isValidDateString(entry.display_created_at)),
      has_sort_id: sample.every(entry => /^\d+$/.test(String(entry.sort_id || ""))),
    };
    checks.ok = checks.has_display_created_at && checks.display_created_at_parseable && checks.has_sort_id;

    return {
      statusCode: 200,
      headers: withLedgerVersion(cors),
      body: JSON.stringify({
        version: LEDGER_VERSION,
        server_time: new Date().toISOString(),
        checks,
        sample,
      }),
    };
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    const code = error && error.code ? error.code : "server_error";
    klog("chips_ledger_debug_error", { error: error.message, code });
    return { statusCode: status, headers: withLedgerVersion(cors), body: JSON.stringify({ error: code }) };
  }
}
