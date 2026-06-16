import assert from "node:assert/strict";
import { runAdvanceLoop } from "../netlify/functions/_shared/poker-autoplay.mjs";

assert.throws(
  () => runAdvanceLoop({ phase: "PREFLOP" }, [], [], null),
  /requires advanceIfNeeded function/
);

console.log("poker-autoplay runAdvanceLoop requires advanceIfNeeded unit test passed");
