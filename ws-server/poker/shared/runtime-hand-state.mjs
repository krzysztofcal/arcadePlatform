import { dealHoleCards, deriveDeck, toCardCodes, toHoleCardCodeMap } from "./poker-primitives.mjs";

function normalizeSeatOrderFromPokerState(pokerState) {
  const sourceSeats = Array.isArray(pokerState?.handSeats) && pokerState.handSeats.length > 0
    ? pokerState.handSeats
    : pokerState?.seats;
  if (!Array.isArray(sourceSeats)) {
    return [];
  }
  return sourceSeats
    .filter((seatEntry) => typeof seatEntry?.userId === "string" && Number.isInteger(Number(seatEntry?.seatNo)))
    .slice()
    .sort((left, right) => Number(left.seatNo) - Number(right.seatNo) || left.userId.localeCompare(right.userId))
    .map((seatEntry) => seatEntry.userId.trim())
    .filter(Boolean);
}

function cardsMatchExact(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function deriveDeterministicRuntimeHandState(pokerState) {
  const handSeed = typeof pokerState?.handSeed === "string" ? pokerState.handSeed.trim() : "";
  const seatOrder = normalizeSeatOrderFromPokerState(pokerState);
  const communityDealt = Number.isInteger(pokerState?.communityDealt)
    ? pokerState.communityDealt
    : (Array.isArray(pokerState?.community) ? pokerState.community.length : -1);
  if (!handSeed || seatOrder.length === 0 || communityDealt < 0 || communityDealt > 5) {
    return null;
  }

  try {
    const shuffledDeck = deriveDeck(handSeed);
    const dealt = dealHoleCards(shuffledDeck, seatOrder);
    const derivedCommunity = toCardCodes(dealt.deck.slice(0, communityDealt));
    const authoritativeCommunity = Array.isArray(pokerState?.community) ? pokerState.community.slice() : null;
    if (authoritativeCommunity && authoritativeCommunity.length > 0 && !cardsMatchExact(authoritativeCommunity, derivedCommunity)) {
      return null;
    }
    return {
      handSeed,
      communityDealt,
      community: derivedCommunity,
      holeCardsByUserId: toHoleCardCodeMap(dealt.holeCardsByUserId),
      deck: toCardCodes(dealt.deck.slice(communityDealt))
    };
  } catch {
    return null;
  }
}
