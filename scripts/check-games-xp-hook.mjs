#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const args = process.argv.slice(2);
const fileArgs = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--files") {
    for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j += 1) {
      fileArgs.push(args[j]);
      i = j;
    }
  }
}

function toPosix(value) {
  return value.split("\\").join("/");
}

function toRelativePath(file) {
  const absPath = isAbsolute(file) ? file : resolve(projectRoot, file);
  return toPosix(relative(projectRoot, absPath));
}

function shouldInspect(relPath) {
  if (!relPath.endsWith(".html")) return false;
  if (/^play\.html$/.test(relPath)) return true;
  if (/^game[^/]*\.html$/.test(relPath)) return true;
  if (/^games(?:-open)?\/.+\/index\.html$/.test(relPath)) return true;
  return false;
}

async function trackedFiles() {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: projectRoot });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => toPosix(line));
  } catch (error) {
    console.error("Failed to read tracked files:", error.message);
    process.exitCode = 1;
    return [];
  }
}

async function resolveFiles() {
  const tracked = await trackedFiles();
  const trackedSet = new Set(tracked);

  if (fileArgs.length) {
    const unique = new Set();
    for (const file of fileArgs) {
      const relPath = toRelativePath(file);
      if (!shouldInspect(relPath)) continue;
      const absPath = join(projectRoot, relPath);
      if (!existsSync(absPath)) continue;
      if (!trackedSet.has(relPath)) {
        // Allow staged-but-new files that may not be listed yet when lint-staged invokes the script.
        // git ls-files includes staged files, but fallback to accepting the path when it exists.
        unique.add(relPath);
        continue;
      }
      unique.add(relPath);
    }
    return Array.from(unique);
  }

  return tracked.filter((file) => shouldInspect(file));
}

function countScriptTags(pattern, source) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}

function stripJsComments(code) {
  let out = code.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  return out;
}

function countInlineBridgeScripts(source) {
  const scriptTagRx = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let count = 0;
  let match;
  while ((match = scriptTagRx.exec(source)) !== null) {
    const tag = match[0];
    if (/\bsrc\s*=/.test(tag)) continue;
    const inner = tag
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>\s*$/i, "");
    const js = stripJsComments(inner);
    if (/(?:GameXpBridge\.auto|bridge\.auto)\s*\(/.test(js)) {
      count += 1;
    }
  }
  return count;
}

async function analyzeFile(relPath) {
  const absPath = join(projectRoot, relPath);
  const raw = await readFile(absPath, "utf8");
  const source = stripHtmlComments(raw);

  const xpScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']*xp\.js(?:\?[^"']*)?\1[^>]*>\s*<\/script>/gi;
  const comboScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']*xp\/combo\.js(?:\?[^"']*)?\1[^>]*>\s*<\/script>/gi;
  const scoringScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']*xp\/scoring\.js(?:\?[^"']*)?\1[^>]*>\s*<\/script>/gi;
  const coreScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']*xp\/core\.js(?:\?[^"']*)?\1[^>]*>\s*<\/script>/gi;
  const hookScriptPattern = /<script\b[^>]*\bsrc\s*=\s*("|')[^"']*xp-game-hook\.js(?:\?[^"']*)?\1[^>]*>\s*<\/script>/gi;

  const xpScripts = countScriptTags(xpScriptPattern, source);
  const comboScripts = countScriptTags(comboScriptPattern, source);
  const scoringScripts = countScriptTags(scoringScriptPattern, source);
  const coreScripts = countScriptTags(coreScriptPattern, source);
  const hookScripts = countScriptTags(hookScriptPattern, source);
  const inlineScripts = countInlineBridgeScripts(source);
  const bodyMatch = source.match(/<body\b[^>]*>/i);

  const issues = [];
  if (xpScripts === 0) {
    issues.push("missing xp.js script tag");
  } else if (xpScripts > 1) {
    issues.push(`found ${xpScripts} xp.js script tags`);
  }

  if (comboScripts === 0) {
    issues.push("missing xp/combo.js script tag");
  } else if (comboScripts > 1) {
    issues.push(`found ${comboScripts} xp/combo.js script tags`);
  }

  if (scoringScripts === 0) {
    issues.push("missing xp/scoring.js script tag");
  } else if (scoringScripts > 1) {
    issues.push(`found ${scoringScripts} xp/scoring.js script tags`);
  }

  if (coreScripts === 0) {
    issues.push("missing xp/core.js script tag");
  } else if (coreScripts > 1) {
    issues.push(`found ${coreScripts} xp/core.js script tags`);
  }

  if (hookScripts === 0) {
    issues.push("missing xp-game-hook.js script tag");
  } else if (hookScripts > 1) {
    issues.push(`found ${hookScripts} xp-game-hook.js script tags`);
  }

  if (inlineScripts === 0) {
    issues.push("missing GameXpBridge auto bootstrap script");
  } else if (inlineScripts > 1) {
    issues.push(`found ${inlineScripts} GameXpBridge auto bootstrap scripts`);
  }

  if (!bodyMatch || !/data-game-host\b/i.test(bodyMatch[0])) {
    issues.push("missing data-game-host attribute on <body>");
  }

  return { relPath, issues };
}

async function main() {
  try {
    const files = await resolveFiles();
    if (files.length === 0) {
      console.log("XP hook guard: no matching HTML files found.");
      return;
    }

    const results = await Promise.all(files.map((file) => analyzeFile(file)));
    const problems = results.filter((result) => result.issues.length > 0);

    if (problems.length > 0) {
      console.error("XP hook guard: issues detected");
      for (const problem of problems) {
        for (const issue of problem.issues) {
          console.error(` - ${problem.relPath}: ${issue}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    console.log(`XP hook guard: OK (${files.length} file${files.length === 1 ? "" : "s"})`);
  } catch (error) {
    console.error("XP hook guard failed:", error.message);
    process.exitCode = 1;
  }
}

main();
