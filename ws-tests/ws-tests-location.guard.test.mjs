import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function wsTestsStillInLegacyFolder() {
  if (!fs.existsSync("tests")) {
    return [];
  }

  return fs
    .readdirSync("tests", { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^ws-.*\.test\.mjs$/.test(entry.name))
    .map((entry) => `tests/${entry.name}`)
    .sort();
}

test("ws tests must live under ws-tests/ (no legacy tests/ws-*.test.mjs files)", () => {
  const legacy = wsTestsStillInLegacyFolder();
  assert.deepEqual(
    legacy,
    [],
    `Found WS tests under tests/:\n${legacy.join("\n")}\nMove these files to ws-tests/.`
  );
});
