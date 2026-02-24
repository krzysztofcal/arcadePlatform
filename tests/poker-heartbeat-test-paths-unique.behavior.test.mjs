import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const testsDir = path.join(root, "tests");

const run = async () => {
  const files = fs.readdirSync(testsDir);
  const conflictTestName = "poker-heartbeat-conflict-returns-ok.behavior.test.mjs";
  const conflictMatches = files.filter((file) => file === conflictTestName);
  assert.equal(conflictMatches.length, 1, "expected exactly one conflict returns ok test path");
  assert.equal(fs.existsSync(path.join(testsDir, conflictTestName)), true);
};

run().then(() => console.log("poker-heartbeat test paths unique behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
