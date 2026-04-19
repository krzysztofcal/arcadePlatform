function normalizeSeat(value) {
  return Number.isInteger(value) ? value : null;
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeMemberCount(value, members) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  return members.length;
}

function stableMembers(members) {
  const rows = Array.isArray(members) ? members : [];
  return rows
    .filter((member) => member && typeof member.userId === "string" && Number.isInteger(member.seat))
    .map((member) => ({ userId: member.userId, seat: member.seat }))
    .sort((a, b) => {
      if (a.seat !== b.seat) {
        return a.seat - b.seat;
      }
      return a.userId.localeCompare(b.userId);
    });
}

function normalizeCards(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards.filter((card) => typeof card === "string");
}

function normalizeActionList(actions) {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions.filter((action) => typeof action === "string");
}

function normalizeSeatRows(seats) {
  if (!Array.isArray(seats)) {
    return [];
  }
  return seats
    .filter((seat) => seat && typeof seat.userId === "string" && Number.isInteger(seat.seatNo))
    .map((seat) => {
      const normalized = {
        userId: seat.userId,
        seatNo: seat.seatNo,
        status: typeof seat.status === "string" ? seat.status : "ACTIVE"
      };
      if (seat.isBot === true) normalized.isBot = true;
      if (typeof seat.botProfile === "string" && seat.botProfile) normalized.botProfile = seat.botProfile;
      if (seat.leaveAfterHand === true) normalized.leaveAfterHand = true;
      return normalized;
    });
}

function normalizeStacks(stacks) {
  if (!stacks || typeof stacks !== "object" || Array.isArray(stacks)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(stacks).filter(([userId, amount]) => typeof userId === "string" && userId && Number.isFinite(Number(amount)))
      .map(([userId, amount]) => [userId, Number(amount)])
  );
}

function normalizeNumericUserMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([userId, amount]) => typeof userId === "string" && userId && Number.isFinite(Number(amount)))
      .map(([userId, amount]) => [userId, Number(amount)])
  );
}

function normalizeTurnTimerField(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeLastBettingRoundActionByUserId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const allowed = new Set(["fold", "check", "call", "raise", "all_in"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([userId, action]) => typeof userId === "string" && userId && typeof action === "string" && allowed.has(action))
  );
}

function normalizeShowdown(showdown) {
  if (!showdown || typeof showdown !== "object" || Array.isArray(showdown)) {
    return null;
  }
  const normalized = {
    winners: Array.isArray(showdown.winners) ? showdown.winners.filter((userId) => typeof userId === "string") : [],
    potsAwarded: Array.isArray(showdown.potsAwarded) ? showdown.potsAwarded : [],
    potAwardedTotal: Number.isFinite(showdown.potAwardedTotal)
      ? showdown.potAwardedTotal
      : Number.isFinite(showdown.potAwarded)
        ? showdown.potAwarded
        : 0,
    reason: typeof showdown.reason === "string" ? showdown.reason : null,
    handId: typeof showdown.handId === "string" ? showdown.handId : null
  };
  if (Array.isArray(showdown.revealedShowdownParticipants)) {
    normalized.revealedShowdownParticipants = showdown.revealedShowdownParticipants
      .filter((entry) => entry && typeof entry.userId === "string")
      .map((entry) => ({
        userId: entry.userId,
        holeCards: normalizeCards(entry.holeCards)
      }))
      .filter((entry) => entry.holeCards.length === 2);
  }
  return normalized;
}

function normalizeHandSettlement(handSettlement) {
  if (!handSettlement || typeof handSettlement !== "object" || Array.isArray(handSettlement)) {
    return null;
  }
  return {
    handId: typeof handSettlement.handId === "string" ? handSettlement.handId : null,
    settledAt: typeof handSettlement.settledAt === "string" ? handSettlement.settledAt : null,
    payouts: handSettlement.payouts && typeof handSettlement.payouts === "object" && !Array.isArray(handSettlement.payouts)
      ? handSettlement.payouts
      : {}
  };
}

function normalizePrivateBranch(privateBranch, { userId, youSeat }) {
  const base = { userId, seat: youSeat };
  if (!privateBranch || typeof privateBranch !== "object" || Array.isArray(privateBranch)) {
    return base;
  }

  const holeCards = normalizeCards(privateBranch.holeCards);
  return {
    ...base,
    holeCards
  };
}

