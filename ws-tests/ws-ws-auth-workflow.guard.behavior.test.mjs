import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SERVER_TEST_COMMAND = "node --test ws-server/server.behavior.test.mjs";
const MINT_DOC_TEST_COMMAND = "node --test ws-tests/ws-auth-token-mint-doc.test.mjs";

function workflowText(path) {
  return fs.readFileSync(path, "utf8");
}

test("PR workflow runs ws-server behavior test before ws auth token mint doc coverage", () => {
  const text = workflowText(".github/workflows/ws-pr-checks.yml");
  const behaviorIndex = text.indexOf(SERVER_TEST_COMMAND);
  const mintDocIndex = text.indexOf(MINT_DOC_TEST_COMMAND);

  assert.notEqual(behaviorIndex, -1);
  assert.notEqual(mintDocIndex, -1);
  assert.equal(behaviorIndex < mintDocIndex, true);
});

test("deploy workflow runs ws-server behavior test before ws auth token mint doc coverage", () => {
  const text = workflowText(".github/workflows/ws-deploy.yml");
  const behaviorIndex = text.indexOf(SERVER_TEST_COMMAND);
  const mintDocIndex = text.indexOf(MINT_DOC_TEST_COMMAND);

  assert.notEqual(behaviorIndex, -1);
  assert.notEqual(mintDocIndex, -1);
  assert.equal(behaviorIndex < mintDocIndex, true);
});
