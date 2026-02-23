import fs from "node:fs";
import path from "node:path";
import { areCardsUnique, cardIdentity, isValidTwoCards } from "../../netlify/functions/_shared/poker-cards-utils.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "../../netlify/functions/_shared/poker-idempotency.mjs";
import { formatStakes, parseStakes } from "../../netlify/functions/_shared/poker-stakes.mjs";
import { clearMissedTurns } from "../../netlify/functions/_shared/poker-missed-turns.mjs";
import { patchSitOutByUserId } from "../../netlify/functions/_shared/poker-sitout-flag.mjs";
import { createPokerTableWithState } from "../../netlify/functions/_shared/poker-table-init.mjs";
import {
  buildSeatBotMap,
  chooseBotActionTrivial,
  computeTargetBotCount,
  getBotAutoplayConfig,
  getBotConfig,
  isBotTurn,
  makeBotSystemKey,
  makeBotUserId,
} from "../../netlify/functions/_shared/poker-bots.mjs";
import { cashoutBotSeatIfNeeded, ensureBotSeatInactiveForCashout } from "../../netlify/functions/_shared/poker-bot-cashout.mjs";
import { startHandCore } from "../../netlify/functions/_shared/poker-start-hand-core.mjs";
import { isValidUuid } from "../../netlify/functions/_shared/poker-utils.mjs";
import { withoutPrivateState } from "../../netlify/functions/_shared/poker-state-utils.mjs";
import { hasActiveHumanGuardSql, shouldSeedBotsOnJoin, tableIdleCutoffExprSql } from "../../netlify/functions/_shared/poker-table-lifecycle.mjs";
import { applyLeaveTable } from "../../netlify/functions/_shared/poker-reducer.mjs";

const root = process.cwd();

const stripImports = (source) => source.replace(/^\s*import[\s\S]*?;\s*$/gm, "");

const getDeclaredIdentifiers = (src) => {
  const declared = new Set();
  const re = /\b(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/g;
  let match;
  while ((match = re.exec(src))) {
    declared.add(match[1]);
  }
  const destr = /\b(?:export\s+)?(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=/g;
  let destrMatch;
  while ((destrMatch = destr.exec(src))) {
    const inside = destrMatch[1];
    for (const part of inside.split(",")) {
      const left = part.trim().split(":")[0].trim();
      if (left) declared.add(left);
    }
  }
  return declared;
};

export const loadPokerHandler = (filePath, mocks) => {
  const source = fs.readFileSync(path.join(root, filePath), "utf8");
  const withoutImports = stripImports(source);
  const rewritten = withoutImports.replace(/export\s+(async\s+)?function\s+handler\s*\(/, (_m, asyncKw) => {
    return `${asyncKw ? "async " : ""}function handler(`;
  });
  if (!rewritten.includes("function handler(")) {
    throw new Error(`[poker-test-helpers] Failed to rewrite handler export in ${filePath}`);
  }
  const declared = getDeclaredIdentifiers(rewritten);
  const injectable = [
    "baseHeaders",
    "beginSql",
    "awardPotsAtShowdown",
    "buildSidePots",
    "corsHeaders",
    "computeShowdown",
    "computeLegalActions",
    "computeNextDealerSeatNo",
    "buildActionConstraints",
    "deletePokerRequest",
    "createDeck",
    "dealHoleCards",
    "deriveDeck",
    "deriveCommunityCards",
    "deriveRemainingDeck",
    "ensurePokerRequest",
    "advanceIfNeeded",
    "applyAction",
    "applyLeaveTable",
    "areCardsUnique",
    "cardIdentity",
    "materializeShowdownAndPayout",
    "executeSql",
    "extractBearerToken",
    "getRng",
    "isPlainObject",
    "isStateStorageValid",
    "klog",
    "maybeApplyTurnTimeout",
    "normalizeJsonState",
    "normalizeRequestId",
    "normalizeSeatOrderFromState",
    "postTransaction",
    "postHandSettlementToLedger",
    "resetTurnTimer",
    "shuffle",
    "updatePokerStateOptimistic",
    "verifySupabaseJwt",
    "withoutPrivateState",
    "isValidUuid",
    "isHoleCardsTableMissing",
    "loadHoleCardsByUserId",
    "loadPokerStateForUpdate",
    "parseStakes",
    "patchLeftTableByUserId",
    "patchSitOutByUserId",
    "clearMissedTurns",
    "formatStakes",
    "upgradeLegacyInitState",
    "upgradeLegacyInitStateWithSeats",
    "createPokerTableWithState",
    "PRESENCE_TTL_SEC",
    "HEARTBEAT_INTERVAL_SEC",
    "storePokerRequestResult",
    "TABLE_EMPTY_CLOSE_SEC",
    "TABLE_SINGLETON_CLOSE_SEC",
    "TABLE_BOT_ONLY_CLOSE_SEC",
    "TURN_MS",
    "updatePokerStateLocked",
    "computeTargetBotCount",
    "getBotAutoplayConfig",
    "chooseBotActionTrivial",
    "buildSeatBotMap",
    "isBotTurn",
    "getBotConfig",
    "makeBotSystemKey",
    "makeBotUserId",
    "cashoutBotSeatIfNeeded",
    "ensureBotSeatInactiveForCashout",
    "startHandCore",
    "tableIdleCutoffExprSql",
    "hasActiveHumanGuardSql",
    "shouldSeedBotsOnJoin",
  ];
  const injectedNames = injectable.filter((name) => !declared.has(name));
  const destructureLine = injectedNames.length ? `const { ${injectedNames.join(", ")} } = mocks;` : "";
  const needsTwoCards =
    !declared.has("isValidTwoCards") && /\bisValidTwoCards\b/.test(rewritten);
  const twoCardsLine = needsTwoCards ? "const isValidTwoCards = isValidTwoCardsImpl;" : "";
  const factory = new Function(
    "mocks",
    "isValidTwoCardsImpl",
    `"use strict";
${destructureLine}
${twoCardsLine}
${rewritten}
return handler;`
  );
  try {
    const resolvedMocks = {
      parseStakes,
      formatStakes,
      ensurePokerRequest,
      storePokerRequestResult,
      deletePokerRequest,
      clearMissedTurns,
      patchSitOutByUserId,
      createPokerTableWithState,
      computeTargetBotCount,
      getBotAutoplayConfig,
      chooseBotActionTrivial,
      buildSeatBotMap,
      isBotTurn,
      applyLeaveTable,
      withoutPrivateState,
      getBotConfig,
      makeBotSystemKey,
      makeBotUserId,
      cashoutBotSeatIfNeeded,
      ensureBotSeatInactiveForCashout,
      startHandCore,
      tableIdleCutoffExprSql,
      hasActiveHumanGuardSql,
      shouldSeedBotsOnJoin,
      isValidUuid,
      areCardsUnique,
      cardIdentity,
      ...mocks,
    };
    return factory(resolvedMocks, isValidTwoCards);
  } catch (error) {
    throw new Error(`[poker-test-helpers] Failed to compile ${filePath}: ${error?.message || error}`);
  }
};
