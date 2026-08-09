import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { createPokerTableWithState } from "./_shared/poker-table-init.mjs";
import { notifyWsLobbyMaterialize } from "./_shared/poker-ws-runtime-notify.mjs";
import { calculateUnlockBankroll, evaluatePokerBuyInAccess, readPokerProgression } from "../../shared/poker-domain/poker-progression.mjs";
import { calculateCanonicalPokerStakes, isCanonicalPokerStakes } from "../../shared/poker-domain/table-economy.mjs";

const DEFAULT_MAX_PLAYERS = 6;
const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });

const DEFAULT_HUMAN_SEAT_FRESH_MS = 120_000;

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

const resolveHumanSeatFreshMs = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 15_000) return DEFAULT_HUMAN_SEAT_FRESH_MS;
  return Math.min(Math.trunc(num), 15 * 60_000);
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

const toUiSeatNo = (seatNoDb, maxPlayers) => {
  const maxUi = Number.isInteger(maxPlayers) && maxPlayers >= 2 ? maxPlayers : DEFAULT_MAX_PLAYERS;
  if (!Number.isInteger(seatNoDb)) return 1;
  if (seatNoDb < 1) return 1;
  if (seatNoDb > maxUi) return maxUi;
  return seatNoDb;
};

const parseTableStakes = (value) => {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
};

const createAndRecommend = async (tx, { userId, maxPlayers, progression }) => {
  const buyIn = progression?.highestUnlockedBuyIn;
  if (!Number.isSafeInteger(buyIn) || buyIn <= 0) {
    const firstTier = progression?.tiers?.[0] || null;
    return {
      kind: "buy_in_tier_locked",
      balance: progression?.balance ?? 0,
      buyIn: firstTier?.buyIn ?? null,
      requiredBuyIn: firstTier?.buyIn ?? null,
      requiredBankroll: firstTier?.unlockBankroll ?? null
    };
  }
  const canonicalStakes = calculateCanonicalPokerStakes(buyIn);
  if (!canonicalStakes) return { kind: "unavailable" };
  const stakesJson = JSON.stringify(canonicalStakes);
  const created = await createPokerTableWithState(tx, { userId, maxPlayers, stakesJson, buyIn });
  const tableId = created.tableId;
  await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
  const seatNoUi = 1;
  return { kind: "recommended", tableId, seatNo: seatNoUi, strategy: "create", buyIn, stakes: canonicalStakes };
};

const triggerWsLobbyMaterialize = ({ tableId, maxPlayers, stakes, buyIn, klog }) => {
  if (typeof tableId !== "string" || !tableId) return;
  void notifyWsLobbyMaterialize({ tableId, maxPlayers, stakes, buyIn, klog });
};

const selectExistingActiveSeat = async (tx, { userId }) => {
  return tx.unsafe(
    `
select t.id, t.max_players, t.buy_in, t.stakes
from public.poker_tables t
join public.poker_seats s on s.table_id = t.id
where t.status = 'OPEN'
  and s.user_id = $1
  and s.status = 'ACTIVE'
limit 1;
    `,
    [userId]
  );
};

const selectCandidate = async (tx, { maxPlayers, requireHuman, humanSeatFreshCutoffIso, availableBuyIns }) => {
  return tx.unsafe(
    `
select t.id, t.max_players, t.buy_in, t.stakes
from public.poker_tables t
where t.status = 'OPEN'
  and t.max_players = $1
  and not (
    t.lifecycle_kind = 'CONTINUOUS_BOT'
    and t.rotation_due_at is not null
    and t.rotation_due_at <= now()
  )
  and (select count(*)::int from public.poker_seats s where s.table_id = t.id and s.status = 'ACTIVE') < t.max_players
  and not exists (
    select 1
    from public.poker_seats stale_hs
    where stale_hs.table_id = t.id
      and stale_hs.status = 'ACTIVE'
      and coalesce(stale_hs.is_bot, false) = false
      and coalesce(stale_hs.last_seen_at, to_timestamp(0)) < $3::timestamptz
  )
  and (
    exists (
      select 1
      from public.poker_seats hs
      where hs.table_id = t.id
        and hs.status = 'ACTIVE'
        and coalesce(hs.is_bot, false) = false
        and coalesce(hs.last_seen_at, to_timestamp(0)) >= $3::timestamptz
    )
    or t.lifecycle_kind = 'CONTINUOUS_BOT'
    or coalesce((
      select ps.state ->> 'phase'
      from public.poker_state ps
      where ps.table_id = t.id
      limit 1
    ), 'INIT') not in ('POSTING_BLINDS', 'PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'SETTLED', 'HAND_DONE')
  )
  and ($2::boolean = false or exists (
    select 1
    from public.poker_seats hs
    where hs.table_id = t.id
      and hs.status = 'ACTIVE'
      and coalesce(hs.is_bot, false) = false
    and coalesce(hs.last_seen_at, to_timestamp(0)) >= $3::timestamptz
  ))
  and t.buy_in = any($4::int[])
order by t.last_activity_at desc nulls last, t.created_at asc nulls last
limit 50;
    `,
    [maxPlayers, requireHuman, humanSeatFreshCutoffIso, availableBuyIns]
  );
};

