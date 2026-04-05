export const runBotAutoplayLoop = async ({
  initialPrivateState,
  seatUserIdsInOrder,
  withoutPrivateState,
  materializeShowdownState,
  persistStep
}) => {
  const publicLikeState = withoutPrivateState(initialPrivateState);
  delete publicLikeState.handId;
  const nextState = materializeShowdownState(
    publicLikeState,
    seatUserIdsInOrder,
    initialPrivateState?.holeCardsByUserId,
    { requiresShowdownComparison: true }
  );
  await persistStep({
    botTurnUserId: typeof initialPrivateState?.turnUserId === "string" ? initialPrivateState.turnUserId : null,
    botAction: { type: "CHECK" },
    botRequestId: "bot:fixture:missing-hand:1",
    fromState: publicLikeState,
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
