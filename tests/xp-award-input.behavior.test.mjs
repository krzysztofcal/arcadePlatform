import assert from "node:assert/strict";
import {
  normalizeXpAwardInput,
  XP_AWARD_MAX_BODY_BYTES,
  XP_AWARD_MAX_GAME_EVENTS,
} from "../netlify/functions/_shared/xp-award-input.mjs";

const valid = {
  gameId: "open-tetris",
  windowStart: 1_000,
  windowEnd: 31_000,
  inputEvents: 10,
  visibilitySeconds: 30,
  scoreDelta: 100,
  gameEvents: [],
};

assert.deepEqual(normalizeXpAwardInput(valid).value.gameId, "tetris");
assert.equal(normalizeXpAwardInput({ ...valid, gameId: "unknown" }).error, "unsupported_game");

for (const [field, value] of [
  ["inputEvents", -1],
  ["inputEvents", 1.5],
  ["inputEvents", "1"],
  ["scoreDelta", Number.NaN],
  ["gameplayActions", Number.POSITIVE_INFINITY],
]) {
  const result = normalizeXpAwardInput({ ...valid, [field]: value });
  assert.deepEqual({ error: result.error, field: result.field }, { error: "invalid_award_payload", field });
}

assert.equal(normalizeXpAwardInput({ ...valid, windowEnd: 999 }).field, "window");
assert.equal(normalizeXpAwardInput({ ...valid, windowEnd: 31_001 }).field, "window");
assert.equal(normalizeXpAwardInput({ ...valid, gameEvents: Array(XP_AWARD_MAX_GAME_EVENTS + 1).fill({}) }).field, "gameEvents");

const measuredLargestCurrentPayload = {
  ...valid,
  anonId: "a".repeat(128),
  sessionId: "s".repeat(128),
  sessionToken: "t".repeat(2048),
  gameId: "missile-command",
  gameplayActions: 999_999,
  boostMultiplier: 5,
  gameEvents: Array.from({ length: XP_AWARD_MAX_GAME_EVENTS }, () => ({ type: "four_line_clear", value: 999_999_999 })),
};
const measuredBytes = Buffer.byteLength(JSON.stringify(measuredLargestCurrentPayload), "utf8");
assert.equal(measuredBytes, 4_781);
assert.ok(XP_AWARD_MAX_BODY_BYTES >= measuredBytes * 3, "body cap should retain at least a 3x margin over the measured legal fixture");

console.log("xp award input behavior tests passed");
