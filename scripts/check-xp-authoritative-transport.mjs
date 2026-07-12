import assert from "node:assert/strict";
import fs from "node:fs";

const client = fs.readFileSync(new URL("../js/xpClient.js", import.meta.url), "utf8");
const core = fs.readFileSync(new URL("../js/xp/core.js", import.meta.url), "utf8");
const legacyHandler = fs.readFileSync(new URL("../netlify/functions/award-xp.mjs", import.meta.url), "utf8");

assert.equal(client.includes('"/.netlify/functions/award-xp"'), false, "XPClient must not reference the retired award transport");
assert.equal(client.includes("postWindowAuto"), false, "obsolete postWindowAuto alias must stay removed");
assert.equal(client.includes("isServerCalcEnabled"), false, "obsolete server-calc feature flag must stay removed");
assert.equal(client.includes("XpServerCalc"), false, "duplicate server-calc module loader must stay removed");
assert.equal(core.includes("window.XPClient.postWindow(payload"), false, "XP core must not call legacy postWindow");
assert.match(core, /const postFn = window\.XPClient\.postWindowServerCalc;/, "XP core must use the authoritative transport");
assert.equal(legacyHandler.includes("executeAtomicXpAward"), false, "retired award handler must not contain XP mutation orchestration");
assert.match(legacyHandler, /legacy_award_retired/, "retired award handler must return a controlled compatibility error");

console.log("XP authoritative transport guard passed");
