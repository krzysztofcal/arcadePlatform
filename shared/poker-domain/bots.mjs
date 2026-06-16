import { createHash } from "node:crypto";

const TRUE_SET = new Set(["1", "true", "yes"]);
const FALSE_SET = new Set(["0", "false", "no"]);
const MAX_STAKES = 1_000_000;

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}

function parseBool(value, fallback = false) {
  const normalized = normalizeString(value).toLowerCase();
  if (TRUE_SET.has(normalized)) return true;
  if (FALSE_SET.has(normalized)) return false;
  return fallback;
}

function parseIntClamped(value, fallback, min, max) {
  const parsed = Number.parseInt(normalizeString(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseProfile(value, fallback = "TRIVIAL") {
  const normalized = normalizeString(value).toUpperCase();
  return normalized || fallback;
}

function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function toUuidLike(input) {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return `${toHex(bytes.subarray(0, 4))}-${toHex(bytes.subarray(4, 6))}-${toHex(bytes.subarray(6, 8))}-${toHex(bytes.subarray(8, 10))}-${toHex(bytes.subarray(10, 16))}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeInt(value) {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
}

function parseSlashStakes(value) {
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return { sb: normalizeInt(match[1]), bb: normalizeInt(match[2]) };
}

function parseStakes(raw) {
  if (raw == null) return { ok: false, error: "stakes_missing" };
  if (isPlainObject(raw)) {
    const sb = normalizeInt(raw.sb);
    const bb = normalizeInt(raw.bb);
    if (sb == null || bb == null || sb < 0 || bb <= 0 || sb >= bb || sb > MAX_STAKES || bb > MAX_STAKES) {
      return { ok: false, error: "invalid_stakes" };
    }
    return { ok: true, value: { sb, bb } };
  }
  if (Array.isArray(raw) || typeof raw !== "string") return { ok: false, error: "invalid_stakes" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "stakes_missing" };
  const slash = parseSlashStakes(trimmed);
  if (slash) return parseStakes(slash);
  try {
    return parseStakes(JSON.parse(trimmed));
  } catch {
    return { ok: false, error: "invalid_stakes" };
  }
}

function getBotConfig(env = process.env) {
  return {
    enabled: parseBool(env?.POKER_BOTS_ENABLED, false),
    maxPerTable: parseIntClamped(env?.POKER_BOTS_MAX_PER_TABLE, 2, 0, 9),
    defaultProfile: parseProfile(env?.POKER_BOT_PROFILE_DEFAULT, "TRIVIAL"),
    buyInBB: parseIntClamped(env?.POKER_BOT_BUYIN_BB, 100, 1, 1000),
    bankrollSystemKey: normalizeString(env?.POKER_BOT_BANKROLL_SYSTEM_KEY) || "TREASURY"
  };
}

function makeBotUserId(tableId, seatNo) {
  return toUuidLike(`${tableId ?? ""}:${seatNo ?? ""}`);
}

function makeBotSystemKey(tableId, seatNo) {
  return `POKER_BOT:${tableId}:${seatNo}`;
}

export function computeTargetBotCount({ maxPlayers, humanCount, maxBots } = {}) {
  const totalSeats = Number.isFinite(Number(maxPlayers)) ? Math.trunc(Number(maxPlayers)) : 0;
  const humans = Number.isFinite(Number(humanCount)) ? Math.trunc(Number(humanCount)) : 0;
  const limit = Number.isFinite(Number(maxBots)) ? Math.trunc(Number(maxBots)) : 0;
  if (humans <= 0 || humans >= totalSeats) return 0;
  return Math.max(0, Math.min(Math.max(0, limit), Math.max(0, (totalSeats - humans) - 1)));
}

export function shouldSeedBotsOnJoin({ humanCount } = {}) {
  return Number(humanCount) === 1;
}

function normalizeSeatNo(value) {
  const seatNo = Number(value);
  return Number.isInteger(seatNo) && seatNo >= 1 ? seatNo : null;
}

function normalizeStack(value) {
  const stack = Number(value);
  return Number.isInteger(stack) && stack >= 0 ? stack : null;
}

function asSeatSnapshot(entry) {
  const seatNo = normalizeSeatNo(entry?.seatNo ?? entry?.seat_no ?? entry?.seat);
  const userId = typeof entry?.userId === "string" ? entry.userId : typeof entry?.user_id === "string" ? entry.user_id : "";
  if (!seatNo || !userId) return null;
  const snapshot = {
    userId,
    seatNo,
    status: typeof entry?.status === "string" ? entry.status : "ACTIVE"
  };
  if (entry?.isBot === true || entry?.is_bot === true) snapshot.isBot = true;
  const botProfile = typeof entry?.botProfile === "string" ? entry.botProfile : typeof entry?.bot_profile === "string" ? entry.bot_profile : "";
  if (botProfile) snapshot.botProfile = botProfile;
  if (entry?.leaveAfterHand === true || entry?.leave_after_hand === true) snapshot.leaveAfterHand = true;
  return snapshot;
}

function mergeSeatSnapshots(existingSeats, incomingSeats) {
  const nextByUserId = new Map();
  for (const entry of Array.isArray(existingSeats) ? existingSeats : []) {
    const normalized = asSeatSnapshot(entry);
    if (normalized) nextByUserId.set(normalized.userId, normalized);
  }
  for (const entry of Array.isArray(incomingSeats) ? incomingSeats : []) {
    const normalized = asSeatSnapshot(entry);
    if (normalized) nextByUserId.set(normalized.userId, normalized);
  }
  return Array.from(nextByUserId.values()).sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId));
}

function mergeStacks(existingStacks, incomingEntries) {
  const base = existingStacks && typeof existingStacks === "object" && !Array.isArray(existingStacks) ? { ...existingStacks } : {};
  for (const [userId, stack] of Array.isArray(incomingEntries) ? incomingEntries : []) {
    if (typeof userId !== "string" || !userId) continue;
    const normalizedStack = normalizeStack(stack);
    if (normalizedStack === null) continue;
    base[userId] = normalizedStack;
  }
  return base;
}

function applySeatsAndStacksToState(state, { tableId, seatEntries = [], stackEntries = [] } = {}) {
  const currentState = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  return {
    ...currentState,
    tableId: currentState.tableId || tableId,
    seats: mergeSeatSnapshots(currentState.seats, seatEntries),
    stacks: mergeStacks(currentState.stacks, stackEntries)
  };
}

async function loadSeatRows(tx, tableId) {
  const rows = await tx.unsafe(
    "select user_id, seat_no, status, is_bot, bot_profile, leave_after_hand, stack from public.poker_seats where table_id = $1 order by seat_no asc;",
    [tableId]
  );
  return Array.isArray(rows) ? rows : [];
}

async function seedBotsForJoin({ tx, tableId, maxPlayers, tableStakes, cfg, humanUserId, postTransaction, klog = () => {} }) {
  if (!cfg?.enabled || typeof postTransaction !== "function") return [];
  const stakesParsed = parseStakes(tableStakes);
  if (!stakesParsed.ok) {
    klog("poker_join_bot_seed_skip_invalid_stakes", { tableId, stakes: tableStakes ?? null });
    return [];
  }

  const seatRows = await loadSeatRows(tx, tableId);
  const activeSeats = seatRows.filter((row) => String(row?.status || "ACTIVE").toUpperCase() === "ACTIVE");
  const humanCount = activeSeats.filter((row) => !row?.is_bot).length;
  if (!shouldSeedBotsOnJoin({ humanCount })) return [];

  const targetBots = computeTargetBotCount({ maxPlayers, humanCount, maxBots: cfg.maxPerTable });
  if (!Number.isInteger(targetBots) || targetBots <= 0) return [];

  const existingBotCount = activeSeats.filter((row) => row?.is_bot).length;
  const toSeed = Math.max(0, targetBots - existingBotCount);
  if (toSeed <= 0) return [];

  const occupied = new Set(activeSeats.map((row) => normalizeSeatNo(row?.seat_no)).filter(Boolean));
  const buyInChips = Math.max(1, Math.trunc(Number(cfg.buyInBB) * Number(stakesParsed.value.bb)));
  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  const seededBots = [];

  for (let seatNo = 1; seatNo <= maxPlayers && seededBots.length < toSeed; seatNo += 1) {
    if (occupied.has(seatNo)) continue;
    const botUserId = makeBotUserId(tableId, seatNo);
    const botSystemKey = makeBotSystemKey(tableId, seatNo);
    const insertRows = await tx.unsafe(
      `
insert into public.poker_seats (table_id, user_id, seat_no, status, is_bot, bot_profile, leave_after_hand, stack, last_seen_at, joined_at)
values ($1, $2, $3, 'ACTIVE', true, $4, false, $5, now(), now())
on conflict do nothing
returning seat_no;
      `,
      [tableId, botUserId, seatNo, cfg.defaultProfile, buyInChips]
    );
    if (!insertRows?.length) continue;

    try {
      await postTransaction({
        userId: null,
        txType: "TABLE_BUY_IN",
        idempotencyKey: `bot-seed-buyin:${tableId}:${seatNo}`,
        metadata: {
          actor: "BOT",
          botUserId,
          botSystemKey,
          tableId,
          seatNo,
          botProfile: cfg.defaultProfile,
          reason: "BOT_SEED_BUY_IN"
        },
        entries: [
          { accountType: "SYSTEM", systemKey: cfg.bankrollSystemKey, amount: -buyInChips },
          { accountType: "ESCROW", systemKey: escrowSystemKey, amount: buyInChips }
        ],
        createdBy: humanUserId,
        tx
      });
      seededBots.push({
        userId: botUserId,
        seatNo,
        status: "ACTIVE",
        isBot: true,
        botProfile: cfg.defaultProfile,
        leaveAfterHand: false,
        stack: buyInChips
      });
      occupied.add(seatNo);
    } catch (error) {
      await tx.unsafe(
        "delete from public.poker_seats where table_id = $1 and user_id = $2 and seat_no = $3 and coalesce(is_bot, false) = true;",
        [tableId, botUserId, seatNo]
      );
      klog("poker_join_bot_seed_failed", { tableId, seatNo, botUserId, reason: error?.code || error?.message || "unknown_error" });
    }
  }

  return seededBots;
}

export {
  applySeatsAndStacksToState,
  asSeatSnapshot,
  getBotConfig,
  loadSeatRows,
  makeBotSystemKey,
  makeBotUserId,
  parseStakes,
  seedBotsForJoin
};
