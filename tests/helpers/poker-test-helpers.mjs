import fs from "node:fs";
import path from "node:path";

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
  const exportList = /\bexport\s*\{\s*([^}]+)\s*\}\s*;?/g;
  let exportMatch;
  while ((exportMatch = exportList.exec(src))) {
    for (const part of exportMatch[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) declared.add(name);
    }
  }
  const exportDefault = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\b/g;
  let defMatch;
  while ((defMatch = exportDefault.exec(src))) {
    declared.add(defMatch[1]);
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
    "corsHeaders",
    "createDeck",
    "dealHoleCards",
    "advanceIfNeeded",
    "applyAction",
    "executeSql",
    "extractBearerToken",
    "getRng",
    "isPlainObject",
    "isStateStorageValid",
    "klog",
    "normalizeJsonState",
    "normalizeRequestId",
    "postTransaction",
    "shuffle",
    "verifySupabaseJwt",
    "withoutPrivateState",
    "isValidUuid",
    "PRESENCE_TTL_SEC",
    "TABLE_EMPTY_CLOSE_SEC",
  ];
  const injectedNames = injectable.filter((name) => !declared.has(name));
  const destructureLine = injectedNames.length ? `const { ${injectedNames.join(", ")} } = mocks;` : "";
  const factory = new Function(
    "mocks",
    `"use strict";
${destructureLine}
${rewritten}
return handler;`
  );
  try {
    return factory(mocks);
  } catch (error) {
    throw new Error(`[poker-test-helpers] Failed to compile ${filePath}: ${error?.message || error}`);
  }
};
