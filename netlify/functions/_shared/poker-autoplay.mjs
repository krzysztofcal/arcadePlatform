import { runAdvanceLoop, hasParticipatingHumanInHand, runBotAutoplayLoop as runBotAutoplayLoopShared } from "../../../shared/poker-domain/poker-autoplay.mjs";
import { computeLegalActions } from "./poker-legal-actions.mjs";
import { withoutPrivateState } from "./poker-state-utils.mjs";
import { chooseBotActionTrivial, isBotTurn } from "./poker-bots.mjs";
import { applyAction } from "./poker-reducer.mjs";

const runBotAutoplayLoop = (params) => runBotAutoplayLoopShared({
  ...params,
  computeLegalActions,
  withoutPrivateState,
  chooseBotActionTrivial,
  isBotTurn,
  applyAction
});

export { runAdvanceLoop, hasParticipatingHumanInHand, runBotAutoplayLoop };
