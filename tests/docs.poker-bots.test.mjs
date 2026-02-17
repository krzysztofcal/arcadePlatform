import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("../docs/poker-bots.md", import.meta.url), "utf8");

assert.equal(content.includes("Bots are not implemented yet."), false);
assert.equal(content.includes("netlify/functions/_shared/poker-bots.mjs"), true);
assert.equal(content.includes("netlify/functions/_shared/poker-bot-cashout.mjs"), true);
