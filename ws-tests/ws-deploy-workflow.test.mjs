import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

test("ws-deploy keeps ws-tests trigger surface and runs harness checks", () => {
  const text = workflowText();

  assert.match(text, /"ws-tests\/\*\*"/);
  assert.match(text, /"\.github\/workflows\/ws-deploy\.yml"/);

  const pushBlockMatch = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\njobs:/);
  const pushBlock = pushBlockMatch ? pushBlockMatch[1] : "";
  assert.match(pushBlock, /"ws-server\/\*\*"/);

  assert.match(text, /node --test ws-tests\/ws-deploy-workflow\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-tests-suite-completeness\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-production-deploy-collision\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-deploy\.no-prod-mutation-on-ws-tests\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-server-deploy-artifact-path\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-server-deploy-rollout\.test\.mjs/);
  assert.match(text, /Validate ws Dockerfile build contract \(repo-root context\)/);
  assert.match(text, /docker build -t arcadeplatform-ws-contract:\$\{\{ github\.sha \}\} -f ws-server\/Dockerfile \./);
  assert.doesNotMatch(text, /docker build[^\n]*-f ws-server\/Dockerfile \.\/ws-server/);
  assert.match(text, /Run state-patch behavior test/);
  assert.match(text, /node --test ws-server\/poker\/read-model\/state-patch\.behavior\.test\.mjs/);
  assert.match(text, /Run stream-log behavior test/);
  assert.match(text, /node --test ws-server\/poker\/runtime\/stream-log\.behavior\.test\.mjs/);
  assert.match(text, /Run ws table behavior test/);
  assert.match(text, /node --test ws-server\/poker\/table\/table\.behavior\.test\.mjs/);
  assert.match(text, /Run ws table snapshot behavior test/);
  assert.match(text, /node --test ws-server\/poker\/table\/table-snapshot\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine bootstrap behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-bootstrap\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine act behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-act\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine rollover behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-rollover\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine timeout behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-timeout\.behavior\.test\.mjs/);
});

test("ws-deploy is non-mutating for production", () => {
  const text = workflowText();

  assert.doesNotMatch(text, /docker\/login-action@/);
  assert.doesNotMatch(text, /docker\/build-push-action@/);
  assert.doesNotMatch(text, /appleboy\/ssh-action@/);
  assert.doesNotMatch(text, /appleboy\/scp-action@/);
  assert.doesNotMatch(text, /dorny\/paths-filter@/);
});


test("ws Dockerfile keeps ws-server deploy context-compatible copy contract", () => {
  const dockerfile = fs.readFileSync("ws-server/Dockerfile", "utf8");
  assert.match(dockerfile, /COPY ws-server\/package\.json ws-server\/package-lock\.json \.\//);
  assert.match(dockerfile, /COPY ws-server \.\//);
  assert.match(dockerfile, /COPY netlify\/functions\/_shared \.\/netlify\/functions\/_shared/);
  assert.match(dockerfile, /CMD \["node", "ws-server\/server\.mjs"\]/);
});


test("repo-root docker build contract excludes host ws-server/node_modules artifacts", () => {
  const dockerignore = fs.readFileSync(".dockerignore", "utf8");
  assert.match(dockerignore, /ws-server\/node_modules/);
  assert.match(dockerignore, /\*\*\/node_modules/);
});


test("ws-deploy trigger surface includes ws-server runtime changes", () => {
  const text = workflowText();
  const pushBlockMatch = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\njobs:/);
  const pushBlock = pushBlockMatch ? pushBlockMatch[1] : "";
  assert.match(pushBlock, /"ws-server\/\*\*"/);
});


test("ws-deploy keeps Docker artifact contract parity with repo-root context", () => {
  const text = workflowText();

  assert.match(text, /Validate ws Dockerfile build contract \(repo-root context\)/);
  assert.match(text, /docker build -t arcadeplatform-ws-contract:\$\{\{ github\.sha \}\} -f ws-server\/Dockerfile \./);
  assert.doesNotMatch(text, /context:\s*\.\/ws-server/);

  const usesBuildPush = /docker\/build-push-action@v6/.test(text);
  if (usesBuildPush) {
    assert.match(text, /docker\/build-push-action@v6[\s\S]*context:\s*\./);
    assert.match(text, /docker\/build-push-action@v6[\s\S]*file:\s*ws-server\/Dockerfile/);
  }
});


test("ws-deploy runs runtime deps guard test before ws behavior test", () => {
  const text = workflowText();
  const guardIndex = text.indexOf("node --test ws-tests/ws-server-package-runtime-deps.guard.test.mjs");
  const behaviorIndex = text.indexOf("node --test ws-server/server.behavior.test.mjs");
  assert.notEqual(guardIndex, -1);
  assert.notEqual(behaviorIndex, -1);
  assert.equal(guardIndex < behaviorIndex, true);
});