export function buildStateSnapshotPayload({ tableSnapshot, userId }) {
  const tableId = normalizeString(tableSnapshot?.tableId);
  const stateVersion = Number.isInteger(tableSnapshot?.stateVersion) ? tableSnapshot.stateVersion : 0;
  const maxSeats = Number.isInteger(tableSnapshot?.maxSeats) ? tableSnapshot.maxSeats : null;
  const members = stableMembers(tableSnapshot?.members);
  const memberCount = normalizeMemberCount(tableSnapshot?.memberCount, members);
  const youSeat = normalizeSeat(tableSnapshot?.youSeat);

  const table = {
    tableId,
    members,
    memberCount
  };

  if (maxSeats !== null) {
    table.maxSeats = maxSeats;
  }

  const payload = {
    stateVersion,
    table,
    you: {
      userId,
      seat: youSeat
    },
    public: {
      roomId: normalizeString(tableSnapshot?.roomId) || tableId,
      hand: {
        handId: typeof tableSnapshot?.hand?.handId === "string" ? tableSnapshot.hand.handId : null,
        status: typeof tableSnapshot?.hand?.status === "string" ? tableSnapshot.hand.status : null,
        round: typeof tableSnapshot?.hand?.round === "string" ? tableSnapshot.hand.round : null,
        dealerSeatNo: Number.isInteger(tableSnapshot?.hand?.dealerSeatNo)
          ? tableSnapshot.hand.dealerSeatNo
          : (Number.isInteger(tableSnapshot?.dealerSeatNo) ? tableSnapshot.dealerSeatNo : null)
      },
      board: {
        cards: normalizeCards(tableSnapshot?.board?.cards)
      },
      seats: normalizeSeatRows(tableSnapshot?.seats),
      stacks: normalizeStacks(tableSnapshot?.stacks),
      betThisRoundByUserId: normalizeNumericUserMap(tableSnapshot?.betThisRoundByUserId),
      committedByUserId: normalizeNumericUserMap(tableSnapshot?.committedByUserId),
      pot: {
        total: Number.isFinite(tableSnapshot?.pot?.total) ? tableSnapshot.pot.total : null,
        sidePots: Array.isArray(tableSnapshot?.pot?.sidePots) ? tableSnapshot.pot.sidePots : []
      },
      turn: {
        userId: typeof tableSnapshot?.turn?.userId === "string" ? tableSnapshot.turn.userId : null,
        seat: normalizeSeat(tableSnapshot?.turn?.seat),
        startedAt: normalizeTurnTimerField(tableSnapshot?.turn?.startedAt),
        deadlineAt: normalizeTurnTimerField(tableSnapshot?.turn?.deadlineAt)
      },
      legalActions: {
        seat: normalizeSeat(tableSnapshot?.legalActions?.seat),
        actions: normalizeActionList(tableSnapshot?.legalActions?.actions)
      },
      actionConstraints: {
        toCall: Number.isFinite(tableSnapshot?.actionConstraints?.toCall) ? Number(tableSnapshot.actionConstraints.toCall) : null,
        minRaiseTo: Number.isFinite(tableSnapshot?.actionConstraints?.minRaiseTo) ? Number(tableSnapshot.actionConstraints.minRaiseTo) : null,
        maxRaiseTo: Number.isFinite(tableSnapshot?.actionConstraints?.maxRaiseTo) ? Number(tableSnapshot.actionConstraints.maxRaiseTo) : null,
        maxBetAmount: Number.isFinite(tableSnapshot?.actionConstraints?.maxBetAmount) ? Number(tableSnapshot.actionConstraints.maxBetAmount) : null
      },
      lastBettingRoundActionByUserId: normalizeLastBettingRoundActionByUserId(tableSnapshot?.lastBettingRoundActionByUserId)
    }
  };

  if (youSeat !== null) {
    payload.private = normalizePrivateBranch(tableSnapshot?.private, { userId, youSeat });
  }

  const showdown = normalizeShowdown(tableSnapshot?.showdown);
  if (showdown) {
    payload.public.showdown = showdown;
  }

  const handSettlement = normalizeHandSettlement(tableSnapshot?.handSettlement);
  if (handSettlement) {
    payload.public.handSettlement = handSettlement;
  }

  return payload;
}
