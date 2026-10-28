import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
assert.throws(() => verifyInlineScriptHashes({ documents: [], headersText: `${headers()}\n/account/*\n  Content-Security-Policy: script-src 'self'\n` }), /unsupported CSP route/);

const scoped = { portal: "portal()", gameOpen: "gameOpen()", gameFile: "gameFile()", poker: "poker()" };
const scopedHeaders = headers([], {
  "/*": `script-src 'self' '${hashInlineScript(scoped.portal)}'`,
  "/games-open/*": `script-src 'self' '${hashInlineScript(scoped.gameOpen)}'`,
  "/game*.html": `script-src 'self' '${hashInlineScript(scoped.gameFile)}'`,
  "/poker/*": `script-src 'self' '${hashInlineScript(scoped.poker)}'`,
});
const scopedDocuments = [
  { path: "index.html", content: `<script>${scoped.portal}</script>` },
  { path: "games-open/foo/index.html", content: `<script>${scoped.gameOpen}</script>` },
  { path: "game_trex.html", content: `<script>${scoped.gameFile}</script>` },
  { path: "poker/index.html", content: `<script>${scoped.poker}</script>` },
];
assert.equal(verifyInlineScriptHashes({ documents: scopedDocuments, headersText: scopedHeaders }), true);
assert.throws(() => verifyInlineScriptHashes({
  documents: [scopedDocuments[1]],
  headersText: headers([], { "/*": `script-src 'self' '${hashInlineScript(scoped.gameOpen)}'`, "/games-open/*": "script-src 'self'" }),
}), /missing 'sha256-/);

// Standalone landing publishes its own root and must not inherit portal routes.
const landingFixture = {documents:[{path:"landing/index.html",content:`<script>${source}</script>`}],routes:["/*"]};
const landingPolicy = `/*\n  Content-Security-Policy: script-src 'self' '${hashInlineScript(source)}'\n`;
assert.equal(verifyInlineScriptHashes({...landingFixture,headersText:landingPolicy}),true);
assert.throws(()=>verifyInlineScriptHashes({...landingFixture,headersText:""}),/missing CSP route/);
assert.throws(()=>verifyInlineScriptHashes({...landingFixture,headersText:landingPolicy.replace(hashInlineScript(source),hashInlineScript("wrong()"))}),/missing 'sha256-/);
assert.throws(()=>verifyInlineScriptHashes({...landingFixture,headersText:landingPolicy.replace("'self'","'self' 'unsafe-inline'")}),/unsafe-inline policy mismatch/);
assert.throws(()=>verifyInlineScriptHashes({...landingFixture,documents:[{path:"landing/index.html",content:'<link onload="unsafe()">'}],headersText:landingPolicy}),/inline event handler/);
const landingHeaders=readFileSync("landing/_headers","utf8");
assert.equal([...landingHeaders.matchAll(/Content-Security-Policy:/g)].length,1);
assert.doesNotMatch(landingHeaders,/googlesyndication|doubleclick|adtrafficquality|googleadservices/);
assert.equal([...landingHeaders.matchAll(/'sha256-[^']+'/g)].length,1,'only the common year script hash is needed');
for(const header of ["X-Frame-Options: DENY","X-Content-Type-Options: nosniff","Referrer-Policy: strict-origin-when-cross-origin","Permissions-Policy:"])assert.ok(landingHeaders.includes(header));
process.stdout.write("csp-inline-hashes behavior tests passed\n");
