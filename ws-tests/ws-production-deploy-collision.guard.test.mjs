import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("ws-server-deploy is the only production mutation writer", () => {
  const wsDeploy = read(".github/workflows/ws-deploy.yml");
  const wsServerDeploy = read(".github/workflows/ws-server-deploy.yml");

  assert.match(wsServerDeploy, /appleboy\/scp-action@v0\.1\.7/);
  assert.match(wsServerDeploy, /appleboy\/ssh-action@v1\.0\.3/);

  assert.doesNotMatch(wsDeploy, /appleboy\/scp-action@/);
  assert.doesNotMatch(wsDeploy, /appleboy\/ssh-action@/);
  assert.doesNotMatch(wsDeploy, /docker\/login-action@/);
  assert.doesNotMatch(wsDeploy, /docker\/build-push-action@/);
});
