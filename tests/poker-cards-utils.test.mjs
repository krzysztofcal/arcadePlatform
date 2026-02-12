import assert from "node:assert/strict";
import test from "node:test";
import { areCardsUnique, isValidCard, isValidTwoCards } from "../netlify/functions/_shared/poker-cards-utils.mjs";

test("isValidCard accepts supported ranks/suits", () => {
  assert.equal(isValidCard({ r: "A", s: "S" }), true);
  assert.equal(isValidCard({ r: "T", s: "h" }), true);
  assert.equal(isValidCard({ r: 14, s: "D" }), true);
  assert.equal(isValidCard({ r: 10, s: "C" }), true);
});

test("isValidCard rejects unsupported values", () => {
  assert.equal(isValidCard({ r: 1, s: "S" }), false);
  assert.equal(isValidCard({ r: 15, s: "S" }), false);
  assert.equal(isValidCard({ r: "X", s: "S" }), false);
  assert.equal(isValidCard({ r: "A", s: "Z" }), false);
  assert.equal(isValidCard({ r: null, s: "S" }), false);
});

test("areCardsUnique validates distinct cards", () => {
  assert.equal(
    areCardsUnique([
      { r: "A", s: "S" },
      { r: "K", s: "S" },
      { r: 10, s: "H" },
    ]),
    true
  );
});

test("areCardsUnique rejects duplicates and invalid cards", () => {
  assert.equal(
    areCardsUnique([
      { r: "A", s: "S" },
      { r: "A", s: "S" },
    ]),
    false
  );
  assert.equal(
    areCardsUnique([
      { r: "A", s: "S" },
      { r: "X", s: "S" },
    ]),
    false
  );
});

test("isValidTwoCards validates length/uniqueness/encoding", () => {
  assert.equal(
    isValidTwoCards([
      { r: "A", s: "S" },
      { r: "K", s: "S" },
    ]),
    true
  );
  assert.equal(
    isValidTwoCards([
      { r: "A", s: "S" },
      { r: "A", s: "S" },
    ]),
    false
  );
  assert.equal(
    isValidTwoCards([
      { r: "A", s: "S" },
      { r: "X", s: "S" },
    ]),
    false
  );
  assert.equal(isValidTwoCards([{ r: "A", s: "S" }]), false);
  assert.equal(isValidTwoCards([]), false);
});
