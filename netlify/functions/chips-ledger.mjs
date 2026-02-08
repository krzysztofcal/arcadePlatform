import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { listUserLedger, listUserLedgerAfterSeq } from "./_shared/chips-ledger.mjs";

const CHIPS_ENABLED = process.env.CHIPS_ENABLED === "1";
const LEDGER_VERSION = process.env.COMMIT_REF || process.env.BUILD_ID || process.env.DEPLOY_ID || new Date().toISOString();

function withLedgerVersion(headers) {
  return { ...headers, "x-chips-ledger-version": LEDGER_VERSION };
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
    klog("chips_ledger_auth_failed", { reason: auth.reason });
    return {
      statusCode: 401,
      headers: withLedgerVersion(cors),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
  }

  const qs = event.queryStringParameters || {};
  const hasAfter = Object.prototype.hasOwnProperty.call(qs, "after");
  const hasCursor = Object.prototype.hasOwnProperty.call(qs, "cursor");
  const afterRaw = hasAfter ? qs.after : null;
  const after = typeof afterRaw === "string" ? afterRaw.trim() : afterRaw;
  const cursor = hasCursor ? qs.cursor : null;
  const limitRaw = qs.limit;
  const parsedLimit = Number(limitRaw);
  const limit = Number.isInteger(parsedLimit) ? parsedLimit : 50;

  try {
    if (!after) {
      const ledger = await listUserLedger(auth.userId, { cursor, limit });
      const items = Array.isArray(ledger.items) ? ledger.items : ledger.entries || [];
      klog("chips_ledger_ok", { userId: auth.userId, count: items.length });
      return {
        statusCode: 200,
        headers: withLedgerVersion(cors),
        body: JSON.stringify({
          userId: auth.userId,
          items: items,
          entries: items,
          nextCursor: ledger.nextCursor || null,
        }),
      };
    }

    const legacy = await listUserLedgerAfterSeq(auth.userId, { afterSeq: after, limit });
    klog("chips_ledger_ok", { userId: auth.userId, count: legacy.entries.length });
    return {
      statusCode: 200,
      headers: withLedgerVersion(cors),
      body: JSON.stringify({
        userId: auth.userId,
        entries: legacy.entries,
        sequenceOk: legacy.sequenceOk,
        nextExpectedSeq: legacy.nextExpectedSeq,
      }),
    };
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    const code = error && error.code ? error.code : "server_error";
    klog("chips_ledger_error", { error: error.message, code });
    return { statusCode: status, headers: withLedgerVersion(cors), body: JSON.stringify({ error: code }) };
  }
}
