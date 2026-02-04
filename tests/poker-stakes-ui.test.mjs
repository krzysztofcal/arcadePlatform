import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "poker/poker-stakes-ui.js"), "utf8");
const context = { window: {}, PokerStakesUi: null };
context.globalThis = context;
vm.runInNewContext(source, context);

assert.ok(context.PokerStakesUi);
assert.equal(typeof context.PokerStakesUi.format, "function");
assert.equal(context.PokerStakesUi.format({ sb: 1, bb: 2 }), "1/2");
assert.equal(context.PokerStakesUi.format("1/2"), "1/2");
assert.equal(context.PokerStakesUi.format('{"sb":1,"bb":2}'), "1/2");
assert.equal(context.PokerStakesUi.format({ sb: 2, bb: 2 }), "—");
assert.equal(context.PokerStakesUi.format({ sb: 1, bb: 1000001 }), "—");
