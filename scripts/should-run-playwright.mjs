import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NON_WEB_PREFIXES = Object.freeze([
  ".github/workflows/",
  "scripts/ops/",
  "tests/chips/",
  "docs/",
]);

function normalizePath(filePath) {
  return String(filePath || "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

export function pathRequiresPlaywright(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) return false;
  return !NON_WEB_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function shouldRunPlaywrightForPaths(paths) {
  const normalizedPaths = [...paths].map(normalizePath).filter(Boolean);
  // A missing diff must fail safe: retain browser coverage rather than silently
  // treating an unknown PR as non-web.
  return normalizedPaths.length === 0 || normalizedPaths.some(pathRequiresPlaywright);
}

function writeGitHubOutput(outputPath, required) {
  if (!outputPath) throw new Error("--github-output is required");
  fs.appendFileSync(outputPath, `required=${required ? "true" : "false"}\n`);
}

function main() {
  const outputIndex = process.argv.indexOf("--github-output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const changedPaths = fs.readFileSync(0, "utf8").split(/\r?\n/);
  const required = shouldRunPlaywrightForPaths(changedPaths);
  writeGitHubOutput(outputPath, required);
  process.stdout.write(`Playwright required for changed paths: ${required}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
