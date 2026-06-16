export const runBotAutoplayLoop = async ({
  initialPrivateState,
  seatUserIdsInOrder,
  withoutPrivateState,
  materializeShowdownState,
  persistStep
}) => {
  const showdownSource = withoutPrivateState(initialPrivateState);
  const nextState = materializeShowdownState(showdownSource, seatUserIdsInOrder, null, { requiresShowdownComparison: true });
  await persistStep({
    botTurnUserId: typeof initialPrivateState?.turnUserId === "string" ? initialPrivateState.turnUserId : null,
    botAction: { type: "CHECK" },
    botRequestId: "bot:fixture:reload:1",
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
