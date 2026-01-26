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

const loadHoleCardsByUserId = async (tx, { tableId, handId, activeUserIds }) => {
  if (!Array.isArray(activeUserIds) || activeUserIds.length === 0) {
    throw new Error("state_invalid");
  }
  const rows = await tx.unsafe(
    "select user_id, cards from public.poker_hole_cards where table_id = $1 and hand_id = $2;",
    [tableId, handId]
  );
  const list = Array.isArray(rows) ? rows : [];
  const activeSet = new Set(activeUserIds);
  const map = {};
  for (const row of list) {
    const userId = row?.user_id;
    if (!activeSet.has(userId)) continue;
    map[userId] = normalizeCards(row.cards);
  }
  for (const userId of activeUserIds) {
    const cards = map[userId];
    if (!isValidTwoCards(cards)) {
      throw new Error("state_invalid");
    }
  }
  return { holeCardsByUserId: map };
};

export { isHoleCardsTableMissing, loadHoleCardsByUserId };
