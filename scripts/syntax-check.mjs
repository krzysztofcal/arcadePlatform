// Syntax check all JS/MJS + inline <script> in HTML
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as acorn from "acorn";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

const htmlRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const getAttr = (a, n) => (new RegExp(`${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\s>]+))`, "i").exec(a) || [])[2] ?? "";

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function isIgnored(file) {
  return /\.min\.js$/i.test(file);
}

function isExcludedDir(dir) {
  return dir === "node_modules" || dir === "dist" || dir === "build";
}

function shouldSkipDir(relDir) {
  return isExcludedDir(relDir) || relDir.startsWith("node_modules/") || relDir.startsWith("dist/") || relDir.startsWith("build/");
}

function shouldInclude(file) {
  if (isIgnored(file)) return false;
  if (file.endsWith(".html")) return true;
  if (file.endsWith(".js") || file.endsWith(".mjs")) {
    if (file.startsWith("js/")) return true;
    if (file.startsWith("netlify/functions/") && file.endsWith(".mjs")) return true;
  }
  return false;
}

async function listGitTrackedFiles() {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: ROOT });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(toPosix);
  } catch (error) {
    // Running outside of a git checkout; fall back to filesystem walk below.
    return null;
  }
}

function walkFilesystem() {
  const results = [];
  function walk(currentDir, relativeDir = "") {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (shouldSkipDir(nextRel)) continue;
        walk(path.join(currentDir, entry.name), nextRel);
      } else if (entry.isFile()) {
        const normalized = toPosix(nextRel);
        if (shouldInclude(normalized)) {
          results.push(normalized);
        }
      }
    }
  }
  walk(ROOT);
  return results;
}

async function resolveFiles() {
  const tracked = await listGitTrackedFiles();
  if (tracked && tracked.length > 0) {
    return tracked.filter(shouldInclude);
  }
  return walkFilesystem();
}

function parse(code, type, fileLabel) {
  acorn.parse(code, { ecmaVersion: "latest", sourceType: type, allowHashBang: true });
}

const files = (await resolveFiles()).sort();
let fails = [];

for (const rel of files) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, "utf8");
  if (rel.endsWith(".html")) {
    let match;
    while ((match = htmlRe.exec(src)) !== null) {
      const attrs = match[1] || "";
      const content = match[2] || "";
      if (/\bsrc=/.test(attrs)) continue;
      const type = (getAttr(attrs, "type") || "").toLowerCase();
      if (type && type !== "module" && type !== "application/javascript" && type !== "text/javascript") continue;
      try {
        parse(content, type === "module" ? "module" : "script", `${rel}<script>`);
      } catch (error) {
        fails.push(`${rel}<script>: ${error.message}`);
      }
    }
  } else {
    try {
      parse(src, rel.endsWith(".mjs") ? "module" : "script", rel);
    } catch (error) {
      fails.push(`${rel}: ${error.message}`);
    }
  }
}

if (fails.length) {
  console.error("✖ Syntax errors found:\n" + fails.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
} else {
  console.log(`✔ Syntax OK (${files.length} files)`);
}
