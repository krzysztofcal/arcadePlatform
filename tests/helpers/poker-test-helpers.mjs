import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const stripImports = (source) => source.replace(/^\s*import[\s\S]*?;\s*$/gm, "");

export const loadPokerHandler = (filePath, mocks) => {
  const source = fs.readFileSync(path.join(root, filePath), "utf8");
  const withoutImports = stripImports(source);
  const rewritten = withoutImports.replace(/export\s+(async\s+)?function\s+handler\s*\(/, (_m, asyncKw) => {
    return `${asyncKw ? "async " : ""}function handler(`;
  });
  if (!rewritten.includes("function handler(")) {
    throw new Error(`[poker-test-helpers] Failed to rewrite handler export in ${filePath}`);
  }
  const factory = new Function(
    "mocks",
    `"use strict";
const {
  baseHeaders,
  beginSql,
  corsHeaders,
  createDeck,
  dealHoleCards,
  advanceIfNeeded,
  applyAction,
  executeSql,
  extractBearerToken,
  getRng,
  isPlainObject,
  isStateStorageValid,
  klog,
  normalizeJsonState,
  normalizeRequestId,
  postTransaction,
  shuffle,
  verifySupabaseJwt,
  withoutPrivateState,
  isValidUuid,
  PRESENCE_TTL_SEC,
  TABLE_EMPTY_CLOSE_SEC,
} = mocks;
${rewritten}
return handler;`
  );
  try {
    return factory(mocks);
  } catch (error) {
    throw new Error(`[poker-test-helpers] Failed to compile ${filePath}: ${error?.message || error}`);
  }
};
