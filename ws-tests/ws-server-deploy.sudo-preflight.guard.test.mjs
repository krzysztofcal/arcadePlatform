import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("ws-server deploy workflow avoids generic sudo true preflight", () => {
  const text = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");

  assert.doesNotMatch(text, /sudo -n true/);
  assert.match(text, /sudo -n systemctl cat ws-server\.service/);
});
