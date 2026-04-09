export const runBotAutoplayLoop = async ({
  initialPrivateState,
  seatUserIdsInOrder,
  withoutPrivateState,
  materializeShowdownState,
  persistStep
}) => {
  const showdownSource = withoutPrivateState(initialPrivateState);
  const firstSeatUserId = Array.isArray(seatUserIdsInOrder) ? seatUserIdsInOrder[0] : null;
  const partialLoopPrivate = firstSeatUserId
    ? { [firstSeatUserId]: initialPrivateState?.holeCardsByUserId?.[firstSeatUserId] }
    : {};
  const nextState = materializeShowdownState(showdownSource, seatUserIdsInOrder, partialLoopPrivate, { requiresShowdownComparison: true });
  await persistStep({
    botTurnUserId: typeof initialPrivateState?.turnUserId === "string" ? initialPrivateState.turnUserId : null,
    botAction: { type: "CHECK" },
    botRequestId: "bot:fixture:partial-loop-private:1",
    fromState: showdownSource,
    persistedState: withoutPrivateState(nextState),
    privateState: nextState,
    events: [],
    loopVersion: 1
  });
  return {
    responseFinalState: withoutPrivateState(nextState),
    loopPrivateState: nextState,
    loopVersion: 2,
    botActionCount: 1,
    botStopReason: "completed",
    responseEvents: []
  };
};
