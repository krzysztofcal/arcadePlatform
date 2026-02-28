import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DOC_PATH = "docs/ws-poker-protocol.md";

function docText() {
  return fs.readFileSync(DOC_PATH, "utf8");
}

test("ws poker protocol document exists and is non-empty", () => {
  assert.ok(fs.existsSync(DOC_PATH));
  const text = docText();
  assert.ok(text.trim().length > 0);
});

test("ws poker protocol document includes required sections", () => {
  const text = docText();
  assert.match(text, /^## Envelope$/m);
  assert.match(text, /^## Message types$/m);
  assert.match(text, /^## Errors$/m);
  assert.match(text, /^## Idempotency$/m);
  assert.match(text, /^## Reconnect\/Resync$/m);
  assert.match(text, /^## Versioning$/m);
});

test("ws poker protocol document defines required message type names", () => {
  const text = docText();
  assert.match(text, /^\|\s*`hello`\s*\|/m);
  assert.match(text, /^\|\s*`auth`\s*\|/m);
  assert.match(text, /^\|\s*`ping`\s*\|/m);
  assert.match(text, /^\|\s*`error`\s*\|/m);
  assert.match(text, /^\|\s*`resync`\s*\|/m);
});

test("ws poker protocol document contains envelope JSON markers", () => {
  const text = docText();
  assert.match(text, /"type"\s*:\s*"ping"/);
  assert.match(text, /"requestId"\s*:\s*"[^"]+"/);
});

test("first two JSON fenced blocks are parseable JSON", () => {
  const text = docText();
  const matches = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.ok(matches.length >= 2);
  assert.equal(typeof JSON.parse(matches[0]), "object");
  assert.equal(typeof JSON.parse(matches[1]), "object");
});