const recommendSeatAtTable = async (tx, { tableId, userId, maxPlayers, buyIn, tableStakes, progression, allowCreateFallback, createPayload }) => {
  const existingSeatRows = await tx.unsafe(
    "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
    [tableId, userId]
  );
  const existingSeatNoDb = existingSeatRows?.[0]?.seat_no;
  if (Number.isInteger(existingSeatNoDb)) {
    await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
    return { kind: "recommended", tableId, seatNo: toUiSeatNo(existingSeatNoDb, maxPlayers) };
  }

  const normalizedBuyIn = Number(buyIn);
  if (!Number.isSafeInteger(normalizedBuyIn) || normalizedBuyIn <= 0) {
    return { kind: "unavailable" };
  }
  if (!isCanonicalPokerStakes(normalizedBuyIn, parseTableStakes(tableStakes))) {
    return { kind: "unavailable", reason: "invalid_table_economy" };
  }
  const access = evaluatePokerBuyInAccess({
    balance: progression?.balance ?? 0,
    buyIn: normalizedBuyIn,
    tiers: progression?.tiers?.map((tier) => tier.buyIn) || []
  });
  if (!access.configured || !access.eligible) {
    return {
      kind: "buy_in_tier_locked",
      balance: access.balance,
      buyIn: normalizedBuyIn,
      requiredBuyIn: normalizedBuyIn,
      requiredBankroll: access.requiredBankroll || calculateUnlockBankroll(normalizedBuyIn)
    };
  }

  const activeSeatRows = await tx.unsafe(
    "select seat_no from public.poker_seats where table_id = $1 order by seat_no asc;",
    [tableId]
  );
  const seatNoDb = pickSeatNo(activeSeatRows, maxPlayers);
  if (seatNoDb == null) {
    if (allowCreateFallback) return createAndRecommend(tx, createPayload);
    return { kind: "unavailable" };
  }
  await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
  return { kind: "recommended", tableId, seatNo: toUiSeatNo(seatNoDb, maxPlayers) };
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
  if (!isPlainObject(payload)) {
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

  try {
    const result = await beginSql(async (tx) => {
      const matchKey = `quickseat:${maxPlayers}`;
      const humanSeatFreshCutoffIso = new Date(Date.now() - resolveHumanSeatFreshMs(process.env.POKER_ACTIVE_HUMAN_SEAT_FRESH_MS)).toISOString();

      await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", [matchKey]);

      const existingRows = await selectExistingActiveSeat(tx, { userId: auth.userId });
      if (existingRows?.[0]?.id) {
        const recommendation = await recommendSeatAtTable(tx, {
          tableId: existingRows[0].id,
          userId: auth.userId,
          maxPlayers: existingRows[0].max_players,
          buyIn: existingRows[0].buy_in,
          tableStakes: existingRows[0].stakes,
          allowCreateFallback: false
        });
        if (recommendation.kind === "recommended") {
          return { ...recommendation, strategy: "already_seated" };
        }
      }

      const progression = await readPokerProgression(tx, { userId: auth.userId });
      const createPayload = { userId: auth.userId, maxPlayers, progression };

      const preferredRows = await selectCandidate(tx, {
        maxPlayers,
        requireHuman: true,
        humanSeatFreshCutoffIso,
        availableBuyIns: progression.availableBuyIns
      });
      for (const candidate of preferredRows || []) {
        const recommendation = await recommendSeatAtTable(tx, {
          tableId: candidate.id,
          userId: auth.userId,
          maxPlayers: candidate.max_players,
          buyIn: candidate.buy_in,
          tableStakes: candidate.stakes,
          progression,
          allowCreateFallback: false,
          createPayload,
        });
        if (recommendation.kind === "buy_in_tier_locked") return recommendation;
        if (recommendation.kind === "recommended") {
          return { ...recommendation, strategy: "prefer_humans" };
        }
      }

      const anyRows = await selectCandidate(tx, {
        maxPlayers,
        requireHuman: false,
        humanSeatFreshCutoffIso,
        availableBuyIns: progression.availableBuyIns
      });
      for (const candidate of anyRows || []) {
        const recommendation = await recommendSeatAtTable(tx, {
          tableId: candidate.id,
          userId: auth.userId,
          maxPlayers: candidate.max_players,
          buyIn: candidate.buy_in,
          tableStakes: candidate.stakes,
          progression,
          allowCreateFallback: false,
          createPayload,
        });
        if (recommendation.kind === "buy_in_tier_locked") return recommendation;
        if (recommendation.kind === "recommended") {
          return { ...recommendation, strategy: "any_open" };
        }
      }

      const createdRecommendation = await createAndRecommend(tx, createPayload);
      return createdRecommendation;
    });

    if (result?.kind === "buy_in_tier_locked") {
      klog("poker_quick_seat_buy_in_tier_locked", {
        buyIn: result.buyIn,
        requiredBankroll: result.requiredBankroll,
        maxPlayers,
        stakes: calculateCanonicalPokerStakes(result.buyIn)
      });
      return {
        statusCode: 409,
        headers: mergeHeaders(cors),
        body: JSON.stringify({
          error: "buy_in_tier_locked",
          buyIn: result.buyIn,
          requiredBuyIn: result.requiredBuyIn,
          requiredBankroll: result.requiredBankroll,
          balance: result.balance
        }),
      };
    }
    if (result?.kind !== "recommended" || typeof result?.tableId !== "string" || !result.tableId) {
      throw new Error("invalid_quick_seat_result");
    }

    if (result.strategy === "create") {
      triggerWsLobbyMaterialize({ tableId: result.tableId, maxPlayers, stakes: result.stakes || calculateCanonicalPokerStakes(result.buyIn), buyIn: result.buyIn, klog });
    }

    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ ok: true, tableId: result.tableId, seatNo: result.seatNo }),
    };
  } catch (error) {
    klog("poker_quick_seat_error", { message: error?.message || "unknown_error", userId: auth.userId });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
