import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

test("ws lockfile stays canonical for npm ci", () => {
  const pkg = readJson("ws-server/package.json");
  const lock = readJson("ws-server/package-lock.json");

  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name);
  assert.ok(lock.packages && typeof lock.packages === "object");
  assert.ok(lock.packages[""] && typeof lock.packages[""] === "object");
  assert.equal(lock.packages[""].name, pkg.name);

  const pkgWs = pkg.dependencies && pkg.dependencies.ws;
  const lockWs = lock.packages[""].dependencies && lock.packages[""].dependencies.ws;
  assert.equal(lockWs, pkgWs);

  assert.ok(lock.packages["node_modules/ws"] && lock.packages["node_modules/ws"].version);
  assert.ok(lock.packages["node_modules/ws"] && typeof lock.packages["node_modules/ws"].resolved === "string" && lock.packages["node_modules/ws"].resolved.length > 0, "lockfile must include node_modules/ws.resolved (regenerate via npm install in ws-server)");
  assert.ok(lock.packages["node_modules/ws"] && typeof lock.packages["node_modules/ws"].integrity === "string" && lock.packages["node_modules/ws"].integrity.length > 0, "lockfile must include node_modules/ws.integrity (regenerate via npm install in ws-server)");

  if (lock.dependencies && lock.dependencies.ws) {
    assert.ok(typeof lock.dependencies.ws === "object");
  }
});
