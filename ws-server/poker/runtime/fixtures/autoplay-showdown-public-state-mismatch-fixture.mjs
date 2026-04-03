export const runBotAutoplayLoop = async ({
  initialPrivateState,
  seatUserIdsInOrder,
  withoutPrivateState,
  materializeShowdownState,
  persistStep
}) => {
  const showdownSource = {
    ...withoutPrivateState(initialPrivateState),
    handId: "h-mismatch-fixture"
  };
  const nextState = materializeShowdownState(
    showdownSource,
    seatUserIdsInOrder,
    initialPrivateState?.holeCardsByUserId,
    { requiresShowdownComparison: true }
  );
  await persistStep({
    botTurnUserId: typeof initialPrivateState?.turnUserId === "string" ? initialPrivateState.turnUserId : null,
    botAction: { type: "CHECK" },
    botRequestId: "bot:fixture:mismatch:1",
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
