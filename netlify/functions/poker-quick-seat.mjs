import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { createPokerTableWithState } from "./_shared/poker-table-init.mjs";
import { checkWsBuyInCapability, notifyWsLobbyMaterialize } from "./_shared/poker-ws-runtime-notify.mjs";
import { calculateUnlockBankroll, evaluatePokerBuyInAccess, readPokerProgression } from "../../shared/poker-domain/poker-progression.mjs";
import {
  calculateCanonicalPokerStakes,
  DEFAULT_CASH_TABLE_BUY_IN_CHIPS,
  isCanonicalPokerStakes
} from "../../shared/poker-domain/table-economy.mjs";
import { assertActivePokerTableCapacity, lockUserTableSlots } from "../../shared/poker-domain/table-participation.mjs";
import { hasPokerPoolSchema, readPokerAccessSnapshot } from "../../shared/poker-domain/bot-access.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";

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

const readQuickSeatEffectiveClass = async (tx, userId) => {
  const snapshot = await readPokerAccessSnapshot(tx, { userId });
  return snapshot?.effectiveClass || "UNKNOWN";
};

const recordQuickSeatRequest = async (tx, { tableId, userId, requestId, result }) => {
  if (!requestId || !tableId) return;
  await tx.unsafe(
    `
insert into public.poker_requests (table_id, user_id, request_id, kind, result_json)
values ($1, $2, $3, 'QUICK_SEAT', $4::jsonb)
on conflict (table_id, kind, request_id, user_id) do update
  set result_json = excluded.result_json;
    `,
    [tableId, userId, requestId, JSON.stringify(result)]
  );
};

const createAndRecommend = async (tx, { userId, maxPlayers, progression, ensureWsBuyInCapability, selectedBuyIn = null, isSinglePlayer = false, requestId = null }) => {
  const buyIn = selectedBuyIn ?? progression?.availableBuyIns?.[0];
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
  if (isSinglePlayer && buyIn > 1000) {
    return { kind: "invalid_buy_in" };
  }
  const canonicalStakes = calculateCanonicalPokerStakes(buyIn);
  if (!canonicalStakes) return { kind: "unavailable" };
  if (buyIn !== DEFAULT_CASH_TABLE_BUY_IN_CHIPS) {
    const capability = await ensureWsBuyInCapability(buyIn);
    if (!capability?.ok) return { kind: "ws_buy_in_capability_unavailable", buyIn };
  }
  const stakesJson = JSON.stringify(canonicalStakes);
  const created = await createPokerTableWithState(tx, {
    userId,
    maxPlayers,
    stakesJson,
    buyIn,
    userSlotLocked: true,
    isSinglePlayer
  });
  const tableId = created.tableId;
  await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
  const seatNoUi = 1;
  const recommendation = { kind: "recommended", tableId, seatNo: seatNoUi, strategy: "create", buyIn, stakes: canonicalStakes, isSinglePlayer };
  if (isSinglePlayer && requestId) {
    await recordQuickSeatRequest(tx, { tableId, userId, requestId, result: recommendation });
  }
  return recommendation;
};

const triggerWsLobbyMaterialize = ({ tableId, maxPlayers, stakes, buyIn, isSinglePlayer = false, klog }) => {
  if (typeof tableId !== "string" || !tableId) return;
  void notifyWsLobbyMaterialize({ tableId, maxPlayers, stakes, buyIn, isSinglePlayer, klog });
};

const selectExistingActiveSeat = async (tx, { userId, isSinglePlayer = false, tableId = null }) => {
  const params = [userId, Boolean(isSinglePlayer)];
  let tableIdFilter = "";
  if (typeof tableId === "string" && tableId) {
    params.push(tableId);
    tableIdFilter = `and t.id = $${params.length}`;
  }
  return tx.unsafe(
    `
select t.id, t.max_players, t.buy_in, t.stakes
from public.poker_tables t
join public.poker_seats s on s.table_id = t.id
where t.status = 'OPEN'
  and s.user_id = $1
  and s.status = 'ACTIVE'
  and coalesce(t.is_single_player, false) = $2
  ${isSinglePlayer ? "and t.created_by = $1" : ""}
  ${tableIdFilter}
order by coalesce(s.last_seen_at, s.created_at) desc, t.last_activity_at desc nulls last, t.created_at desc, t.id desc
limit 1;
    `,
    params
  );
};

