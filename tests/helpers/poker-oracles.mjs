const c = (r, s) => ({ r, s });

const showdownOracles = [
  {
    name: "full_house_beats_trips",
    community: [c("A", "S"), c("A", "D"), c("K", "C"), c("7", "H"), c("2", "D")],
    players: [
      { userId: "u1", holeCards: [c("A", "H"), c("3", "C")] },
      { userId: "u2", holeCards: [c("K", "S"), c("K", "D")] },
    ],
    winners: ["u2"],
  },
  {
    name: "board_straight_tie",
    community: [c("9", "S"), c("8", "D"), c("7", "C"), c("6", "H"), c("5", "S")],
    players: [
      { userId: "u1", holeCards: [c("A", "S"), c("K", "D")] },
      { userId: "u2", holeCards: [c("Q", "H"), c("J", "H")] },
    ],
    winners: ["u1", "u2"],
  },
  {
    name: "flush_beats_straight",
    community: [c("A", "H"), c("K", "H"), c("Q", "H"), c("J", "C"), c("9", "D")],
    players: [
      { userId: "u1", holeCards: [c("T", "H"), c("2", "H")] },
      { userId: "u2", holeCards: [c("T", "S"), c("8", "S")] },
    ],
    winners: ["u1"],
  },
  {
    name: "two_pair_kicker",
    community: [c("A", "S"), c("A", "D"), c("K", "C"), c("7", "H"), c("2", "D")],
    players: [
      { userId: "u1", holeCards: [c("K", "S"), c("Q", "C")] },
      { userId: "u2", holeCards: [c("K", "D"), c("J", "C")] },
    ],
    winners: ["u1"],
  },
];

export { c, showdownOracles };
