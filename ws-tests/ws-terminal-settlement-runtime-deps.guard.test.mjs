import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const REDUCER_FILE = "ws-server/poker/shared/poker-action-reducer.mjs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function importsFrom(text) {
  return [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

test("ws terminal settlement reducer dependencies stay within ws-server runtime tree", () => {
  const text = read(REDUCER_FILE);
  const imports = importsFrom(text);

  assert.doesNotMatch(text, /netlify\/functions\/_shared/);

  for (const imp of imports) {
    if (!imp.startsWith(".")) continue;
    assert.equal(
      imp.includes("../../../netlify/"),
      false,
      `Reducer must not import unshipped netlify modules: ${imp}`
    );
  }
});
