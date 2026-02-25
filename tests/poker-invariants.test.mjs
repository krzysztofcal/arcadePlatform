import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyLeaveTable } from "../netlify/functions/_shared/poker-reducer.mjs";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const sweepSrc = read("netlify/functions/poker-sweep.mjs");

assert.ok(
  sweepSrc.includes("poker_escrow_orphan_detected"),
  "sweep should log poker_escrow_orphan_detected for non-zero escrow with no active seats"
);
assert.ok(
  /from public\.chips_accounts a[\s\S]*?account_type = 'ESCROW'[\s\S]*?system_key like 'POKER_TABLE:%'/.test(sweepSrc),
  "sweep should query for orphaned poker escrow balances"
);


const invariantU1 = "12121212-1212-4121-8121-121212121212";
const invariantU2 = "34343434-3434-4343-8343-343434343434";
const invariantU3 = "56565656-5656-4565-8565-565656565656";

const invariantState = {
  phase: "TURN",
  handId: "hand-invariant-1",
  seats: [
    { userId: invariantU1, seatNo: 1 },
    { userId: invariantU2, seatNo: 2 },
  ],
  handSeats: [
    { userId: invariantU1, seatNo: 1 },
    { userId: invariantU2, seatNo: 2 },
  ],
  stacks: { [invariantU1]: 100, [invariantU2]: 90 },
  contributionsByUserId: { [invariantU1]: 30, [invariantU2]: 40 },
  pot: 70,
  turnUserId: invariantU2,
  dealerSeatNo: 1,
  toCallByUserId: { [invariantU1]: 0, [invariantU2]: 0 },
  betThisRoundByUserId: { [invariantU1]: 0, [invariantU2]: 0 },
  actedThisRoundByUserId: { [invariantU1]: true, [invariantU2]: true },
  foldedByUserId: { [invariantU1]: false, [invariantU2]: false },
  leftTableByUserId: { [invariantU1]: false, [invariantU2]: false },
  sitOutByUserId: { [invariantU1]: false, [invariantU2]: false },
  pendingAutoSitOutByUserId: {},
  allInByUserId: { [invariantU1]: false, [invariantU2]: false },
  community: [{ r: "A", s: "S" }, { r: "K", s: "H" }, { r: "Q", s: "D" }, { r: "2", s: "C" }],
  deck: [{ r: "3", s: "S" }],
};

const totalBefore = invariantState.pot + invariantState.stacks[invariantU1] + invariantState.stacks[invariantU2];
const { state: afterLeave } = applyLeaveTable(invariantState, { userId: invariantU1, requestId: "inv-leave-1" });
const afterJoin = {
  ...afterLeave,
  seats: [...afterLeave.seats, { userId: invariantU3, seatNo: 1 }],
  stacks: { ...afterLeave.stacks, [invariantU3]: 50 },
};
const cashedOutOnLeave = invariantState.stacks[invariantU1];
const totalAfterLeaveAndJoin = afterJoin.pot + afterJoin.stacks[invariantU2] + afterJoin.stacks[invariantU3] + cashedOutOnLeave;
assert.equal(totalBefore + afterJoin.stacks[invariantU3], totalAfterLeaveAndJoin);
assert.equal(afterJoin.handSeats.some((seat) => seat?.userId === invariantU3), false);
