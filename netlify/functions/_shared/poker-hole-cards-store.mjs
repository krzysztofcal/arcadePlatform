import { isValidTwoCards } from "./poker-cards-utils.mjs";

const isHoleCardsTableMissing = (error) => {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("poker_hole_cards") && message.includes("does not exist");
};

const normalizeCards = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const loadHoleCardsByUserId = async (
  tx,
  { tableId, handId, activeUserIds, requiredUserIds, mode = "legacy", selfHealInvalid = false }
) => {
  if (!Array.isArray(activeUserIds) || activeUserIds.length === 0) {
    throw new Error("state_invalid");
  }
  const hasRequiredIds = Array.isArray(requiredUserIds) && requiredUserIds.length > 0;
  const requiredIds = hasRequiredIds ? requiredUserIds : activeUserIds;
  if (!Array.isArray(requiredIds) || requiredIds.length === 0) {
    throw new Error("state_invalid");
  }
  if (mode === "strict" && !hasRequiredIds) {
    throw new Error("state_invalid");
  }

  const rows = await tx.unsafe(
    "select user_id, cards from public.poker_hole_cards where table_id = $1 and hand_id = $2;",
    [tableId, handId]
  );
  const list = Array.isArray(rows) ? rows : [];
  const activeSet = new Set(activeUserIds);
  const map = {};
  const statusByUserId = {};
  const isSoft = mode === "soft";

  for (const row of list) {
    const userId = row?.user_id;
    if (!activeSet.has(userId)) continue;
    map[userId] = normalizeCards(row.cards);
  }

  for (const userId of activeUserIds) {
    if (!Object.prototype.hasOwnProperty.call(map, userId)) continue;
    if (!isValidTwoCards(map[userId])) {
      statusByUserId[userId] = "INVALID";
    }
  }

  for (const userId of requiredIds) {
    if (!Object.prototype.hasOwnProperty.call(map, userId)) {
      statusByUserId[userId] = "MISSING";
      continue;
    }
    if (!isValidTwoCards(map[userId])) {
      statusByUserId[userId] = "INVALID";
    }
  }

  if (isSoft) {
    for (const userId of requiredIds) {
      if (statusByUserId[userId] === "INVALID") {
        delete map[userId];
      }
    }
  }

  if (selfHealInvalid) {
    const invalidUsersToDelete = requiredIds.filter((userId) => statusByUserId[userId] === "INVALID");
    if (invalidUsersToDelete.length > 0) {
      await tx.unsafe(
        "delete from public.poker_hole_cards where table_id = $1 and hand_id = $2 and user_id = any($3::text[]);",
        [tableId, handId, invalidUsersToDelete]
      );
      for (const userId of invalidUsersToDelete) {
        delete map[userId];
      }
    }
  }

  if ((mode === "strict" || mode === "legacy") && requiredIds.some((userId) => statusByUserId[userId])) {
    throw new Error("state_invalid");
  }

  return { holeCardsByUserId: map, holeCardsStatusByUserId: statusByUserId };
};

export { isHoleCardsTableMissing, loadHoleCardsByUserId };
