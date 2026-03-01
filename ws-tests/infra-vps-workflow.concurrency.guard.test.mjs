import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

test("infra VPS workflow has top-level concurrency settings", () => {
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const concurrencyIndex = text.indexOf("concurrency:");
  const groupIndex = text.indexOf("group:", concurrencyIndex);
  const cancelIndex = text.indexOf("cancel-in-progress: false", concurrencyIndex);
  const jobsIndex = text.indexOf("jobs:");

  assert.notEqual(concurrencyIndex, -1);
  assert.notEqual(groupIndex, -1);
  assert.notEqual(cancelIndex, -1);
  assert.notEqual(jobsIndex, -1);
  assert.equal(concurrencyIndex < jobsIndex, true);
});
