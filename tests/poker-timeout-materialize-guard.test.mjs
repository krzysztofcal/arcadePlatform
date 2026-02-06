import assert from "node:assert/strict";
import { materializeIfNeededPublic } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

const run = async () => {
  const inputs = [null, 0, "state", [], undefined];
  for (const input of inputs) {
    assert.equal(materializeIfNeededPublic(input, null), input);
  }
};

await run();
