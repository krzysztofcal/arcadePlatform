import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = fs.readFileSync(path.join(root, "netlify/functions/_shared/poker-bot-cashout.mjs"), "utf8");

assert.ok(/await postTransaction\(\{[\s\S]*?userId: botUserId,[\s\S]*?createdBy,[\s\S]*?\}\);/.test(src), "bot cashout should attribute transaction to bot user while preserving actor as createdBy");
