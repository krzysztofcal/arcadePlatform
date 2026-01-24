import { compareHands, evaluateBestHand } from "./poker-eval.mjs";
import { isValidTwoCards } from "./poker-cards-utils.mjs";

const ensureArray = (value) => (Array.isArray(value) ? value : null);

const computeShowdown = ({ community, players }) => {
  const communityCards = ensureArray(community);
  if (!communityCards) throw new Error("invalid_state");
  if (!Array.isArray(players)) throw new Error("invalid_state");

  const handsByUserId = {};
  const revealedHoleCardsByUserId = {};
  let bestHand = null;
  let winners = [];

  for (const player of players) {
    const userId = typeof player?.userId === "string" ? player.userId.trim() : "";
    if (!userId) throw new Error("invalid_state");
    const holeCards = player?.holeCards;
    if (!isValidTwoCards(holeCards)) throw new Error("invalid_state");

    let hand;
    try {
      hand = evaluateBestHand(communityCards.concat(holeCards));
    } catch (error) {
      throw new Error("invalid_state");
    }

    handsByUserId[userId] = hand;
    revealedHoleCardsByUserId[userId] = holeCards;

    if (!bestHand) {
      bestHand = hand;
      winners = [userId];
      continue;
    }
    const cmp = compareHands(hand, bestHand);
    if (cmp > 0) {
      bestHand = hand;
      winners = [userId];
    } else if (cmp === 0) {
      winners.push(userId);
    }
  }

  return {
    winners,
    handsByUserId,
    revealedHoleCardsByUserId,
  };
};

export { computeShowdown };
