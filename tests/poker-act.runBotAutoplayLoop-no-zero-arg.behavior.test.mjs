import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = fs.readFileSync(path.join(root, "netlify/functions/poker-act.mjs"), "utf8");

assert.doesNotMatch(
  src,
  /\bawait\s+runBotAutoplayLoop\s*\(\s*\)\s*;/,
  "poker-act must not await runBotAutoplayLoop() with zero args"
);

assert.doesNotMatch(
  src,
  /\brunBotAutoplayLoop\s*\(\s*\)\s*;/,
  "poker-act must not call runBotAutoplayLoop() with empty args"
);

assert.match(
  src,
  /postAutoStartRequestId\s*=\s*`bot-auto:post-autostart:\$\{requestId\}`[\s\S]*?executeBotAutoplayLoop\s*\(\s*\{[\s\S]*?initialVersion:\s*loopVersion[\s\S]*?\}\s*\)/,
  "poker-act should trigger post-autostart bot autoplay with explicit initialVersion seed"
);

console.log("poker-act runBotAutoplayLoop no-zero-arg behavior test passed");
