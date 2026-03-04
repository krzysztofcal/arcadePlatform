import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const MINT_HANDLER = "netlify/functions/ws-mint-token.mjs";

test("ws mint token handler does not import supabase-admin (postgres-coupled)", () => {
  const text = fs.readFileSync(MINT_HANDLER, "utf8");
  assert.doesNotMatch(text, /from\s+["']\.\/\_shared\/supabase-admin\.mjs["']/);
});

test("ws mint token handler has no direct postgres dependency", () => {
  const text = fs.readFileSync(MINT_HANDLER, "utf8");
  assert.doesNotMatch(text, /from\s+["']postgres["']/);
});
