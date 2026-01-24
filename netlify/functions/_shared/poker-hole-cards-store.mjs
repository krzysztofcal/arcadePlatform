import { isValidTwoCards } from "./poker-cards-utils.mjs";

const isHoleCardsTableMissing = (error) => {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("poker_hole_cards") && message.includes("does not exist");
};

const loadHoleCardsByUserId = async (tx, { tableId, handId, activeUserIds }) => {
  const rows = await tx.unsafe(
    "select user_id, cards from public.poker_hole_cards where table_id = $1 and hand_id = $2;",
    [tableId, handId]
  );
  const map = {};
  for (const row of rows || []) {
    if (!row?.user_id) continue;
    map[row.user_id] = row.cards;
  }
  if (!Array.isArray(activeUserIds) || activeUserIds.length === 0) {
    throw new Error("state_invalid");
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
