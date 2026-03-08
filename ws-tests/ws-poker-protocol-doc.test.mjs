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

  assert.match(serverTypes, /^\|\s*`stateSnapshot`\s*\|[^\n]*"stateVersion"\s*:\s*integer[^\n]*"table"\s*:\s*object[^\n]*"you"\s*:\s*object[^\n]*"public"\s*:\s*object/m);
  assert.match(serverTypes, /"private"\?:\s*object/);
  assert.match(text, /"stateVersion"\s*:\s*\d+/);
  assert.match(text, /"table"\s*:\s*\{/);
  assert.match(text, /"you"\s*:\s*\{/);
  assert.match(text, /"public"\s*:\s*\{/);
  assert.match(text, /"hand"\s*:\s*\{\s*"handId"\s*:\s*null\s*,\s*"status"\s*:\s*"LOBBY"/);
  assert.match(text, /"board"\s*:\s*\{\s*"cards"\s*:\s*\[\s*\]/);
  assert.match(text, /"pot"\s*:\s*\{\s*"total"\s*:\s*0/);
  assert.match(text, /"turn"\s*:\s*\{\s*"userId"\s*:\s*"[^"]+"\s*,\s*"seat"\s*:\s*\d+\s*,\s*"startedAt"\s*:\s*null\s*,\s*"deadlineAt"\s*:\s*null\s*\}/s);
  assert.match(text, /"private"\s*:\s*\{[\s\S]*"holeCards"\s*:\s*\[/);
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

test("ws poker protocol document states bounded WS act idempotency replay window", () => {
  const text = docText();
  assert.match(text, /in-memory idempotency replay for `act` is bounded by per-table cache size/);
  assert.match(text, /oldest requestIds may be evicted/);
  assert.match(text, /reusing a requestId from a different user MUST NOT reuse another user's cached outcome/);
});
test("first two JSON fenced blocks are parseable JSON", () => {
  const text = docText();
  const matches = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.ok(matches.length >= 2);
  assert.equal(typeof JSON.parse(matches[0]), "object");
  assert.equal(typeof JSON.parse(matches[1]), "object");
});


test("ws poker protocol document states snapshot mode is one-shot and non-subscribing", () => {
  const text = docText();
  assert.match(text, /emits exactly one `stateSnapshot` frame/);
  assert.match(text, /(\*\*does not\*\* subscribe|does not subscribe) that socket to legacy `table_state` broadcasts/);
});

test("ws poker protocol document fallback wording matches PR7 defaults", () => {
  const text = docText();
  assert.match(text, /`public\.hand\.status` resolves to `"LOBBY"` \(members present\) or `"EMPTY"` \(no members\)/);
  assert.match(text, /`public\.pot\.total` resolves to `0`/);
  assert.match(text, /list fields resolve to `\[\]`/);
});

test("ws poker protocol document states private holeCards are seated-user only", () => {
  const text = docText();
  assert.match(text, /only for the authenticated seated user; omitted for observers/);
  assert.match(text, /Runtime includes `\{ userId, seat, holeCards \}` for seated users/);
});


test("ws poker protocol document describes PR8 live PREFLOP snapshot bootstrap contract delta", () => {
  const text = docText();
  assert.match(text, /PR8 contract delta/);
  assert.match(text, /`public\.hand\.status = "PREFLOP"`/);
  assert.match(text, /does \*\*not\*\* promise full WS `act` mutation support yet/);
});

test("ws poker protocol document describes PR9 act accepted snapshot delivery scope", () => {
  const text = docText();
  assert.match(text, /PR9 contract delta/);
  assert.match(text, /Successful or rejected domain outcomes are emitted as `commandResult`/);
  assert.match(text, /On accepted fresh `act`, server emits fresh post-action `stateSnapshot` to the acting connection and currently connected table-associated sockets/);
  assert.match(text, /Idempotent accepted replay returns accepted command semantics but does not trigger a new post-action snapshot fanout wave/);
});

test("ws poker protocol document describes PR11 terminal settled hand snapshot delta", () => {
  const text = docText();
  assert.match(text, /PR11 contract delta/);
  assert.match(text, /`public\.hand\.status = "SETTLED"`/);
  assert.match(text, /`public\.pot\.total = 0`/);
  assert.match(text, /`public\.showdown`/);
  assert.match(text, /`public\.handSettlement`/);
  assert.match(text, /Settled hands are no longer live\/actionable/);
});


test("ws poker protocol document describes PR14 turn timer snapshot delta", () => {
  const text = docText();
  assert.match(text, /PR14 contract delta/);
  assert.match(text, /`stateSnapshot\.payload\.public\.turn` now includes additive authoritative timer metadata/);
  assert.match(text, /`startedAt` and `deadlineAt`/);
  assert.match(text, /For non-live\/no-turn\/terminal states, both fields resolve to `null`/);
});


test("ws poker protocol document describes PR15 bounded replay + resume fallback semantics", () => {
  const text = docText();
  assert.match(text, /PR15 contract delta/);
  assert.match(text, /bounded in-memory replay window/);
  assert.match(text, /best-effort only within the current process lifetime/);
  assert.match(text, /`ack` advances receiver-local watermark only/);
  assert.match(text, /`statePatch` is emitted only after the receiver stream already has a baseline snapshot and patch generation is safe\/smaller/);
  assert.match(text, /same receiver\/session stream/);
  assert.match(text, /`statePatch` is additive optimization and `stateSnapshot` remains canonical fallback/);
});
