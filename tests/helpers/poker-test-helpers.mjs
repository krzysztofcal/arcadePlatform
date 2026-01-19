import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const stripImports = (source) => source.replace(/^\s*import\s+.*?;\s*$/gm, "");

export const loadPokerHandler = (filePath, mocks) => {
  const source = fs.readFileSync(path.join(root, filePath), "utf8");
  const withoutImports = stripImports(source);
  const rewritten = withoutImports.replace(/export\s+async\s+function\s+handler/, "async function handler");
  const factory = new Function(
    "mocks",
    `"use strict";
const {
  baseHeaders,
  beginSql,
  corsHeaders,
  extractBearerToken,
  klog,
  normalizeRequestId,
  postTransaction,
  verifySupabaseJwt,
  isValidUuid,
  PRESENCE_TTL_SEC,
  TABLE_EMPTY_CLOSE_SEC,
} = mocks;
${rewritten}
return handler;`
  );
  return factory(mocks);
};
