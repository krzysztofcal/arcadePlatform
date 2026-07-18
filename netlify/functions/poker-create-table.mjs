import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { formatStakes, parseStakes } from "./_shared/poker-stakes.mjs";
import { createPokerTableWithState } from "./_shared/poker-table-init.mjs";
import { readPokerBuyInEligibility } from "./_shared/poker-buy-in-eligibility.mjs";
import { notifyWsLobbyMaterialize } from "./_shared/poker-ws-runtime-notify.mjs";
import { DEFAULT_CASH_TABLE_BUY_IN_CHIPS } from "../../shared/poker-domain/table-economy.mjs";

const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const triggerWsLobbyMaterialize = ({ tableId, maxPlayers, stakes, klog }) => {
  if (typeof tableId !== "string" || !tableId) return;
  void notifyWsLobbyMaterialize({ tableId, maxPlayers, stakes, klog });
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
  if (process.env.CHIPS_ENABLED !== "1") {
    return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
  }
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
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const maxPlayers = parseMaxPlayers(payload?.maxPlayers);
  if (maxPlayers == null) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_max_players" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const stakesParsed = parseStakes(payload?.stakes);
  if (!stakesParsed.ok) {
    klog("poker_create_table_invalid_stakes", { reason: stakesParsed.details?.reason || "stakes_invalid" });
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_stakes" }) };
  }
  const stakesJson = formatStakes(stakesParsed.value);

  let transactionResult = null;
  try {
    transactionResult = await beginSql(async (tx) => {
      const eligibility = await readPokerBuyInEligibility(tx, {
        userId: auth.userId,
        requiredBuyIn: DEFAULT_CASH_TABLE_BUY_IN_CHIPS,
      });
      if (!eligibility.eligible) {
        return { kind: "insufficient_chips", balance: eligibility.balance, requiredBuyIn: eligibility.requiredBuyIn };
      }
      const created = await createPokerTableWithState(tx, { userId: auth.userId, maxPlayers, stakesJson });
      return { kind: "created", tableId: created.tableId };
    });
  } catch (error) {
    klog("poker_create_table_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }

  if (transactionResult?.kind === "insufficient_chips") {
    return {
      statusCode: 409,
      headers: mergeHeaders(cors),
      body: JSON.stringify({
        error: "insufficient_chips",
        requiredBuyIn: transactionResult.requiredBuyIn,
        balance: transactionResult.balance,
      }),
    };
  }
  const tableId = transactionResult?.kind === "created" ? transactionResult.tableId : null;
  if (!tableId) {
    klog("poker_create_table_error", { message: "invalid_transaction_result" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }

  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  triggerWsLobbyMaterialize({ tableId, maxPlayers, stakes: stakesParsed.value, klog });
  return {
    statusCode: 200,
    headers: mergeHeaders(cors),
    body: JSON.stringify({ tableId, escrowSystemKey }),
  };
}
