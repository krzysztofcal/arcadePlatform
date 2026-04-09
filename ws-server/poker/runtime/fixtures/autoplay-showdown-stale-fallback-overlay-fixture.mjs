export const runBotAutoplayLoop = async ({
  initialPrivateState,
  seatUserIdsInOrder,
  withoutPrivateState,
  materializeShowdownState,
  persistStep,
  klog
}) => {
  const updatedPrivateState = {
    ...initialPrivateState,
    pot: Number(initialPrivateState?.pot || 0) + 25,
    contributionsByUserId: {
      ...(initialPrivateState?.contributionsByUserId || {}),
      bot_2: Number(initialPrivateState?.contributionsByUserId?.bot_2 || 0) + 25
    },
    phase: "SHOWDOWN",
    stacks: {
      ...(initialPrivateState?.stacks || {}),
      bot_2: Number(initialPrivateState?.stacks?.bot_2 || 0) - 25
    },
    foldedByUserId: {
      ...(initialPrivateState?.foldedByUserId || {}),
      bot_2: false
    }
  };
  const degradedPrimary = withoutPrivateState(updatedPrivateState);
  if (degradedPrimary?.contributionsByUserId && typeof degradedPrimary.contributionsByUserId === "object") {
    delete degradedPrimary.contributionsByUserId.human_1;
  }
  if (degradedPrimary?.stacks && typeof degradedPrimary.stacks === "object") {
    delete degradedPrimary.stacks.human_1;
  }
  const nextState = materializeShowdownState(
    degradedPrimary,
    seatUserIdsInOrder,
    updatedPrivateState?.holeCardsByUserId,
    { requiresShowdownComparison: true }
  );
  if (typeof klog === "function") {
    klog("ws_bot_autoplay_fixture_overlay_materialized", {
      pot: Number(nextState?.pot || 0),
      bot2Contribution: Number(nextState?.contributionsByUserId?.bot_2 || 0),
      humanContribution: Number(nextState?.contributionsByUserId?.human_1 || 0),
      humanStack: Number(nextState?.stacks?.human_1 || 0)
    });
  }
  await persistStep({
    botTurnUserId: typeof initialPrivateState?.turnUserId === "string" ? initialPrivateState.turnUserId : null,
    botAction: { type: "CHECK" },
    botRequestId: "bot:fixture:stale-overlay:1",
    fromState: degradedPrimary,
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
