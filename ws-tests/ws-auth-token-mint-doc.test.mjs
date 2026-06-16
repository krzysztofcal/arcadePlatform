import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const MINT_DOC = "docs/ws-auth-token-mint.md";
const PROTOCOL_DOC = "docs/ws-poker-protocol.md";

test("mint doc exists and includes admin/user mint sections", () => {
  const text = fs.readFileSync(MINT_DOC, "utf8");
  assert.match(text, /admin mint/i);
  assert.match(text, /user mint/i);
});

test("mint doc includes user-origin allowlist and admin no-origin security statements", () => {
  const text = fs.readFileSync(MINT_DOC, "utf8");
  assert.match(text, /XP_CORS_ALLOW/);
  assert.match(text, /\bURL\b/);
  assert.match(text, /origin must be allowlisted/i);
  assert.match(text, /admin mint/i);
  assert.match(text, /does not require/i);
  assert.match(text, /`Origin`|Origin/);
});

test("protocol doc references mint doc", () => {
  const text = fs.readFileSync(PROTOCOL_DOC, "utf8");
  assert.match(text, /ws-auth-token-mint\.md/);
});
