#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import fg from "fast-glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const patterns = [
  "game*.html",
  "games/**/index.html",
  "games-open/**/index.html",
  "play.html",
];

const ignore = [
  "**/node_modules/**",
  "**/.git/**",
  "**/tests/**",
];

const xpAsset = join(projectRoot, "js", "xp.js");
const hookAsset = join(projectRoot, "js", "xp-game-hook.js");

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function relativeAssetPath(fromDir, target) {
  const rel = toPosix(relative(fromDir, target));
  const fromRoot = toPosix(relative(projectRoot, fromDir)) === "";
  if (rel) {
    if (!rel.startsWith(".") && !rel.startsWith("/")) {
      return fromRoot ? `/${rel}` : rel;
    }
    return rel;
  }
  const rootRelative = toPosix(relative(projectRoot, target));
  if (!rootRelative) return fromRoot ? "/" : "./";
  if (fromRoot) return `/${rootRelative}`;
  return rootRelative.startsWith(".") ? rootRelative : `./${rootRelative}`;
}

function detectIndent(beforeBody) {
  const lines = beforeBody.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const match = line.match(/^([ \t]*)<script\b/);
    if (match) return match[1];
  }
  return "  ";
}

function removeExistingSnippets(content) {
  const xpPattern = new RegExp(
    String.raw`[\t ]*<script[^>]+src=("|')([^"']*/)?xp(?:-game-hook)?\.js\1[^>]*><\/script>[\t ]*(?:\r?\n)?`,
    "gi"
  );
  const autoPattern = new RegExp(
    String.raw`[\t ]*<script[^>]*>[^<]*GameXpBridge\.auto\([^<]*<\/script>[\t ]*(?:\r?\n)?`,
    "gi"
  );
  const stripped = content.replace(xpPattern, "").replace(autoPattern, "");
  return stripped.replace(/\n{3,}/g, "\n\n");
}

function ensureSnippet(content, absPath, relPath) {
  const cleaned = removeExistingSnippets(content);
  const closingIndex = cleaned.lastIndexOf("</body>");
  if (closingIndex === -1) {
    throw new Error(`Missing </body> tag in ${relPath}`);
  }
  const before = cleaned.slice(0, closingIndex);
  const after = cleaned.slice(closingIndex);
  const indent = detectIndent(before);
  const dir = dirname(absPath);
  const xpSrc = relativeAssetPath(dir, xpAsset);
  const hookSrc = relativeAssetPath(dir, hookAsset);
  const leadingNewline = before.endsWith("\n") ? "" : "\n";
  const snippet =
    `${leadingNewline}${indent}<script src="${xpSrc}" defer></script>` +
    `\n${indent}<script src="${hookSrc}" defer></script>` +
    `\n${indent}<script>(function start(gameId){const MAX_ATTEMPTS=8;const BASE_DELAY=75;let attempts=0;function tryStart(){if(window.__xpAutoBooted)return;if(window.GameXpBridge&&typeof window.GameXpBridge.auto==='function'){try{window.GameXpBridge.auto(gameId);window.__xpAutoBooted=true;return;}catch(_){}}if(attempts>=MAX_ATTEMPTS)return;attempts+=1;const delay=Math.min(500,BASE_DELAY*(attempts+1));window.setTimeout(tryStart,delay);}tryStart();if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',tryStart,{once:true});}else{window.setTimeout(tryStart,0);}window.addEventListener('load',tryStart,{once:true});})();</script>\n`;
  return before + snippet + after;
}

async function processFile(relPath) {
  const absPath = join(projectRoot, relPath);
  const original = await readFile(absPath, "utf8");
  const next = ensureSnippet(original, absPath, relPath);
  if (next !== original) {
    await writeFile(absPath, next, "utf8");
    return true;
  }
  return false;
}

async function main() {
  try {
    const files = await fg(patterns, { cwd: projectRoot, onlyFiles: true, ignore });
    if (files.length === 0) {
      console.log("No matching playable HTML files found.");
      return;
    }
    let updated = 0;
    for (const relPath of files) {
      try {
        const changed = await processFile(relPath);
        if (changed) {
          updated += 1;
          console.log(`Updated ${relPath}`);
        }
      } catch (error) {
        console.error(`Failed to update ${relPath}:`, error.message);
      }
    }
    if (updated === 0) {
      console.log("All playable HTML files already wired for XP bridge.");
    } else {
      console.log(`XP bridge wired into ${updated} file(s).`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

main();
