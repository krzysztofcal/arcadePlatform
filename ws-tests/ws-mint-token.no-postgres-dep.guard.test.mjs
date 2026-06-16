import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const MINT_HANDLER = "netlify/functions/ws-mint-token.mjs";

function handlerText() {
  return fs.readFileSync(MINT_HANDLER, "utf8");
}

test("ws mint token handler does not import supabase-admin via any path", () => {
  const text = handlerText();
  assert.doesNotMatch(text, /(from|import)\s+["'][^"']*supabase-admin\.mjs["']/);
});

test("ws mint token handler has no direct postgres dependency", () => {
  const text = handlerText();
  assert.doesNotMatch(text, /(from|import)\s+["']postgres["']/);
});

test("ws mint token handler does not import local _shared modules", () => {
  const text = handlerText();
  assert.doesNotMatch(text, /(from|import)\s+["']\.?\.?\/[^"']*_shared\//);
});
