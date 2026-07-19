import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES = ["/*", "/games-open/*", "/game*.html", "/poker/*", "/games-open/freedoom/*"];
const PUBLIC_DIRS = ["about", "games", "games-open", "landing", "legal", "poker"];

export function hashInlineScript(source) {
  return `sha256-${createHash("sha256").update(source).digest("base64")}`;
}

function routeFor(documentPath) {
  const urlPath = `/${documentPath.replaceAll(path.sep, "/")}`;
  if (urlPath.startsWith("/games-open/freedoom/")) return "/games-open/freedoom/*";
  if (urlPath.startsWith("/games-open/")) return "/games-open/*";
  if (/^\/game.*\.html$/i.test(urlPath)) return "/game*.html";
  if (urlPath.startsWith("/poker/")) return "/poker/*";
  return "/*";
}

function parseHeaders(headersText) {
  const blocks = new Map();
  const lines = headersText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const route = lines[index].trim();
    if (!route || /^\s/.test(lines[index]) || route.startsWith("#")) continue;
    let csp = "";
    for (index += 1; index < lines.length && /^\s/.test(lines[index]); index += 1) {
      const match = lines[index].match(/^\s*Content-Security-Policy:\s*(.+)$/i);
      if (match) csp = match[1];
    }
    index -= 1;
    if (!csp) continue;
    if (!ROUTES.includes(route)) throw new Error(`unsupported CSP route in _headers: ${route}`);
    if (blocks.has(route)) throw new Error(`duplicate CSP route in _headers: ${route}`);
    blocks.set(route, csp);
  }
  for (const route of ROUTES) if (!blocks.has(route)) throw new Error(`missing CSP route in _headers: ${route}`);
  return blocks;
}

function inlineScripts(html) {
  const comments = [...html.matchAll(/<!--[\s\S]*?-->/g)].map((match) => [match.index, match.index + match[0].length]);
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi)) {
    if (comments.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const attributes = match[1];
    const source = match[2];
    if (/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i.test(attributes) || source.length === 0) continue;
    const type = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = String(type?.[1] ?? type?.[2] ?? type?.[3] ?? "").trim().toLowerCase();
    if (value === "application/json" || value === "application/ld+json") continue;
    scripts.push(source);
  }
  return scripts;
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (/\.(?:html|jsp)$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

async function collectServedDocuments(rootDir) {
  const rootEntries = await readdir(rootDir, { withFileTypes: true });
  const files = rootEntries.filter((entry) => entry.isFile() && /\.(?:html|jsp)$/i.test(entry.name)).map((entry) => path.join(rootDir, entry.name));
  for (const directory of PUBLIC_DIRS) files.push(...await collectFiles(path.join(rootDir, directory)));
  return Promise.all(files.sort().map(async (file) => ({ path: path.relative(rootDir, file), content: await readFile(file, "utf8") })));
}

export function verifyInlineScriptHashes({ documents, headersText }) {
  const policies = parseHeaders(headersText);
  const missing = [];
  for (const [route, csp] of policies) {
    const scriptSource = csp.match(/(?:^|;)\s*script-src\s+([^;]+)/i)?.[1] ?? "";
    const allowsUnsafeInline = /(?:^|\s)'unsafe-inline'(?:\s|$)/.test(scriptSource);
    if (allowsUnsafeInline !== (route === "/games-open/freedoom/*")) throw new Error(`unsafe-inline policy mismatch for route: ${route}`);
  }
  for (const document of documents) {
    const route = routeFor(document.path);
    const csp = policies.get(route);
    if (route === "/games-open/freedoom/*") continue;
    for (const source of inlineScripts(document.content)) {
      const hash = hashInlineScript(source);
      if (!csp.includes(`'${hash}'`)) missing.push(`${document.path}: missing '${hash}' in ${route}`);
    }
  }
  if (missing.length) throw new Error(missing.join("\n"));
  return true;
}

async function main() {
  const rootDir = process.cwd();
  const [documents, headersText] = await Promise.all([collectServedDocuments(rootDir), readFile(path.join(rootDir, "_headers"), "utf8")]);
  verifyInlineScriptHashes({ documents, headersText });
  process.stdout.write(`CSP inline hash guard passed for ${documents.length} served documents.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
