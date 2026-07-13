import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { listUserLedger, listUserLedgerAfterSeq, listUserLedgerPage } from "./_shared/chips-ledger.mjs";

const LEDGER_VERSION = process.env.COMMIT_REF || process.env.BUILD_ID || process.env.DEPLOY_ID || new Date().toISOString();

function withLedgerVersion(headers) {
  return { ...headers, "x-chips-ledger-version": LEDGER_VERSION };
}

export function createChipsLedgerHandler(deps = {}) {
  const env = deps.env || process.env;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const listCursorPage = deps.listUserLedger || listUserLedger;
  const listLegacyPage = deps.listUserLedgerAfterSeq || listUserLedgerAfterSeq;
  const listNumberedPage = deps.listUserLedgerPage || listUserLedgerPage;

  return async function chipsLedgerHandler(event) {
  if (env.CHIPS_ENABLED !== "1") {
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
  const auth = await verifyJwt(token);
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
  const trimmedCursor = typeof cursor === "string" ? cursor.trim() : cursor;
  const hasCursorValue = typeof trimmedCursor === "string" ? trimmedCursor !== "" : !!trimmedCursor;
  const hasAfterValue = typeof after === "string" ? after !== "" : after != null;
  const limitRaw = qs.limit;
  const parsedLimit = Number(limitRaw);
  const limit = Number.isInteger(parsedLimit) ? parsedLimit : 50;
  const hasPage = Object.prototype.hasOwnProperty.call(qs, "page");
  const parsedPage = Number(qs.page);

  if (hasPage && (!Number.isInteger(parsedPage) || parsedPage < 1)) {
    return { statusCode: 400, headers: withLedgerVersion(cors), body: JSON.stringify({ error: "invalid_page" }) };
  }

  try {
    if (hasPage) {
      const ledger = await listNumberedPage(auth.userId, { page: parsedPage, limit });
      klog("chips_ledger_page_ok", { userId: auth.userId, page: parsedPage, count: ledger.items.length });
      return {
        statusCode: 200,
        headers: withLedgerVersion(cors),
        body: JSON.stringify({
          userId: auth.userId,
          items: ledger.items,
          entries: ledger.items,
          pagination: ledger.pagination,
          nextCursor: null,
        }),
      };
    }
    if (hasCursorValue || !hasAfterValue) {
      const ledger = await listCursorPage(auth.userId, { cursor: hasCursorValue ? trimmedCursor : null, limit });
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

    const legacy = await listLegacyPage(auth.userId, { afterSeq: after, limit });
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
  };
}

export const handler = createChipsLedgerHandler();
