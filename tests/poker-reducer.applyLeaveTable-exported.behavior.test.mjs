import assert from "node:assert/strict";
import { applyLeaveTable } from "../netlify/functions/_shared/poker-reducer.mjs";

assert.equal(typeof applyLeaveTable, "function");
console.log("poker-reducer applyLeaveTable exported behavior test passed");
