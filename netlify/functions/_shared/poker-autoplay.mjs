import { computeLegalActions } from "./poker-legal-actions.mjs";
import { withoutPrivateState } from "./poker-state-utils.mjs";
import { chooseBotActionTrivial, isBotTurn } from "./poker-bots.mjs";
import { applyAction } from "./poker-reducer.mjs";

export const runAdvanceLoop = (stateToAdvance, eventsList, advanceEventsList, advanceIfNeeded, advanceLimit = 4) => {
  let next = stateToAdvance;
  let loopCount = 0;
  while (loopCount < advanceLimit) {
    if (next.phase === "HAND_DONE") break;
    const prevPhase = next.phase;
    const advanced = advanceIfNeeded(next);
    next = advanced.state;

    if (Array.isArray(advanced.events) && advanced.events.length > 0) {
      if (Array.isArray(eventsList)) eventsList.push(...advanced.events);
      if (Array.isArray(advanceEventsList)) advanceEventsList.push(...advanced.events);
    }

    if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
    if (next.phase === prevPhase) break;
    loopCount += 1;
  }
  return { nextState: next, loops: loopCount };
};

export const hasParticipatingHumanInHand = (state, seatBotMap) => {
  const seats = Array.isArray(state?.seats) ? state.seats : [];
  for (const seat of seats) {
    const userId = typeof seat?.userId === "string" ? seat.userId : "";
    if (!userId) continue;
    if (state?.foldedByUserId?.[userId]) continue;
    if (state?.leftTableByUserId?.[userId]) continue;
    if (state?.sitOutByUserId?.[userId]) continue;
    if (state?.pendingAutoSitOutByUserId?.[userId]) continue;
    const isBot = seatBotMap instanceof Map ? seatBotMap.get(userId) === true : !!seatBotMap?.[userId];
    if (!isBot) return true;
  }
  return false;
};

export const runBotAutoplayLoop = async ({
  tableId,
  requestId,
  initialState,
  initialPrivateState,
  initialVersion,
  seatBotMap,
  seatUserIdsInOrder,
  maxActions,
  botsOnlyHandCompletionHardCap,
  policyVersion,
  klog,
  isActionPhase,
  advanceIfNeeded,
  buildPersistedFromPrivateState,
  materializeShowdownState,
  persistStep,
}) => {
  let responseFinalState = initialState;
  let loopPrivateState = initialPrivateState;
  let loopVersion = initialVersion;
  let botActionCount = 0;
  let botStopReason = "not_attempted";
  let lastBotActionSummary = null;
  let responseEvents = [];
  const botsOnlyAtStart = !hasParticipatingHumanInHand(responseFinalState, seatBotMap);
  const effectiveMaxBotActions = botsOnlyAtStart
    ? Math.max(maxActions, botsOnlyHandCompletionHardCap)
    : maxActions;

  while (botActionCount < effectiveMaxBotActions) {
    if (!isActionPhase(responseFinalState.phase)) { botStopReason = "non_action_phase"; break; }
    const botTurnUserId = responseFinalState.turnUserId;
    if (!isBotTurn(botTurnUserId, seatBotMap)) { botStopReason = "turn_not_bot"; break; }

    const botLegalInfo = computeLegalActions({ statePublic: withoutPrivateState(responseFinalState), userId: botTurnUserId });
    const botChoice = chooseBotActionTrivial(botLegalInfo.actions);
    if (!botChoice || !botChoice.type) { botStopReason = "no_legal_action"; break; }

    const botRequestId = `bot:${requestId}:${botActionCount + 1}`;
    const botAction = { ...botChoice, userId: botTurnUserId, requestId: botRequestId };
    let botApplied;
    try {
      botApplied = applyAction(loopPrivateState, botAction);
    } catch (error) {
      botStopReason = "apply_action_failed";
      klog("poker_act_bot_autoplay_step_error", {
        tableId,
        handId: typeof responseFinalState?.handId === "string" && responseFinalState.handId.trim() ? responseFinalState.handId.trim() : null,
        turnUserId: botTurnUserId || null,
        policyVersion,
        botActionCount,
        reason: botStopReason,
        actionType: botAction.type || null,
        actionAmount: botAction.amount ?? null,
        error: error?.message || "apply_action_failed",
      });
      break;
    }

    let botNextState = botApplied.state;
    const botAdvanceEvents = [];
    const botEvents = Array.isArray(botApplied.events) ? botApplied.events.slice() : [];
    const botAdvanced = runAdvanceLoop(botNextState, botEvents, botAdvanceEvents, advanceIfNeeded);
    botNextState = botAdvanced.nextState;

    const botEligibleUserIds = seatUserIdsInOrder.filter((userId) =>
      typeof userId === "string" &&
      !botNextState.foldedByUserId?.[userId] &&
      !botNextState.leftTableByUserId?.[userId] &&
      !botNextState.sitOutByUserId?.[userId]
    );
    const botHandId = typeof botNextState.handId === "string" ? botNextState.handId.trim() : "";
    const botShowdownHandId =
      typeof botNextState.showdown?.handId === "string" && botNextState.showdown.handId.trim()
        ? botNextState.showdown.handId.trim()
        : "";
    const botShowdownMaterialized = !!botHandId && !!botShowdownHandId && botShowdownHandId === botHandId;
    const botNeedsShowdown = !botShowdownMaterialized && (botEligibleUserIds.length <= 1 || botNextState.phase === "SHOWDOWN");
    if (botNeedsShowdown && typeof materializeShowdownState === "function") {
      botNextState = materializeShowdownState(botNextState, seatUserIdsInOrder);
    }

    const botPersistedState = buildPersistedFromPrivateState(botNextState, botTurnUserId, botRequestId);
    const persistResult = await persistStep({
      botTurnUserId,
      botAction,
      botRequestId,
      fromState: responseFinalState,
      persistedState: botPersistedState,
      privateState: botNextState,
      events: botEvents,
      loopVersion,
    });

    if (!persistResult?.ok) {
      botStopReason = persistResult?.reason || "update_failed";
      break;
    }

    loopVersion = persistResult.loopVersion;
    responseFinalState = persistResult.responseFinalState;
    responseEvents = responseEvents.concat(botEvents);
    loopPrivateState = persistResult.loopPrivateState;
    lastBotActionSummary = { type: botAction.type, amount: botAction.amount ?? null, userId: botTurnUserId };
    botActionCount += 1;
  }

  if (botStopReason === "not_attempted") {
    if (botActionCount >= effectiveMaxBotActions) {
      botStopReason = botsOnlyAtStart ? "hard_cap_reached" : "action_cap_reached";
    } else {
      botStopReason = "completed";
    }
  } else if (botActionCount >= effectiveMaxBotActions) {
    botStopReason = botsOnlyAtStart ? "hard_cap_reached" : "action_cap_reached";
  }

  return {
    responseFinalState,
    loopPrivateState,
    loopVersion,
    botActionCount,
    botStopReason,
    botsOnlyAtStart,
    effectiveMaxBotActions,
    lastBotActionSummary,
    responseEvents,
  };
};
