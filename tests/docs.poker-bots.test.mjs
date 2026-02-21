import assert from "node:assert/strict";
import fs from "node:fs";

const botsDoc = fs.readFileSync(new URL("../docs/poker-bots.md", import.meta.url), "utf8");
const deploymentDoc = fs.readFileSync(new URL("../docs/poker-deployment.md", import.meta.url), "utf8");

assert.equal(
  botsDoc.includes("Bots are not implemented yet."),
  false,
  "docs/poker-bots.md should not claim bots are unimplemented"
);

for (const token of [
  "netlify/functions/_shared/poker-bots.mjs",
  "netlify/functions/_shared/poker-bot-cashout.mjs",
]) {
  assert.equal(
    botsDoc.includes(token),
    true,
    `docs/poker-bots.md should include runtime module token: ${token}`
  );
}

for (const token of [
  "netlify/functions/poker-join.mjs",
  "netlify/functions/poker-start-hand.mjs",
  "netlify/functions/poker-act.mjs",
  "netlify/functions/poker-sweep.mjs",
]) {
  assert.equal(
    botsDoc.includes(token),
    true,
    `docs/poker-bots.md should include runtime integration token: ${token}`
  );
}

for (const token of ["`is_bot`", "`bot_profile`", "`leave_after_hand`"]) {
  assert.equal(
    botsDoc.includes(token),
    true,
    `docs/poker-bots.md should include persisted seat-field token: ${token}`
  );
}

assert.equal(
  deploymentDoc.includes("Authoritative behavior reference: `docs/poker-bots.md`."),
  true,
  "docs/poker-deployment.md should include authoritative bots-doc reference"
);

for (const token of [
  "POKER_BOTS_ENABLED",
  "POKER_BOTS_MAX_PER_TABLE",
  "POKER_BOT_PROFILE_DEFAULT",
  "POKER_BOT_BUYIN_BB",
  "POKER_BOT_BANKROLL_SYSTEM_KEY",
]) {
  assert.equal(
    deploymentDoc.includes(token),
    true,
    `docs/poker-deployment.md should include env var token: ${token}`
  );
}
