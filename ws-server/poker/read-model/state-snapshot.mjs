function normalizeSeat(value) {
  return Number.isInteger(value) ? value : null;
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

export function buildStateSnapshotPayload({ tableSnapshot, userId }) {
  const tableId = typeof tableSnapshot?.tableId === "string" ? tableSnapshot.tableId : "";
  const stateVersion = Number.isInteger(tableSnapshot?.stateVersion) ? tableSnapshot.stateVersion : 0;
  const maxSeats = Number.isInteger(tableSnapshot?.maxSeats) ? tableSnapshot.maxSeats : null;
  const members = stableMembers(tableSnapshot?.members);
  const youSeat = normalizeSeat(tableSnapshot?.youSeat);

  const table = {
    tableId,
    members,
    memberCount: members.length
  };

  if (maxSeats !== null) {
    table.maxSeats = maxSeats;
  }

  return {
    stateVersion,
    table,
    you: {
      userId,
      seat: youSeat
    }
  };
}

