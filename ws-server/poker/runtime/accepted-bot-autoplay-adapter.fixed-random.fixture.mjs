import { createAcceptedBotAutoplayExecutor as createRealAcceptedBotAutoplayExecutor } from "./accepted-bot-autoplay-adapter.mjs";

export function createAcceptedBotAutoplayExecutor(options = {}) {
  return createRealAcceptedBotAutoplayExecutor({
    ...options,
    random: () => 0.5
  });
}

export const createAcceptedBotStepExecutor = createAcceptedBotAutoplayExecutor;
