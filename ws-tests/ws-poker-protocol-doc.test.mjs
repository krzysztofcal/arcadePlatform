import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DOC_PATH = "docs/ws-poker-protocol.md";

function docText() {
  return fs.readFileSync(DOC_PATH, "utf8");
}

function serverMessageTypesSection(text) {
  const match = text.match(/### Server → Client\n\n([\s\S]*?)(\n### |\n## |$)/);
  return match ? match[1] : "";
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

  const serverTypes = serverMessageTypesSection(text);
  assert.ok(serverTypes.length > 0);
  assert.match(serverTypes, /^\|\s*`error`\s*\|/m);
  assert.match(serverTypes, /^\|\s*`resync`\s*\|/m);
  assert.match(serverTypes, /^\|\s*`stateSnapshot`\s*\|/m);
});

test("ws poker protocol document defines canonical stateSnapshot payload fields", () => {
  const text = docText();
  const serverTypes = serverMessageTypesSection(text);

  assert.match(serverTypes, /^\|\s*`stateSnapshot`\s*\|[^\n]*"stateVersion"\s*:\s*integer[^\n]*"table"\s*:\s*object[^\n]*"you"\s*:\s*object/m);
  assert.match(text, /"stateVersion"\s*:\s*\d+/);
  assert.match(text, /"table"\s*:\s*\{/);
  assert.match(text, /"you"\s*:\s*\{/);
});

test("ws poker protocol document contains envelope JSON markers", () => {
  const text = docText();
  assert.match(text, /"type"\s*:\s*"ping"/);
  assert.match(text, /"requestId"\s*:\s*"[^"]+"/);
});

test("ws poker protocol document describes table_state members as { userId, seat }", () => {
  const text = docText();
  assert.match(text, /payload\.members:\s*Array<\{\s*userId:\s*string,\s*seat:\s*number\s*\}>/);
  assert.match(text, /"type"\s*:\s*"table_state"/);
  assert.match(text, /"members"\s*:\s*\[\s*\{\s*"userId"\s*:\s*"[^"]+"\s*,\s*"seat"\s*:\s*\d+/s);
});


test("ws poker protocol document describes stable members sorting semantics", () => {
  const text = docText();
  assert.match(text, /Sorted by `seat` ascending, then `userId` ascending/);
});

test("ws poker protocol document includes bounds_exceeded join error code", () => {
  const text = docText();
  assert.match(text, /`bounds_exceeded`\s*—\s*join rejected because the table is already at max seats\./);
});


test("ws poker protocol document defines canonical reconnect resync payload shape", () => {
  const text = docText();
  assert.match(text, /"type"\s*:\s*"resync"/);
  assert.match(text, /"mode"\s*:\s*"required"/);
  assert.match(text, /"reason"\s*:\s*"[^"]+"/);
  assert.match(text, /"expectedSeq"\s*:\s*\d+/);
});

test("ws poker protocol document describes explicit no-op resume success", () => {
  const text = docText();
  assert.match(text, /lastSeq === latestSeq/);
  assert.match(text, /server returns `commandResult`/);
  assert.match(text, /"status": "accepted", "reason": null/);
});
test("first two JSON fenced blocks are parseable JSON", () => {
  const text = docText();
  const matches = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.ok(matches.length >= 2);
  assert.equal(typeof JSON.parse(matches[0]), "object");
  assert.equal(typeof JSON.parse(matches[1]), "object");
});
