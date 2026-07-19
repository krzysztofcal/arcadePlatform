import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { hashInlineScript, verifyInlineScriptHashes } from "../scripts/check-csp-inline-hashes.mjs";

const routes = ["/*", "/games-open/*", "/game*.html", "/poker/*"];
function headers(hashes = [], overrides = {}) {
  const normal = `script-src 'self' ${hashes.map((hash) => `'${hash}'`).join(" ")}`;
  return [...routes, "/games-open/freedoom/*"].map((route) => `${route}\n  Content-Security-Policy: ${overrides[route] ?? (route.includes("freedoom") ? "script-src 'self' 'unsafe-inline'" : normal)}\n`).join("\n");
}

assert.match(execFileSync(process.execPath, ["scripts/check-csp-inline-hashes.mjs"], { encoding: "utf8" }), /guard passed/);

const source = "\nwindow.guard = true;\n";
assert.throws(() => verifyInlineScriptHashes({ documents: [{ path: "index.html", content: `<script>${source}</script>` }], headersText: headers() }), /missing 'sha256-/);
assert.equal(verifyInlineScriptHashes({ documents: [{ path: "index.html", content: `<script>${source}</script>` }], headersText: headers([hashInlineScript(source)]) }), true);

const combinedFixture = `
<!-- <script>ignoredComment()</script> -->
<SCRIPT
  SRC='external.js'
  TYPE="text/javascript">ignoredExternal()</SCRIPT>
<script type='application/ld+json'>{"name":"Arcade"}</script>
<script TYPE="application/json">{"ok":true}</script>`;
assert.equal(verifyInlineScriptHashes({ documents: [{ path: "play.html", content: combinedFixture }], headersText: headers() }), true);
assert.equal(verifyInlineScriptHashes({ documents: [{ path: "games-open/freedoom/index.html", content: "<script>legacy()</script>" }], headersText: headers() }), true);
assert.throws(() => verifyInlineScriptHashes({ documents: [], headersText: headers([], { "/*": "script-src 'self' 'unsafe-inline'" }) }), /unsafe-inline policy mismatch/);

process.stdout.write("csp-inline-hashes behavior tests passed\n");