const selectSinglePlayerTableByRequestId = async (tx, { userId, requestId }) => {
  if (!requestId) return [];
  return tx.unsafe(
    `
select t.id, t.max_players, t.buy_in, t.stakes, t.status, r.result_json
from public.poker_requests r
join public.poker_tables t on t.id = r.table_id
where r.user_id = $1
  and r.request_id = $2
  and r.kind = 'QUICK_SEAT'
  and t.is_single_player = true
  and t.created_by = $1
limit 1;
    `,
    [userId, requestId]
  );
};

const selectCandidate = async (tx, { maxPlayers, requireHuman, humanSeatFreshCutoffIso, availableBuyIns, effectiveClass = "NORMAL" }) => {
  return tx.unsafe(
    `
select t.id, t.max_players, t.buy_in, t.stakes
from public.poker_tables t
where t.status = 'OPEN'
  and coalesce(t.is_single_player, false) = false
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
  ${await hasPokerPoolSchema(tx) ? `and (
    ($5::text = 'NORMAL' and coalesce(t.is_slow_only, false) = false)
    or ($5::text = 'SLOW' and coalesce(t.is_slow_only, false) = true)
    or ($5::text = 'RESTRICTED'
      and t.lifecycle_kind = 'STANDARD'
      and coalesce(t.is_slow_only, false) = false
      and not exists (
        select 1
        from public.poker_seats restricted_bots
        where restricted_bots.table_id = t.id
          and restricted_bots.status = 'ACTIVE'
          and coalesce(restricted_bots.is_bot, false) = true
      )
      and not exists (
        select 1
        from public.chips_transactions restricted_funding
        where restricted_funding.metadata ->> 'tableId' = t.id::text
          and restricted_funding.metadata ->> 'actor' = 'BOT'
      )
    )
  )` : ""}
  and t.buy_in = any($4::int[])
order by t.last_activity_at desc nulls last, t.created_at asc nulls last
limit 50;
    `,
    [maxPlayers, requireHuman, humanSeatFreshCutoffIso, availableBuyIns, ...(await hasPokerPoolSchema(tx) ? [effectiveClass] : [])]
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
    enabledBuyIns: progression?.enabledBuyIns,
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
  return {
    kind: "recommended",
    tableId,
    seatNo: toUiSeatNo(seatNoDb, maxPlayers),
    buyIn: normalizedBuyIn,
    requiresWsBuyInCapability: normalizedBuyIn !== DEFAULT_CASH_TABLE_BUY_IN_CHIPS
  };
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

  const isSinglePlayer = payload?.mode === "single"
    || payload?.mode === "single_player"
    || payload?.singlePlayer === true;

  const reqIdResult = normalizeRequestId(payload?.requestId);
  if (!reqIdResult.ok && payload?.requestId !== undefined && payload?.requestId !== null) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = reqIdResult.value;

  const requestedTableId = typeof payload?.tableId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.tableId.trim())
    ? payload.tableId.trim().toLowerCase()
    : null;

  if (isSinglePlayer && !requestedTableId && !requestId) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "missing_request_id" }) };
  }

  const maxPlayers = parseMaxPlayers(payload?.maxPlayers);
  if (maxPlayers == null) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_max_players" }) };
  }

  const selectedBuyIn = Object.prototype.hasOwnProperty.call(payload, "buyIn") ? payload.buyIn : null;
  if (Object.prototype.hasOwnProperty.call(payload, "buyIn")
    && (typeof selectedBuyIn !== "number" || !Number.isSafeInteger(selectedBuyIn) || selectedBuyIn <= 0)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_buy_in" }) };
  }
  if (isSinglePlayer && selectedBuyIn !== null && selectedBuyIn > 1000) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_buy_in" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const wsBuyInCapability = await checkWsBuyInCapability({ klog });
  const ensureWsBuyInCapability = async (buyIn) => {
    if (Number(buyIn) === DEFAULT_CASH_TABLE_BUY_IN_CHIPS) return { ok: true, skipped: true };
    return wsBuyInCapability;
  };

  try {
    const result = await beginSql(async (tx) => {
      const matchKey = isSinglePlayer ? `quickseat:sp:${auth.userId}` : `quickseat:${maxPlayers}`;
      const humanSeatFreshCutoffIso = new Date(Date.now() - resolveHumanSeatFreshMs(process.env.POKER_ACTIVE_HUMAN_SEAT_FRESH_MS)).toISOString();

      if (await hasPokerPoolSchema(tx)) await lockUserTableSlots(tx, auth.userId);
      await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", [matchKey]);

      if (!isSinglePlayer) {
        const existingRows = await selectExistingActiveSeat(tx, { userId: auth.userId, isSinglePlayer: false, tableId: requestedTableId });
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
      }

      const progression = await readPokerProgression(tx, { userId: auth.userId, isSinglePlayer });
      progression.pokerAccess = { effectiveClass: await readQuickSeatEffectiveClass(tx, auth.userId) };
      if (progression.pokerAccess.effectiveClass !== "NORMAL"
        && progression.pokerAccess.effectiveClass !== "SLOW"
        && progression.pokerAccess.effectiveClass !== "RESTRICTED") {
        return { kind: "poker_access_unavailable" };
      }
      if (isSinglePlayer && progression.pokerAccess.effectiveClass === "RESTRICTED") {
        return { kind: "single_player_restricted_unavailable" };
      }

      if (isSinglePlayer) {
        if (requestedTableId) {
          const existingRows = await selectExistingActiveSeat(tx, { userId: auth.userId, isSinglePlayer: true, tableId: requestedTableId });
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
          return { kind: "unavailable", reason: "seat_not_found" };
        }

        const replayRows = await selectSinglePlayerTableByRequestId(tx, { userId: auth.userId, requestId });
        if (replayRows?.[0]?.id) {
          const replayed = replayRows[0];
          if (selectedBuyIn !== null && Number(replayed.buy_in) !== selectedBuyIn) {
            return { kind: "invalid_buy_in" };
          }
          if (String(replayed.status || "").toUpperCase() !== "OPEN") {
            return { kind: "table_closed" };
          }
          await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [replayed.id]);
          return {
            kind: "recommended",
            tableId: replayed.id,
            seatNo: 1,
            strategy: "idempotent_replay",
            buyIn: replayed.buy_in,
            stakes: replayed.stakes,
            isSinglePlayer: true
          };
        }

        progression.availableBuyIns = (progression.availableBuyIns || []).filter((b) => b <= 1000);
        progression.enabledBuyIns = (progression.enabledBuyIns || []).filter((b) => b <= 1000);

        if (selectedBuyIn !== null && !progression.availableBuyIns.includes(selectedBuyIn)) {
          const tier = progression.tiers.find((item) => item.buyIn === selectedBuyIn);
          return {
            kind: "buy_in_tier_locked",
            balance: progression.balance,
            buyIn: selectedBuyIn,
            requiredBuyIn: selectedBuyIn,
            requiredBankroll: tier?.unlockBankroll ?? null
          };
        }
        if (selectedBuyIn === null && (!progression.availableBuyIns || progression.availableBuyIns.length === 0)) {
          const firstTier = progression?.tiers?.find((item) => item.buyIn <= 1000) || progression?.tiers?.[0] || null;
          return {
            kind: "buy_in_tier_locked",
            balance: progression.balance,
            buyIn: firstTier?.buyIn ?? null,
            requiredBuyIn: firstTier?.buyIn ?? null,
            requiredBankroll: firstTier?.unlockBankroll ?? null
          };
        }

        if (await hasPokerPoolSchema(tx)) {
          await assertActivePokerTableCapacity(tx, auth.userId);
        }
        const createPayload = { userId: auth.userId, maxPlayers, progression, ensureWsBuyInCapability, selectedBuyIn, isSinglePlayer };
        const createdRecommendation = await createAndRecommend(tx, { ...createPayload, requestId });
        return createdRecommendation;
      }


      if (selectedBuyIn !== null && !progression.availableBuyIns.includes(selectedBuyIn)) {
        const tier = progression.tiers.find((item) => item.buyIn === selectedBuyIn);
        return {
          kind: "buy_in_tier_locked",
          balance: progression.balance,
          buyIn: selectedBuyIn,
          requiredBuyIn: selectedBuyIn,
          requiredBankroll: tier?.unlockBankroll ?? null
        };
      }
      const availableBuyIns = selectedBuyIn === null ? progression.availableBuyIns : [selectedBuyIn];
      const createPayload = { userId: auth.userId, maxPlayers, progression, ensureWsBuyInCapability, selectedBuyIn, isSinglePlayer: false };

      const preferredRows = await selectCandidate(tx, {
        maxPlayers,
        requireHuman: true,
        humanSeatFreshCutoffIso,
        availableBuyIns,
        effectiveClass: progression.pokerAccess?.effectiveClass || "UNKNOWN"
      });
      for (const candidate of preferredRows || []) {
        if (selectedBuyIn !== null && Number(candidate.buy_in) !== selectedBuyIn) continue;
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
        availableBuyIns,
        effectiveClass: progression.pokerAccess?.effectiveClass || "UNKNOWN"
      });
      for (const candidate of anyRows || []) {
        if (selectedBuyIn !== null && Number(candidate.buy_in) !== selectedBuyIn) continue;
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

    if (result?.kind === "invalid_buy_in") {
      return {
        statusCode: 400,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: "invalid_buy_in" })
      };
    }
    if (result?.kind === "table_closed") {
      return {
        statusCode: 409,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: "table_closed" })
      };
    }
    if (result?.kind === "recommended" && result.requiresWsBuyInCapability) {
      const capability = await ensureWsBuyInCapability(result.buyIn);
      if (!capability?.ok) {
        klog("poker_quick_seat_buy_in_capability_unavailable", {
          buyIn: result.buyIn,
          maxPlayers,
          reason: capability?.reason || "unknown"
        });
        return {
          statusCode: 503,
          headers: mergeHeaders(cors),
          body: JSON.stringify({ error: "ws_buy_in_capability_unavailable" })
        };
      }
    }
    if (result?.kind === "ws_buy_in_capability_unavailable") {
      klog("poker_quick_seat_buy_in_capability_unavailable", {
        buyIn: result.buyIn,
        maxPlayers,
        reason: "buy_in_capability_unavailable"
      });
      return {
        statusCode: 503,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: "ws_buy_in_capability_unavailable" })
      };
    }
    if (result?.kind === "poker_access_unavailable") {
      return {
        statusCode: 503,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: "poker_access_unavailable" })
      };
    }
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
    if (result?.kind === "single_player_restricted_unavailable") {
      return {
        statusCode: 403,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: "single_player_restricted_unavailable" })
      };
    }
    if (result?.kind !== "recommended" || typeof result?.tableId !== "string" || !result.tableId) {
      if (result?.kind === "unavailable") {
        return { statusCode: 404, headers: mergeHeaders(cors), body: JSON.stringify({ error: result.reason || "table_unavailable" }) };
      }
      throw new Error("invalid_quick_seat_result");
    }

    if (result.strategy === "create") {
      triggerWsLobbyMaterialize({
        tableId: result.tableId,
        maxPlayers,
        stakes: result.stakes || calculateCanonicalPokerStakes(result.buyIn),
        buyIn: result.buyIn,
        isSinglePlayer: result.isSinglePlayer === true,
        klog
      });
    }

    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ ok: true, tableId: result.tableId, seatNo: result.seatNo }),
    };
  } catch (error) {
    if (error?.code === "pending_table_limit" || error?.code === "active_table_limit") {
      return {
        statusCode: 409,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: error.code, limit: 4 })
      };
    }
    klog("poker_quick_seat_error", { message: error?.message || "unknown_error", userId: auth.userId });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
