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
        round: typeof tableSnapshot?.hand?.round === "string" ? tableSnapshot.hand.round : null
      },
      board: {
        cards: normalizeCards(tableSnapshot?.board?.cards)
      },
      pot: {
        total: Number.isFinite(tableSnapshot?.pot?.total) ? tableSnapshot.pot.total : null,
        sidePots: Array.isArray(tableSnapshot?.pot?.sidePots) ? tableSnapshot.pot.sidePots : []
      },
      turn: {
        userId: typeof tableSnapshot?.turn?.userId === "string" ? tableSnapshot.turn.userId : null,
        seat: normalizeSeat(tableSnapshot?.turn?.seat)
      },
      legalActions: {
        seat: normalizeSeat(tableSnapshot?.legalActions?.seat),
        actions: normalizeActionList(tableSnapshot?.legalActions?.actions)
      }
    }
  };

  if (youSeat !== null) {
    payload.private = normalizePrivateBranch(tableSnapshot?.private, { userId, youSeat });
  }

  return payload;
}
